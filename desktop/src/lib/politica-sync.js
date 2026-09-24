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

    function registrar(id) {
      if (!id) return;
      mapa.set(String(id), agora());
      persistir();
    }
    function registrarVarios(ids) {
      (ids || []).forEach(function (x) { registrar(typeof x === 'object' ? x.id : x); });
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
    mesclarPorItem: mesclarPorItem,
    ordenarBackups: ordenarBackups, escolherCanonico: escolherCanonico,
  };
});
