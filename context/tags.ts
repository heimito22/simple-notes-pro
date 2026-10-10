/**
 * TAGS — extração, cores e catálogo.
 *
 * Uma tag é QUALQUER `#palavra` no texto da nota (o usuário escreve no meio
 * do conteúdo, como hashtag). As tags são DERIVADAS do conteúdo — nada é
 * gravado à parte, então sincronizam de graça (o conteúdo já vai no backup)
 * e funcionam igual no celular e no PC.
 *
 * A COR é determinística: hash FNV-1a do nome → índice fixo de uma paleta de
 * 12 cores. A mesma tag tem a MESMA cor em qualquer nota, tela e aparelho —
 * sem guardar cor em lugar nenhum.
 */

/** Paleta de 12 cores — vibrantes, legíveis nos temas claro e escuro. */
export const PALETA_TAGS = [
  '#FF991A', '#4FC3F7', '#BA68C8', '#66BB6A', '#EF5350', '#FFD54F',
  '#26C6DA', '#EC407A', '#7E57C2', '#A1887F', '#9CCC65', '#FF7043',
];

/** FNV-1a 32 bits — rápido e distribui bem nomes curtos. */
const fnv1a = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};

/** Nome canônico da tag: sem `#`, minúsculo, sem espaços nas pontas. */
export const normalizarTag = (s: string): string =>
  String(s || '').replace(/^#+/, '').trim().toLowerCase();

/** Cor estável da tag (mesma tag = mesma cor, sempre). */
export const corDaTag = (nome: string): string =>
  PALETA_TAGS[fnv1a(normalizarTag(nome)) % PALETA_TAGS.length];

/** Remove HTML e decodifica as entidades mais comuns — só o TEXTO da nota. */
const textoPlano = (html: string): string =>
  String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&/gi, '&')
    .replace(/</gi, '<')
    .replace(/>/gi, '>')
    .replace(/"/gi, '"')
    .replace(/&#39;/gi, "'");

/**
 * Extrai as tags do conteúdo (HTML ou texto). Únicas, em minúsculo, na ordem
 * em que aparecem. Regex unicode: letras/números/`_`/`-` depois do `#`.
 */
export const extrairTags = (conteudo: string): string[] => {
  const texto = textoPlano(conteudo);
  const vistos = new Set<string>();
  const saida: string[] = [];
  const re = /#[\p{L}\p{N}_-]{1,40}/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const nome = normalizarTag(m[0]);
    if (!nome || vistos.has(nome)) continue;
    vistos.add(nome);
    saida.push(nome);
  }
  return saida;
};

/** A nota/lista contém TODAS as tags pedidas (filtro AND). */
export const temTodasAsTags = (conteudo: string, filtro: string[]): boolean => {
  if (!filtro || filtro.length === 0) return true;
  const tags = new Set(extrairTags(conteudo));
  return filtro.every((f) => tags.has(normalizarTag(f)));
};

/** Catálogo global de tags (de todas as notas) com contagem, mais usadas primeiro. */
export const tagsDeItens = (notas: any[]): { nome: string; count: number }[] => {
  const contagem = new Map<string, number>();
  for (const n of notas || []) {
    for (const tag of extrairTags(n?.conteudo || '')) {
      contagem.set(tag, (contagem.get(tag) || 0) + 1);
    }
  }
  return Array.from(contagem.entries())
    .map(([nome, count]) => ({ nome, count }))
    .sort((a, b) => b.count - a.count || a.nome.localeCompare(b.nome));
};
