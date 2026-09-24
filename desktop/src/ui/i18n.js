/**
 * I18n do DESKTOP — espelha context/idiomas.ts do celular.
 *
 * Dicionário: i18n-dict.js (gerado em build time pelo scripts/gerar-i18n.js
 * a partir de context/idiomas.ts — fonte única celular+PC).
 *
 * Dois caminhos de tradução, um dono só (este módulo):
 *  1. Explicito — elementos com [data-i18n] / [data-i18n-ph] / [data-i18n-title].
 *  2. Chrome estático — rótulos e títulos fixos do shell que casam com uma
 *     chave do dicionário. Conteúdo do USUÁRIO (notas, listas, pastas, chat)
 *     nunca é tocado: esses contêineres ficam fora do passe.
 * O JS que monta UI dinâmica usa T()/Tf() direto.
 *
 * A chave PT de cada elemento é MEMORIZADA (WeakMap) na primeira tradução. Sem
 * isso, um texto traduzido poderia casar com outra chave na volta (ex.: o
 * "Dados" em inglês é "Data", que também é uma chave PT) e trocar de idioma
 * várias vezes degradaria o texto.
 */
(function (root) {
  var atual = 'pt';
  var dict = root.I18N_DICT || { pt: {}, en: {}, es: {} };
  var AF = root.NodeFilter;

  // Contêineres com conteúdo do usuário (ou texto dinâmico que não é rótulo).
  var NAO_TRADUZIR = '#grid,#listaPastas,#tarefaLista,#lpItens,#iaHistorico,#rich,#toast,#edPasta,#modalMoverSelect,#tituloView';

  /** Traduz uma chave (o texto PT é a chave, fallback automático). */
  function T(chave) {
    var d = dict[atual] || {};
    return d[chave] != null ? d[chave] : (dict.pt[chave] != null ? dict.pt[chave] : chave);
  }

  /** Texto com variáveis: Tf('Mover {n} item(ns) para:', { n: 3 }). */
  function Tf(chave, vars) {
    var texto = T(chave);
    if (vars) Object.keys(vars).forEach(function (k) { texto = texto.split('{' + k + '}').join(String(vars[k])); });
    return texto;
  }

  var chavesPT = null;  // todo texto PT conhecido
  var reverso = { en: {}, es: {} };  // texto no idioma X -> chave PT

  function montarMapas() {
    chavesPT = {};
    reverso = { en: {}, es: {} };
    ['pt', 'en', 'es'].forEach(function (lg) {
      Object.keys(dict[lg] || {}).forEach(function (c) { if (chavesPT[c] == null) chavesPT[c] = c; });
    });
    ['en', 'es'].forEach(function (lg) {
      var d = dict[lg] || {};
      Object.keys(d).forEach(function (c) { if (reverso[lg][d[c]] == null) reverso[lg][d[c]] = c; });
    });
  }

  /** Texto do DOM -> chave PT (null quando não é texto de interface). */
  function descobrirChave(texto) {
    if (!texto) return null;
    if (atual === 'pt') return chavesPT[texto] != null ? texto : null;
    var d = dict[atual] || {};
    if (d[texto] != null) return texto;                    // já é a chave PT
    var r = reverso[atual] || {};
    return r[texto] != null ? r[texto] : null;             // já está traduzido
  }

  function pular(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.closest && el.closest('[data-i18n-skip]')) return true;
    return !!(el.closest && el.closest(NAO_TRADUZIR));
  }

  /** Define o idioma e traduz o HTML estático. Re-render é feito por quem chama. */
  function definir(idioma) {
    if (idioma !== 'en' && idioma !== 'es') idioma = 'pt';
    atual = idioma;
    document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : idioma;
    aplicarNoDocumento();
  }

  /** Percorre [data-i18n] (textContent), [data-i18n-ph] e [data-i18n-title]. */
  function aplicarNoDocumento() {
    if (!chavesPT) montarMapas();
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].textContent = T(els[i].getAttribute('data-i18n'));
    var phs = document.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < phs.length; j++) phs[j].setAttribute('placeholder', T(phs[j].getAttribute('data-i18n-ph')));
    var tls = document.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < tls.length; k++) tls[k].setAttribute('title', T(tls[k].getAttribute('data-i18n-title')));
    traduzirChrome();
  }

  var memTexto = new WeakMap(), memTitulo = new WeakMap(), memPlaceholder = new WeakMap();

  /** Chave do elemento: a memorizada ou, na 1a vez, deduzida do texto atual. */
  function chaveDe(memoria, el, texto) {
    var k = memoria.get(el);
    if (k != null) return k;
    k = descobrirChave(texto);
    if (k != null) memoria.set(el, k);
    return k;
  }

  /** Rótulos/títulos fixos do shell, casados pela chave memorizada. */
  function traduzirChrome() {
    if (!chavesPT) montarMapas();
    if (AF && root.document.createTreeWalker) {
      var walker = root.document.createTreeWalker(root.document.body, AF.SHOW_ELEMENT, null);
      var el = walker.nextNode();
      while (el) {
        if (!pular(el) && !el.hasAttribute('data-i18n') && el.children.length === 0) {
          var texto = el.textContent;
          if (texto && texto.trim() === texto) {
            var k = chaveDe(memTexto, el, texto);
            if (k != null) { var tr = T(k); if (tr !== texto) el.textContent = tr; }
          }
        }
        el = walker.nextNode();
      }
    }
    var comTitulo = root.document.querySelectorAll('[title]');
    for (var i = 0; i < comTitulo.length; i++) {
      if (pular(comTitulo[i])) continue;
      var t = comTitulo[i].getAttribute('title');
      var kt = chaveDe(memTitulo, comTitulo[i], t);
      if (kt != null) { var trt = T(kt); if (trt !== t) comTitulo[i].setAttribute('title', trt); }
    }
    var comPh = root.document.querySelectorAll('[placeholder]');
    for (var j = 0; j < comPh.length; j++) {
      if (pular(comPh[j])) continue;
      var p = comPh[j].getAttribute('placeholder');
      var kp = chaveDe(memPlaceholder, comPh[j], p);
      if (kp != null) { var trp = T(kp); if (trp !== p) comPh[j].setAttribute('placeholder', trp); }
    }
  }

  root.I18N = { T: T, Tf: Tf, definir: definir, aplicarNoDocumento: aplicarNoDocumento, traduzirChrome: traduzirChrome, idiomaAtual: function () { return atual; } };
  root.T = T;
  root.Tf = Tf;
})(window);
