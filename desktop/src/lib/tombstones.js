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
})(window);
