// Gera desktop/src/ui/i18n-dict.js a partir do context/idiomas.ts.
// Fonte única: o mesmo dicionário do celular traduz o PC. Rodar sempre que
// context/idiomas.ts mudar (npm run build:desktop chama este script antes).
const fs = require('fs');
const path = require('path');

const FONTE = path.join(__dirname, '..', '..', 'context', 'idiomas.ts');
const DESTINO = path.join(__dirname, '..', 'src', 'ui', 'i18n-dict.js');

const src = fs.readFileSync(FONTE, 'utf8');

// Extrai `const <nome>: Record<string,string> = { ... };` com chaveamento por profundidade
function pegaObj(nome) {
  const i = src.indexOf('const ' + nome + ':');
  if (i < 0) throw new Error('objeto ' + nome + ' não encontrado em idiomas.ts');
  const j = src.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  throw new Error('fim do objeto ' + nome + ' não encontrado');
}

const js = [
  '// GERADO por scripts/gerar-i18n.js — NÃO editar à mão.',
  '// Fonte: context/idiomas.ts (mesmo dicionário do celular).',
  'const PT = ' + pegaObj('pt') + ';',
  'const EN = ' + pegaObj('en') + ';',
  'const ES = ' + pegaObj('es') + ';',
  'window.I18N_DICT = { pt: PT, en: EN, es: ES };',
].join('\n');

fs.writeFileSync(DESTINO, js, 'utf8');

// sanity: carrega e conta chaves
const check = { pt: null, en: null, es: null };
global.window = {};
new Function(js)();
check.pt = Object.keys(window.I18N_DICT.pt).length;
check.en = Object.keys(window.I18N_DICT.en).length;
check.es = Object.keys(window.I18N_DICT.es).length;
console.log('[i18n] i18n-dict.js gerado:', JSON.stringify(check));
if (!check.pt || !check.en || !check.es) { console.error('[i18n] dicionário vazio!'); process.exit(1); }
