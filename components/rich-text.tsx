import React from 'react';
import { Text, TextStyle } from 'react-native';

/**
 * Renderiza um subconjunto limitado de HTML como <Text> estilizado do React Native.
 * Suporta: b/strong, i/em, u, s/strike/del, h1-h3, ul/ol/li, br, p/div, img (como [Foto]).
 * Qualquer tag desconhecida é ignorada (apenas o texto interno é mantido).
 */

const INLINE_STYLES: Record<string, TextStyle> = {
  b: { fontWeight: 'bold' },
  strong: { fontWeight: 'bold' },
  i: { fontStyle: 'italic' },
  em: { fontStyle: 'italic' },
  u: { textDecorationLine: 'underline' },
  s: { textDecorationLine: 'line-through' },
  strike: { textDecorationLine: 'line-through' },
  del: { textDecorationLine: 'line-through' },
  code: { fontFamily: 'monospace' },
};

const HEADING_STYLES: Record<string, TextStyle> = {
  h1: { fontSize: 24, fontWeight: '700' },
  h2: { fontSize: 21, fontWeight: '700' },
  h3: { fontSize: 18, fontWeight: '600' },
};

interface Token {
  type: 'text' | 'open' | 'close';
  name?: string;
  text?: string;
}

interface Run {
  text: string;
  styles: TextStyle[];
}

// Remove marcadores de anexos e tags de mídia do preview de texto
// (fotos/áudios são renderizados como miniatura/chip separados nos cards).
const limparAnexos = (html: string) =>
  (html || '')
    .replace(/\[(?:Imagem|Áudio) anexad[oa]:\s*[^\]]*\]/gi, ' ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<audio[\s\S]*?<\/audio>/gi, ' ')
    .replace(/<span[^>]*class=["']anexo-audio-text["'][^>]*>[\s\S]*?<\/span>/gi, ' ');

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

const tokenize = (html: string): Token[] => {
  const parts = html.split(/(<\/?[a-zA-Z][^>]*>)/g);
  const tokens: Token[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (p[0] === '<' && p[p.length - 1] === '>') {
      const isClose = p[1] === '/';
      const name = p.replace(/<\/?/g, '').replace(/[>\s/].*$/g, '').toLowerCase();
      tokens.push(isClose ? { type: 'close', name } : { type: 'open', name });
    } else {
      tokens.push({ type: 'text', text: decodeEntities(p) });
    }
  }
  return tokens;
};

const htmlToRuns = (html: string): Run[] => {
  const tokens = tokenize(html || '');
  const runs: Run[] = [];
  const stack: TextStyle[] = [];
  let buf = '';
  let listType: 'ul' | 'ol' | null = null;
  let olCount = 0;

  const flush = () => {
    if (buf) {
      runs.push({ text: buf, styles: [...stack] });
      buf = '';
    }
  };

  for (const t of tokens) {
    if (t.type === 'text') {
      buf += t.text;
      continue;
    }
    const name = t.name!;
    if (t.type === 'open') {
      if (INLINE_STYLES[name]) {
        flush();
        stack.push(INLINE_STYLES[name]);
      } else if (HEADING_STYLES[name]) {
        flush();
        stack.push(HEADING_STYLES[name]);
      } else if (name === 'ul') {
        listType = 'ul';
        flush();
      } else if (name === 'ol') {
        listType = 'ol';
        olCount = 0;
        flush();
      } else if (name === 'li') {
        flush();
        buf += listType === 'ol' ? `${++olCount}. ` : '•  ';
      } else if (name === 'br') {
        buf += '\n';
      } else if (name === 'img') {
        buf += ' [Foto] ';
      }
    } else {
      if (INLINE_STYLES[name]) {
        flush();
        const idx = stack.lastIndexOf(INLINE_STYLES[name]);
        if (idx >= 0) stack.splice(idx, 1);
      } else if (HEADING_STYLES[name]) {
        flush();
        const idx = stack.lastIndexOf(HEADING_STYLES[name]);
        if (idx >= 0) stack.splice(idx, 1);
        buf += '\n';
      } else if (name === 'ul' || name === 'ol') {
        listType = null;
        olCount = 0;
      } else if (name === 'li' || name === 'p' || name === 'div') {
        buf += '\n';
      }
    }
  }
  flush();
  return runs;
};

interface RichTextProps {
  html?: string;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
}

export default function RichText({ html = '', style, numberOfLines, ellipsizeMode }: RichTextProps) {
  let runs: Run[];
  try {
    runs = htmlToRuns(limparAnexos(html));
  } catch {
    runs = [
      { text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), styles: [] },
    ];
  }

  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
      {runs.map((r, i) =>
        r.styles.length ? (
          <Text key={i} style={r.styles}>
            {r.text}
          </Text>
        ) : (
          r.text
        )
      )}
    </Text>
  );
}
