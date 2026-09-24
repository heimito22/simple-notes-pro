// Copia AAB/APK da build release para a Area de Trabalho com nome versionado.
// Uso: node scripts/publicar-desktop.js  (chamado automaticamente apos gradle bundleRelease)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function desktopPath() {
  // Tenta via PowerShell (OneDrive pode mover a Desktop) — aspas simples sao obrigatorias no PowerShell
  try {
    const out = execSync('powershell.exe -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"', { encoding: 'utf8' }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  const cand = path.join(os.homedir(), 'Desktop');
  if (fs.existsSync(cand)) return cand;
  return cand;
}

const raiz = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(raiz, 'app.json'), 'utf8'));
const versao = appJson.expo.version || '0.0.0';
const gradle = fs.readFileSync(path.join(raiz, 'android/app/build.gradle'), 'utf8');
const m = gradle.match(/versionCode\s+(\d+)/);
const vc = m ? m[1] : '0';

const desktop = desktopPath();
const aabOrigem = path.join(raiz, 'android/app/build/outputs/bundle/release/app-release.aab');
const apkOrigem = path.join(raiz, 'android/app/build/outputs/apk/release/app-release.apk');

let copiados = 0;
for (const [origem, ext] of [[aabOrigem, 'aab'], [apkOrigem, 'apk']]) {
  if (!fs.existsSync(origem)) {
    console.log(`[publicar-desktop] nao encontrado: ${origem} (rode gradle bundleRelease antes)`);
    continue;
  }
  const destino = path.join(desktop, `Simple-Notes-Pro-v${versao}-${vc}.${ext}`);
  fs.copyFileSync(origem, destino);
  const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
  console.log(`[publicar-desktop] -> ${destino} (${mb} MB)`);
  copiados++;
}
if (copiados === 0) process.exit(1);
console.log(`[publicar-desktop] pronto — v${versao} (${vc}) na Area de Trabalho.`);
