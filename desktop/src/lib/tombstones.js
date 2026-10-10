/**
 * Registro de APAGADOS no PC — SÓ a persistência.
 *
 * A política (o que é um tombstone, quando ele vale, quando é esquecido) vive em
 * politica-sync.js, a MESMA fonte que o celular usa. Aqui só entra onde o PC
 * grava: localStorage. Antes a regra inteira era duplicada neste arquivo e no
 * do celular, e as duas versões divergiram.
 *
 * Formato no disco: { id: ts }.
 */
(function (root) {
  var CHAVE = 'sn_apagados_desktop';
  var P = root.PoliticaSync;

  var registro = P.criarRegistroApagados({
    gravar: function (apagados) {
      try { root.localStorage.setItem(CHAVE, JSON.stringify(apagados)); } catch (e) {}
    },
  });

  // localStorage é síncrono: o registro já entra carregado. Antes isso era
  // preguiçoso (uma flag + uma recarga em cada acesso) sem ganho nenhum.
  try {
    var bruto = root.localStorage.getItem(CHAVE);
    if (bruto) registro.hidratar(JSON.parse(bruto || '{}'));
  } catch (e) {}

  root.Tombstones = registro;
  // Tombstone À PROVA DE RELÓGIO: sempre POSTERIOR à versão do item que este
  // PC viu. O relógio de quem criou/editou o item (celular) e o relógio do PC
  // são aparelhos diferentes — nunca batem; um tombstone com Date.now() local
  // perdia a disputa para um item carimbado com relógio adiantado e o item
  // ressuscitava. Edições GENUINAMENTE posteriores continuam vencendo.
  root.Tombstones.tombarItem = function (id, item) {
    var base = 0;
    try { base = (root.PoliticaSync && item) ? (root.PoliticaSync.tsDoItem(item) + 1) : 0; } catch (e) {}
    registro.registrar(id, base);
  };
  // RELÓGIO HÍBRIDO (política compartilhada): o "visto" vive no localStorage —
  // sobrevive a reinícios. O merge.js carimba mutações locais com ele, e o
  // app.js avança o visto com os carimbos de cada backup puxado.
  try {
    root.RelogioSync = P.criarRelogio({
      ler: function () { return Number(root.localStorage.getItem('sn_relogio_sync')) || 0; },
      gravar: function (ts) { try { root.localStorage.setItem('sn_relogio_sync', String(ts)); } catch (e) {} },
    });
  } catch (e) {}
})(window);
