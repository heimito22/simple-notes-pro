/**
 * TAGS no PC — extração, cores e catálogo (fonte: window.TagsSync).
 *
 * Uma tag é QUALQUER `#palavra` no texto da nota. Derivada do CONTEÚDO —
 * nada é gravado à parte: sincroniza de graça (o texto já vai no backup) e
 * é idêntica à do celular (context/tags.ts).
 *
 * A COR é determinística: hash FNV-1a do nome → índice fixo da paleta — a
 * mesma tag tem a MESMA cor no PC e no celular, sem guardar cor em lugar
 * nenhum. Carregado como script clássico (o renderer roda em file://).
 */
(function (root) {
  'use strict';

  var PALETA = [
    '#FF991A', '#4FC3F7', '#BA68C8', '#66BB6A', '#EF5350', '#FFD54F',
    '#26C6DA', '#EC407A', '#7E57C2', '#A1887F', '#9CCC65', '#FF7043',
  ];

  function fnv1a(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function normalizarTag(s) {
    return String(s || '').replace(/^#+/, '').trim().toLowerCase();
  }

  function corDaTag(nome) {
    return PALETA[fnv1a(normalizarTag(nome)) % PALETA.length];
  }

  /** Remove HTML e decodifica as entidades mais comuns — só o TEXTO da nota. */
  function textoPlano(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&/gi, '&')
      .replace(/</gi, '<')
      .replace(/>/gi, '>')
      .replace(/"/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  /** Extrai as tags do conteúdo: únicas, minúsculo, na ordem de aparição. */
  function extrairTags(conteudo) {
    var texto = textoPlano(conteudo);
    var vistos = {};
    var saida = [];
    var re = /#[\p{L}\p{N}_-]{1,40}/gu;
    var m;
    while ((m = re.exec(texto)) !== null) {
      var nome = normalizarTag(m[0]);
      if (!nome || vistos[nome]) continue;
      vistos[nome] = true;
      saida.push(nome);
    }
    return saida;
  }

  /** O item contém TODAS as tags pedidas (filtro E). */
  function temTodasAsTags(conteudo, filtro) {
    if (!filtro || !filtro.length) return true;
    var tags = {};
    extrairTags(conteudo).forEach(function (t) { tags[t] = true; });
    return filtro.every(function (f) { return tags[normalizarTag(f)]; });
  }

  /** Catálogo global (todas as notas): nome + contagem, mais usadas primeiro. */
  function tagsDeItens(notas) {
    var contagem = {};
    var ordem = [];
    (notas || []).forEach(function (n) {
      extrairTags(n && n.conteudo || '').forEach(function (t) {
        if (!contagem[t]) { contagem[t] = 0; ordem.push(t); }
        contagem[t]++;
      });
    });
    return ordem
      .map(function (t) { return { nome: t, count: contagem[t] }; })
      .sort(function (a, b) { return b.count - a.count || a.nome.localeCompare(b.nome); });
  }

  root.TagsSync = {
    normalizarTag: normalizarTag,
    corDaTag: corDaTag,
    extrairTags: extrairTags,
    temTodasAsTags: temTodasAsTags,
    tagsDeItens: tagsDeItens,
  };
})(window);
