/**
 * POLÍTICA DE SINCRONIZAÇÃO — fonte ÚNICA, consumida pelo PC e pelo celular.
 *
 * Antes cada lado tinha a sua cópia: desktop/src/lib/tombstones.js + merge.js
 * (JS) e context/tombstones.ts + backup-drive.ts (TS). Duas cópias da MESMA
 * regra divergem — foi assim que PC e celular passaram a apagar diferente.
 *
 * Aqui vive só o que é POLÍTICA: nada de I/O, nada de framework. A persistência
 * entra por injeção (o adaptador de cada plataforma é que sabe gravar):
 *
 *   PC      → desktop/src/lib/tombstones.js  (localStorage)   → window.Tombstones
 *   celular → context/tombstones.ts          (AsyncStorage)   → import
 *
 * Como este arquivo é carregado: no PC ele é um <script> clássico (o renderer
 * roda em file://, onde ES module é bloqueado pelo CORS do Chromium) e no
 * celular é um import do Metro/Babel — por isso o UMD abaixo: `module.exports`
 * para quem tem CommonJS (Metro, e o processo principal do Electron via
 * require) e `globalThis.PoliticaSync` para o renderer.
 */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.PoliticaSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Janela em que um tombstone ainda vale (60 dias) e teto do que vai ao backup. */
  var JANELA_MS = 60 * 24 * 3600 * 1000;
  var LIMITE = 500;

  /** Momento da última modificação do item (epoch ms). */
  function tsDoItem(item) {
    if (!item) return 0;
    var v = item.dataModificacao;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var p = Date.parse(v); if (!isNaN(p)) return p; }
    if (item.data) { var p2 = Date.parse(item.data); if (!isNaN(p2)) return p2; } // legado: só o dia
    return 0;
  }

  /**
   * Registro de APAGADOS (tombstones).
   *
   * Sem ele o merge de proteção (que mantém itens só-locais) RESSUSCITA o que
   * foi apagado: o outro aparelho puxa o backup sem o item, vê-o como "só-local"
   * e o reenvia. Com tombstone a exclusão viaja no backup (`apagados: [{id, ts}]`)
   * e o merge sabe que aquele id morreu de propósito.
   *
   * O `ts` (epoch ms) resolve "apaguei aqui mas editei lá": item remodificado
   * DEPOIS da exclusão vence e reaparece (o tombstone é esquecido).
   *
   * `opcoes.gravar(apagados)` é o único ponto de I/O: o adaptador de cada
   * plataforma escreve onde quiser. `opcoes.agora` existe só para teste.
   */
  function criarRegistroApagados(opcoes) {
    var opts = opcoes || {};
    var gravar = opts.gravar || function () {};
    var agora = opts.agora || function () { return Date.now(); };
    var mapa = new Map();

    function paraObjeto() {
      var obj = {};
      mapa.forEach(function (ts, id) { obj[id] = ts; });
      return obj;
    }
    function persistir() { gravar(paraObjeto()); }

    /**
     * Carrega o que estava no disco/backup. Nunca REGRIDE um ts conhecido e,
     * com `janelaMs`, descarta o que já passou da validade (o disco do celular
     * acumulava tombstones para sempre).
     */
    function hidratar(obj, o) {
      var limite = (o && o.janelaMs) ? agora() - o.janelaMs : 0;
      Object.keys(obj || {}).forEach(function (id) {
        var ts = Number(obj[id]) || 0;
        if (!ts) return;
        if (limite && ts < limite) return;
        if (ts > (mapa.get(id) || 0)) mapa.set(id, ts);
      });
    }

    function registrar(id, tsMinimo) {
      if (!id) return;
      // À PROVA DE RELÓGIO: o tombstone tem que ser posterior ao item que apaga.
      // O relógio de quem apaga e o relógio de quem criou/editou o item são
      // APARELHOS DIFERENTES — nunca batem. Item criado no PC (relógio adiantado)
      // apagado no celular: um tombstone com o relógio do celular perde a disputa
      // (dataModificacao do PC é "mais novo") e o item ressuscita. Com o mínimo
      // baseado no PRÓPRIO item, o tombstone sempre vence a versão que o
      // aparelho via; edições GENUINAMENTE posteriores continuam vencendo.
      var base = Number(tsMinimo) || 0;
      mapa.set(String(id), Math.max(agora(), base));
      persistir();
    }
    function registrarVarios(ids) {
      (ids || []).forEach(function (x) {
        if (x && typeof x === 'object') registrar(x.id, x.ts);
        else registrar(x);
      });
    }
    function foiApagado(id) { return mapa.has(String(id)); }
    function ts(id) { return mapa.get(String(id)) || 0; }
    function esquecer(id) { if (mapa.delete(String(id))) persistir(); }

    /** Serializa para o backup (últimos 500, em ordem de registro). */
    function serializar() {
      var saida = [];
      mapa.forEach(function (t, id) { if (saida.length < LIMITE) saida.push({ id: id, ts: t }); });
      return saida;
    }

    /** Carrega tombstones do backup remoto, acumulando. */
    function carregar(lista) {
      var mudou = false;
      (lista || []).forEach(function (t) {
        if (!t || !t.id) return;
        var novo = Number(t.ts) || 0;
        if (novo > (mapa.get(t.id) || 0)) { mapa.set(t.id, novo); mudou = true; }
      });
      if (mudou) persistir();
    }

    /** Esquece tombstones mais velhos que a janela (evita crescer para sempre). */
    function podar(maxIdadeMs) {
      var limite = agora() - (maxIdadeMs || JANELA_MS);
      var mudou = false;
      mapa.forEach(function (t, id) { if (!t || t < limite) { mapa.delete(id); mudou = true; } });
      if (mudou) persistir();
    }

    function limpar() { mapa.clear(); persistir(); }

    return {
      hidratar: hidratar, registrar: registrar, registrarVarios: registrarVarios,
      foiApagado: foiApagado, ts: ts, esquecer: esquecer, serializar: serializar,
      carregar: carregar, podar: podar, limpar: limpar,
      quantidade: function () { return mapa.size; }, paraObjeto: paraObjeto,
    };
  }

  /**
   * Merge POR ITEM: o mais novo (`dataModificacao`) vence; empate fica com o
   * remoto (já é o que está na nuvem). Tombstones mandam, a não ser que a edição
   * seja mais nova que a exclusão.
   *
   * `localVenceu` diz que o resultado tem algo que a nuvem não tem (ou tem mais
   * velho) — quem chamou deve subir o backup na hora. Isso inclui a exclusão que
   * a nuvem ainda não conhece: sem esse aviso a nota sumia só aqui.
   */
  function mesclarPorItem(remotos, locais, registro) {
    var porId = new Map();
    var ordem = [];
    function considerar(it, origem) {
      if (!it || it.id == null) return;
      var id = String(it.id);
      var atual = porId.get(id);
      if (!atual) { porId.set(id, { it: it, origem: origem }); ordem.push(id); return; }
      if (tsDoItem(it) > tsDoItem(atual.it)) porId.set(id, { it: it, origem: origem });
    }
    (remotos || []).forEach(function (r) { considerar(r, 'r'); });
    (locais || []).forEach(function (l) { considerar(l, 'l'); });

    var itens = [];
    var localVenceu = false;
    ordem.forEach(function (id) {
      var e = porId.get(id);
      var tsApagado = registro ? registro.ts(id) : 0;
      if (tsApagado && tsDoItem(e.it) <= tsApagado) {
        // Apagado de propósito. Se a NUVEM ainda tem o item, ela precisa saber da
        // exclusão: sem isto a nota sumia só aqui e continuava viva no outro
        // aparelho (o push nunca era disparado porque nada "local" havia vencido).
        if (e.origem === 'r') localVenceu = true;
        return;
      }
      if (tsApagado) registro.esquecer(id); // editado depois da exclusão: volta
      if (e.origem === 'l') localVenceu = true;
      itens.push(e.it);
    });
    return { itens: itens, localVenceu: localVenceu };
  }

  /**
   * Maior `dataModificacao` conhecida entre itens — carimbo para o wipeAllAt:
   * "apagar tudo" com `Date.now()` local deixava sobreviver itens do OUTRO
   * aparelho cujo relógio está adiantado (ts > wipeAllAt). O carimbo cobre
   * tudo que o aparelho conhece (locais + backup atual): nada anterior sobrevive.
   */
  function maiorTsDe(itens) {
    var maior = 0;
    (itens || []).forEach(function (it) {
      var t = tsDoItem(it);
      if (t > maior) maior = t;
    });
    return maior;
  }

  /**
   * WIPE MARKER: processa um "apagar tudo" vindo do outro aparelho.
   *
   * O tombstone por item não cobre nota que só existe no PC (o celular
   * nem sabe que ela existe). O wipe marker resolve: um timestamp no backup
   * que diz "tudo ANTES deste instante morreu". O aparelho que puxa apaga
   * todos os itens locais com `dataModificacao <= wipeAllAt`.
   *
   * @param {Array} itens - os itens LOCAIS atuais
   * @param {number} wipeAllAt - timestamp do backup remoto (0 = sem wipe)
   * @param {number} ultimoVisto - último wipe que este aparelho já processou
   * @returns {{itens: Array, houveWipe: boolean}} itens sobreviventes
   */
  function aplicarWipe(itens, wipeAllAt, ultimoVisto) {
    if (!wipeAllAt || wipeAllAt <= (ultimoVisto || 0)) {
      return { itens: itens || [], houveWipe: false };
    }
    var sobrevivem = (itens || []).filter(function (it) {
      return tsDoItem(it) > wipeAllAt; // criado/editado DEPOIS do wipe: fica
    });
    return { itens: sobrevivem, houveWipe: true };
  }

  /**
   * RELÓGIO HÍBRIDO (físico + lógico, estilo Lamport) — resolve a classe
   * inteira de conflitos por clock skew entre aparelhos.
   *
   * O problema: a edição carimba com o relógio de QUEM edita. Item criado no
   * PC (relógio adiantado, T_pc) e editado no celular (relógio atrasado,
   * T_cel < T_pc): o merge via "a versão do PC é mais nova" e DESCARTAVA a
   * edição do celular — e re-subia a versão velha (a edição "não puxava").
   *
   * A solução: cada aparelho lembra o MAIOR dataModificacao que já viu em
   * qualquer dado sincronizado (via pull) e nunca carimba abaixo dele.
   * Propriedade Lamport: como todo aparelho viu (via pull) os carimbos dos
   * outros antes de editar, os carimbos novos são sempre crescentes — a
   * edição feita AGORA vence tudo que já existia, de qualquer relógio.
   *
   * `ler()`/`gravar()` são os únicos pontos de I/O (AsyncStorage no celular,
   * localStorage no PC): o visto sobrevive a reinícios do app.
   */
  function criarRelogio(opcoes) {
    var opts = opcoes || {};
    var gravar = opts.gravar || function () {};
    var agoraLocal = opts.agora || function () { return Date.now(); };
    var visto = Number(opts.ler && opts.ler()) || 0;

    /** Incorpora um carimbo visto em dados remotos/locais (nunca regride). */
    function avancarCom(ts) {
      var novo = Number(ts) || 0;
      if (novo > visto) { visto = novo; gravar(visto); }
      return visto;
    }

    /** Carimbo da próxima mutação local: nunca abaixo do maior já visto. */
    function agora() {
      var local = agoraLocal();
      var ts = local > visto ? local : (visto + 1);
      // O CARIMBO GERADO vira o novo piso — sem isto, duas mutações seguidas
      // com o relógio físico atrás do "visto" saíam com o MESMO ts (empate no
      // merge: o remoto vence e a edição local era descartada — era o que
      // fazia mover para pasta no celular reverter sozinho).
      if (ts > visto) { visto = ts; gravar(visto); }
      return ts;
    }

    return {
      agora: agora,
      avancarCom: avancarCom,
      visto: function () { return visto; },
    };
  }

  /**
   * BACKUP CANÔNICO: a conta pode acabar com MAIS DE UM `backup_notas.json`
   * (dois aparelhos criando o arquivo, ou um "apagar tudo" que removeu só o
   * primeiro). Pegar `files[0]` de uma lista sem ordem garantida fazia um
   * aparelho LER um arquivo e GRAVAR em outro — a alteração "não salvava".
   *
   * Regra única: o arquivo MAIS RECENTE (modifiedTime) é o canônico; o resto é
   * duplicado e pode ser removido.
   */
  function ordenarBackups(arquivos) {
    return (arquivos || []).slice().sort(function (a, b) {
      return (Date.parse((b && b.modifiedTime) || '') || 0) - (Date.parse((a && a.modifiedTime) || '') || 0);
    });
  }
  function escolherCanonico(arquivos) {
    var ordenados = ordenarBackups((arquivos || []).filter(function (f) { return f && f.id; }));
    return { canonico: ordenados[0] || null, duplicados: ordenados.slice(1), ordenados: ordenados };
  }

  return {
    JANELA_MS: JANELA_MS, LIMITE: LIMITE,
    tsDoItem: tsDoItem, criarRegistroApagados: criarRegistroApagados,
    mesclarPorItem: mesclarPorItem, aplicarWipe: aplicarWipe,
    maiorTsDe: maiorTsDe, criarRelogio: criarRelogio,
    ordenarBackups: ordenarBackups, escolherCanonico: escolherCanonico,
  };
});
