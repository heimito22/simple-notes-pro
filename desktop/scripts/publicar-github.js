// Publica os .exe do desktop como GitHub Release — grátis, sem limite de downloads.
// É o que o site busca automaticamente (seção Downloads).
//
// SETUP ÚNICO (só 1 vez):
//   1. Crie um repositório PÚBLICO no GitHub (ex: simple-notes-pro)
//   2. Gere um token em https://github.com/settings/tokens (scope "repo")
//   3. Rode:  setx GITHUB_REPO "SEUUSUARIO/simple-notes-pro"
//            setx GITHUB_TOKEN "ghp_..."
//   (feche e reabra o terminal depois do setx)
//
// USO (a cada versão nova):
//   npm run dist           (gera os .exe em desktop/release)
//   npm run publicar-github (cria a release v{versão} e sobe os arquivos)
//
const fs = require('fs');
const path = require('path');
const https = require('https');

const raiz = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const versao = pkg.version || '0.0.0';
const tag = 'v' + versao;

const repo = process.env.GITHUB_REPO;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token) {
  console.error('[github] Configure GITHUB_REPO e GITHUB_TOKEN (veja o topo deste arquivo).');
  process.exit(1);
}

const artefatos = [
  // Nomes EXATOS do output do builder — o latest.yml referencia esses nomes,
  // e o electron-updater baixa de releases/download/{tag}/{nome}. Sem renomear.
  { origem: path.join(raiz, 'release', `Simple-Notes-Pro-Setup-v${versao}.exe`), nome: `Simple-Notes-Pro-Setup-v${versao}.exe` },
  { origem: path.join(raiz, 'release', `Simple-Notes-Pro-Portable-v${versao}.exe`), nome: `Simple-Notes-Pro-Portable-v${versao}.exe` },
  // Obrigatório para o auto-update (electron-updater lê este arquivo):
  { origem: path.join(raiz, 'release', 'latest.yml'), nome: 'latest.yml' },
  // Blockmap: atualização diferencial (baixa só o que mudou, muito menor)
  { origem: path.join(raiz, 'release', `Simple-Notes-Pro-Setup-v${versao}.exe.blockmap`), nome: `Simple-Notes-Pro-Setup-v${versao}.exe.blockmap` },
];

function requisicao(opcoes, corpo) {
  return new Promise((res, rej) => {
    const req = https.request(opcoes, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => res({ status: r.statusCode, corpo: d }));
    });
    req.on('error', rej);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function json(opcoes, corpoObj) {
  const corpo = corpoObj ? JSON.stringify(corpoObj) : null;
  const o = Object.assign({}, opcoes, {
    headers: Object.assign({
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'simple-notes-pro-desktop',
      'Accept': 'application/vnd.github+json',
      'Content-Length': corpo ? Buffer.byteLength(corpo) : 0,
    }, opcoes.headers || {}),
  });
  return requisicao(o, corpo);
}

async function releaseJaExiste() {
  const r = await json({ hostname: 'api.github.com', path: `/repos/${repo}/releases/tags/${tag}`, method: 'GET' });
  if (r.status === 200) return JSON.parse(r.corpo);
  return null;
}

async function criarRelease(nota) {
  const r = await json({ hostname: 'api.github.com', path: `/repos/${repo}/releases`, method: 'POST' }, {
    tag_name: tag,
    target_commitish: 'main',
    name: `Simple Notes Pro ${tag}`,
    body: nota || `Versão ${versao}`,
    draft: false,
    prerelease: false,
  });
  if (r.status !== 201) throw new Error(`Falha ao criar release (${r.status}): ${r.corpo.slice(0, 300)}`);
  return JSON.parse(r.corpo);
}

async function subirAsset(uploadUrlBase, arquivo) {
  const uploadUrl = uploadUrlBase.split('{')[0] + '?name=' + encodeURIComponent(arquivo.nome);
  const dados = fs.readFileSync(arquivo.origem);
  const r = await requisicao({
    hostname: 'uploads.github.com',
    path: uploadUrl.replace('https://uploads.github.com', ''),
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'simple-notes-pro-desktop',
      'Content-Type': 'application/octet-stream',
      'Content-Length': dados.length,
    },
  }, dados);
  if (r.status !== 201) throw new Error(`Falha ao subir ${arquivo.nome} (${r.status}): ${r.corpo.slice(0, 300)}`);
  return JSON.parse(r.corpo);
}

(async () => {
  try {
    for (const a of artefatos) {
      if (!fs.existsSync(a.origem)) {
        console.error(`[github] não encontrado: ${a.origem} (rode npm run dist antes)`);
        process.exit(1);
      }
    }
    let rel = await releaseJaExiste();
    if (rel) {
      console.log(`[github] release ${tag} já existe — reutilizando.`);
    } else {
      rel = await criarRelease(`**Versão ${versao}**\n\n- Downloads para Windows (instalador e portátil)\n- Atualize baixando o novo instalador`);
      console.log(`[github] release ${tag} criada.`);
    }
    for (const a of artefatos) {
      const asset = await subirAsset(rel.upload_url, a);
      const mb = (fs.statSync(a.origem).size / 1024 / 1024).toFixed(1);
      console.log(`[github] -> ${asset.browser_download_url} (${mb} MB)`);
    }
    console.log('[github] pronto! O site mostra esta versão automaticamente.');
  } catch (e) {
    console.error('[github] ERRO:', e.message);
    process.exit(1);
  }
})();
