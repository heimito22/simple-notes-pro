// Copia instalador/portatil do desktop para a Area de Trabalho com nome versionado.
// Uso: npm run publicar  (dentro de desktop/) ou node scripts/publicar.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function desktopPath() {
  try {
    const out = execSync('powershell.exe -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"', { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  const cand = path.join(os.homedir(), 'Desktop');
  if (fs.existsSync(cand)) return cand;
  return cand;
}

function copiarComRetry(origem, destino, tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    try {
      // Se já existe e pode estar bloqueado por Explorer/antivírus, tenta remover primeiro
      if (fs.existsSync(destino)) {
        try { fs.unlinkSync(destino); } catch {}
      }
      fs.copyFileSync(origem, destino);
      return true;
    } catch (e) {
      if (e && e.code === 'EBUSY' && i < tentativas - 1) {
        // Espera exponencial 300ms, 600ms, 1.2s, 2.4s
        const ms = 300 * Math.pow(2, i);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
        continue;
      }
      throw e;
    }
  }
  return false;
}

const raiz = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const versao = pkg.version || '0.0.0';
const desktop = desktopPath();

// Artefatos gerados por electron-builder em desktop/release/
const itens = [
  { origem: path.join(raiz, 'release', `Simple-Notes-Pro-Setup-v${versao}.exe`), destinoNome: `Simple-Notes-Pro-Setup-v${versao}.exe` },
  { origem: path.join(raiz, 'release', `Simple-Notes-Pro-Portable-v${versao}.exe`), destinoNome: `Simple-Notes-Pro-Portable-v${versao}.exe` },
];

let ok = 0;
for (const it of itens) {
  if (!fs.existsSync(it.origem)) { console.log(`[publicar] nao encontrado: ${it.origem} (rode npm run dist antes)`); continue; }
  const dest = path.join(desktop, it.destinoNome);
  try {
    copiarComRetry(it.origem, dest);
  } catch (e) {
    console.error(`[publicar] falha ao copiar ${it.origem} -> ${dest}: ${e.message} (${e.code || ''})`);
    continue;
  }
  const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  const iguais = fs.statSync(it.origem).size === fs.statSync(dest).size;
  console.log(`[publicar] -> ${dest} (${mb} MB) byte-igual:${iguais}`);
  if (!iguais) console.error(`[publicar] ERRO byte-diferente: ${it.origem}`);
  else ok++;
}
if (!ok) { console.error('[publicar] nada copiado — verifique desktop/release/'); process.exit(1); }
console.log(`[publicar] pronto — v${versao} na Area de Trabalho (${ok} arquivo(s)).`);
