// ============================================================================
// IA LOCAL PARA AS NOTAS — 100% offline, leve e instantânea.
// Não usa modelo de ML nem rede: busca por relevância de palavras em
// português (stopwords + stemização leve) + resumo extrativo de frases.
// Roda em QUALQUER celular, mesmo os mais antigos.
// ============================================================================

export interface TrechoResposta {
  notaId: string;
  titulo: string;
  frase: string;
  termos: string[]; // termos da pergunta encontrados na frase (normalizados)
}

export interface RespostaIA {
  temResposta: boolean;
  trechos: TrechoResposta[];
  termosPergunta: string[];
}

// --- Stopwords do português (palavras sem peso de busca) --------------------
const STOPWORDS = new Set([
  'a','à','as','ao','aos','aqui','ainda','algo','algum','alguma','algumas','alguns',
  'antes','aquela','aquelas','aquele','aqueles','aquilo','até','atras','através','bem',
  'cada','cá','coisa','coisas','como','com','contra','das','da','de','delas','dela',
  'deles','dele','depois','dessa','desse','desta','deste','dia','do','dos','e','ela',
  'elas','ele','eles','em','então','entre','era','eram','essa','essas','esse','esses',
  'esta','está','estas','este','estes','estou','eu','faz','fazer','feito','foi','foram',
  'há','hora','horas','hoje','isso','isto','já','la','lá','lhe','lhes','mais','mas','me',
  'mesma','mesmas','mesmo','mesmos','meu','meus','mim','muito','muitos','na','não','nas',
  'nem','nenhum','nenhuma','nessa','nesse','nesta','neste','no','nos','nossa','nossas',
  'nosso','nossos','num','numa','nunca','o','os','ou','outra','outras','outro','outros',
  'para','pela','pelas','pelo','pelos','pode','poder','poderia','por','porém','porque',
  'pra','próprio','qual','quando','quanto','que','quem','se','sem','sempre','sendo','ser',
  'será','seu','seus','só','sob','sobre','sua','suas','tal','também','tão','te','tem',
  'têm','tendo','tenho','ter','teu','teus','toda','todas','todo','todos','tu','tua','tuas',
  'um','uma','umas','uns','você','vocês','vez','vezes','via','vou','vai','vão','ver','viu',
]);

// --- Normalização e stemização leve do português -----------------------------
export function normalizar(palavra: string): string {
  return palavra
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Remove plurais e sufixos comuns (versão enxuta de stemmer p/ pt-BR). */
export function stemPalavra(palavra: string): string {
  let p = normalizar(palavra); // acentos já removidos (ção → cao, ões → oes...)
  if (p.length <= 3) return p;
  // Plurais especiais (formas sem acento)
  if (p.endsWith('coes') && p.length > 5) p = p.slice(0, -4) + 'cao';
  else if (p.endsWith('oes') && p.length > 4) p = p.slice(0, -3) + 'ao';
  else if (p.endsWith('aes') && p.length > 4) p = p.slice(0, -3) + 'ao';
  else if (p.endsWith('ais') && p.length > 4) p = p.slice(0, -3) + 'al';
  else if (p.endsWith('eis') && p.length > 4) p = p.slice(0, -3) + 'el';
  // Plural simples
  else if (p.endsWith('s') && !p.endsWith('ss') && !p.endsWith('us') && !p.endsWith('is')) p = p.slice(0, -1);
  // Sufixo comum
  else if (p.endsWith('mente') && p.length > 7) p = p.slice(0, -5);
  return p;
}

/** Remove tags HTML e converte para texto puro. */
export function limparTexto(html: string): string {
  if (!html) return '';
  return html
    .replace(/<img[^>]*>/g, ' [foto] ')
    .replace(/<audio[^>]*>/g, ' [audio] ')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Converte texto em tokens (palavras com peso de busca). */
export function tokenizar(texto: string): string[] {
  const limpo = limparTexto(texto);
  const palavras = limpo.match(/[a-zA-ZÀ-ú0-9]+/g) || [];
  return palavras
    .map(stemPalavra)
    .filter(p => p.length > 2 && !STOPWORDS.has(p));
}

/** Divide o texto em frases (com mais de 15 caracteres). */
export function dividirFrases(texto: string): string[] {
  const limpo = limparTexto(texto);
  const frases: string[] = [];
  let atual = '';
  for (const ch of limpo) {
    atual += ch;
    if (/[.!?…]/.test(ch) || ch === '\n') {
      const f = atual.trim();
      if (f.length > 15) frases.push(f);
      atual = '';
    }
  }
  const restante = atual.trim();
  if (restante.length > 15) frases.push(restante);
  return frases;
}

// --- Resumo extrativo --------------------------------------------------------
/** Gera um resumo curto da nota escolhendo as frases com mais conteúdo. */
export function resumirNota(texto: string, maxFrases = 3): string[] {
  const frases = dividirFrases(texto);
  if (frases.length === 0) return [];
  if (frases.length <= maxFrases) return frases;

  const freq = new Map<string, number>();
  const tokensFrase = frases.map(f => tokenizar(f));
  for (const toks of tokensFrase) {
    for (const t of new Set(toks)) freq.set(t, (freq.get(t) || 0) + 1);
  }

  const pontuadas = frases.map((frase, i) => {
    const toks = tokensFrase[i];
    const base = toks.reduce((s, t) => s + (freq.get(t) || 0), 0) / Math.max(1, toks.length);
    const bonusPosicao = i === 0 ? 1.4 : 0; // primeira frase costuma ser importante
    return { frase, score: base * (1 + bonusPosicao), ordem: i };
  });

  return pontuadas
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFrases)
    .sort((a, b) => a.ordem - b.ordem)
    .map(p => p.frase);
}

// --- Perguntas e respostas ---------------------------------------------------
/**
 * Busca a resposta para a pergunta nas notas.
 * - Se NENHUM termo da pergunta existir nas notas → temResposta=false
 *   (a interface deve responder que só ajuda com assuntos das notas).
 * - Se termos existirem → devolve os trechos mais relevantes.
 */
export function buscarResposta(notas: any[], pergunta: string, maxTrechos = 3): RespostaIA {
  const termosPergunta = tokenizar(pergunta);
  if (termosPergunta.length === 0) {
    return { temResposta: false, trechos: [], termosPergunta: [] };
  }

  const trechos: TrechoResposta[] = [];
  for (const nota of notas) {
    const texto = limparTexto(nota.conteudo || '') + ' ' + limparTexto(nota.titulo || '');
    const frases = dividirFrases(texto);
    for (const frase of frases) {
      const tokensFrase = tokenizar(frase);
      const encontrados = termosPergunta.filter(t => tokensFrase.includes(t));
      if (encontrados.length > 0) {
        trechos.push({
          notaId: nota.id,
          titulo: nota.titulo || 'Sem título',
          frase,
          termos: [...new Set(encontrados)],
        });
      }
    }
  }

  trechos.sort((a, b) => b.termos.length - a.termos.length);
  return {
    temResposta: trechos.length > 0,
    trechos: trechos.slice(0, maxTrechos),
    termosPergunta,
  };
}

// --- Organização -------------------------------------------------------------
/** Sugere as palavras-chave mais frequentes (tags) de um texto. */
export function sugerirTags(texto: string, limite = 6): string[] {
  const freq = new Map<string, number>();
  for (const t of tokenizar(texto)) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([t]) => t);
}

/** Encontra notas parecidas com a nota atual (similaridade de tokens). */
export function notasRelacionadas(notas: any[], idAtual: string | undefined, limite = 3): any[] {
  if (!idAtual) return [];
  const atual = notas.find((n: any) => n.id === idAtual);
  if (!atual) return [];
  const toksAtual = new Set(tokenizar((atual.titulo || '') + ' ' + (atual.conteudo || '')));
  if (toksAtual.size === 0) return [];

  return notas
    .filter((n: any) => n.id !== idAtual)
    .map((n: any) => {
      const toks = new Set(tokenizar((n.titulo || '') + ' ' + (n.conteudo || '')));
      let inter = 0;
      for (const t of toks) if (toksAtual.has(t)) inter++;
      const similaridade = inter / Math.max(1, Math.sqrt(toksAtual.size * toks.size));
      return { ...n, similaridade };
    })
    .filter((n: any) => n.similaridade > 0.18)
    .sort((a: any, b: any) => b.similaridade - a.similaridade)
    .slice(0, limite);
}
