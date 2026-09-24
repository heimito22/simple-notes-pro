// Simple Notes Pro — Desktop: autenticação Google via loopback OAuth.
// Funciona com client tipo "Aplicativo para computador" (Desktop) — recomendado.
// Esse tipo NÃO tem campo de URIs no Console e aceita qualquer http://127.0.0.1:{porta}/
const { shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORTA_FIXA = 42813;
// Credenciais lidas de desktop/client_id.txt e desktop/client_secret.txt
// (fora do git via .gitignore) — nunca hardcoded.
const SCOPES = ['openid','email','profile','https://www.googleapis.com/auth/drive.appdata'];

function userDataDir(){
  try{ const {app}=require('electron'); return app.getPath('userData'); }catch{ return path.join(os.tmpdir(),'simple-notes-pro-desktop','userData'); }
}
function candidatosBase() {
  const out = [];
  try { out.push(userDataDir()); } catch {}
  try { const { app } = require('electron'); out.push(path.join(app.getPath('userData'), '..')); } catch {}
  try { out.push(path.join(__dirname, '..')); } catch {}
  try { out.push(path.join(process.resourcesPath || '', 'app')); } catch {}
  try { out.push(path.dirname(process.execPath)); } catch {}
  try { out.push(path.join(os.homedir(), '.simple-notes-pro')); } catch {}
  return out.filter(Boolean);
}
function lerArquivoCandidato(nome) {
  for (const base of candidatosBase()) {
    try {
      const p = path.join(base, nome);
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v) return { valor: v, caminho: p };
      }
    } catch {}
  }
  try {
    const p = path.join(__dirname, '..', nome);
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return { valor: v, caminho: p };
    }
  } catch {}
  return null;
}
function lerClientId() {
  const hit = lerArquivoCandidato('client_id.txt');
  return hit ? hit.valor : null;
}
function lerClientSecret() {
  const hit = lerArquivoCandidato('client_secret.txt');
  return hit && hit.valor ? hit.valor : null;
}
function caminhoClientSecret() {
  const hit = lerArquivoCandidato('client_secret.txt');
  return hit ? hit.caminho : path.join(__dirname, '..', 'client_secret.txt');
}
function redirectUriFixo() { return `http://127.0.0.1:${PORTA_FIXA}/`; }
function obterInfo() {
  const cid = lerClientId();
  const sec = lerClientSecret();
  if (!cid || !sec) {
    console.error('[auth] credenciais Google ausentes — crie desktop/client_id.txt e desktop/client_secret.txt (conteudo: um por linha)');
  }
  return {
    clientId: cid,
    temSecret: !!sec,
    redirectUriFixo: redirectUriFixo(),
    portaFixa: PORTA_FIXA,
    caminhoSecret: caminhoClientSecret(),
  };
}
function salvarSessao(usuario) {
  const payload = JSON.stringify(usuario, null, 1);
  let ok=false;
  try { const p=path.join(userDataDir(),'sessao.json'); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p, payload,'utf8'); ok=true; } catch(e){ console.error('[auth] salvar userData falhou', e && e.message); }
  // compat: também grava nos legados para quem atualizou de versão antiga
  try { fs.writeFileSync(path.join(__dirname, '..', 'sessao.json'), payload, 'utf8'); } catch {}
  if(!ok) console.error('[auth] nenhuma escrita de sessao funcionou');
}
function carregarSessao() {
  try{ const p=path.join(userDataDir(),'sessao.json'); if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8')); }catch{}
  const nomes = ['sessao.json'];
  for (const base of candidatosBase()) {
    for (const n of nomes) {
      try {
        const p = path.join(base, n);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {}
    }
  }
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sessao.json'), 'utf8')); } catch { return null; }
}
function apagarSessao() {
  try{ fs.unlinkSync(path.join(userDataDir(),'sessao.json')); }catch{}
  for (const base of candidatosBase()) {
    try { fs.unlinkSync(path.join(base, 'sessao.json')); } catch {}
  }
  try { fs.unlinkSync(path.join(__dirname, '..', 'sessao.json')); } catch {}
}

async function escutarPorta(servidor) {
  const tenta = (porta) => new Promise((res, rej) => {
    const onErr = (e) => { servidor.removeListener('listening', onOk); rej(e); };
    const onOk = () => { servidor.removeListener('error', onErr); res(servidor.address().port); };
    servidor.once('error', onErr);
    servidor.once('listening', onOk);
    servidor.listen(porta, '127.0.0.1');
  });
  try {
    const p = await tenta(PORTA_FIXA);
    return p;
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') {
      const p2 = await tenta(0);
      return p2;
    }
    throw e;
  }
}

async function entrarComGoogle() {
  const info = obterInfo();
  const clientId = info.clientId;
  const clientSecret = lerClientSecret();
  if (!clientSecret) {
    throw new Error(
      'Falta o arquivo client_secret.txt em: ' + info.caminhoSecret +
      ' — cole nele apenas o Client Secret do seu OAuth Desktop (s21f5t6...). O tipo "Aplicativo para computador" NÃO tem campo de URIs no Console, é normal — não precisa cadastrar redirect URI manualmente.'
    );
  }
  if (!clientId || !clientId.includes('.apps.googleusercontent.com')) {
    throw new Error('client_id.txt inválido: esperado algo como 123...apps.googleusercontent.com. Atual: ' + String(clientId).slice(0, 80));
  }

  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const estado = crypto.randomBytes(16).toString('hex');

  const servidor = http.createServer();
  const porta = await escutarPorta(servidor);
  const redirectUri = `http://127.0.0.1:${porta}/`;
  const isFixa = porta === PORTA_FIXA;

  const urlAutorizacao = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  urlAutorizacao.searchParams.set('client_id', clientId);
  urlAutorizacao.searchParams.set('redirect_uri', redirectUri);
  urlAutorizacao.searchParams.set('response_type', 'code');
  urlAutorizacao.searchParams.set('scope', SCOPES.join(' '));
  urlAutorizacao.searchParams.set('code_challenge', challenge);
  urlAutorizacao.searchParams.set('code_challenge_method', 'S256');
  urlAutorizacao.searchParams.set('state', estado);
  urlAutorizacao.searchParams.set('access_type', 'offline');
  urlAutorizacao.searchParams.set('prompt', 'consent');

  const resultado = await new Promise((resolve, reject) => {
    let resolvido = false;
    const finalizar = (r) => { if (!resolvido) { resolvido = true; try{ servidor.close(); }catch{} resolve(r); } };
    const falhar = (e) => { if (!resolvido) { resolvido = true; try{ servidor.close(); }catch{} reject(e); } };
    const timer = setTimeout(() => {
      let msg = 'Tempo esgotado aguardando o navegador voltar para ' + redirectUri + '. ';
      if (!isFixa) {
        msg += 'A porta ' + PORTA_FIXA + ' estava ocupada e o app usou ' + porta + '. Com client Desktop (s21f5t6...) qualquer porta funciona — feche o programa que está usando a ' + PORTA_FIXA + ' ou continue assim, vai funcionar.';
      } else {
        msg += 'Verifique se o navegador abriu a página de login do Google. Se o erro foi 400 redirect_uri_mismatch, é porque o client é do tipo Web — crie um do tipo "Aplicativo para computador" no Console (ele não pede URIs).';
      }
      falhar(new Error(msg));
    }, 180000);
    servidor.on('request', (req, res) => {
      let u;
      try { u = new URL(req.url, redirectUri); } catch { res.writeHead(400); res.end(); return; }
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      clearTimeout(timer);
      if (u.searchParams.get('state') !== estado) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px">Estado inválido. Feche esta aba e tente novamente no app.</body>');
        // não finaliza — aguarda o redirect correto (evita travar em falsos favicons sem state)
        return;
      }
      const erro = u.searchParams.get('error');
      const codigo = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (erro) {
        res.end('<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px"><h2>Login cancelado ('+String(erro).slice(0,60)+').</h2><p>Pode fechar esta aba.</p></body>');
        finalizar({ type: 'cancelled', erro }); return;
      }
      if (!codigo) { res.end('<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px"><h2>Sem código de autorização.</h2><p>Feche e tente novamente.</p></body>'); finalizar({ type: 'cancelled' }); return; }
      res.end('<body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px"><h2>Login concluído.</h2><p>Pode fechar esta aba e voltar ao Simple Notes Pro.</p></body>');
      finalizar({ type: 'success', codigo });
    });
    servidor.on('error', (e) => { clearTimeout(timer); falhar(e); });
    shell.openExternal(urlAutorizacao.toString()).catch((e) => { clearTimeout(timer); falhar(e); });
  });

  if (resultado.type !== 'success') return { type: 'cancelled' };

  const corpoToken = new URLSearchParams({
    code: resultado.codigo,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const respostaToken = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpoToken.toString(),
  });
  const tokens = await respostaToken.json().catch(() => ({}));
  if (!tokens.access_token) {
    const detalhe = JSON.stringify(tokens).slice(0, 900);
    if (detalhe.includes('redirect_uri_mismatch') || detalhe.includes('redirect_uri')) {
      throw new Error(
        'Erro do Google: ' + detalhe +
        ' | O client Desktop (s21f5t6...) NÃO precisa de URIs cadastradas — se você criou um client Web por engano, apague e crie um "Aplicativo para computador". Se já é Desktop e deu mismatch, apenas gere o instalador de novo (a porta pode ter mudado).'
      );
    }
    throw new Error('Falha ao trocar código por tokens: ' + detalhe);
  }

  const respostaPerfil = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + tokens.access_token },
  });
  const perfil = await respostaPerfil.json().catch(() => ({}));
  if (!perfil.sub) throw new Error('Não foi possível ler o perfil da conta: ' + JSON.stringify(perfil).slice(0, 300));

  const usuario = {
    user: { id: perfil.sub, name: perfil.name || null, email: perfil.email || '', photo: perfil.picture || null, familyName: perfil.family_name || null, givenName: perfil.given_name || null },
    scopes: SCOPES, idToken: tokens.id_token || null, serverAuthCode: null,
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null,
    expiraEm: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
  salvarSessao(usuario);
  // verifica que gravou
  const check = carregarSessao();
  if(!check || !check.user || !check.user.email) console.error('[auth] sessao gravada mas leitura falhou', check);
  return { type: 'success', data: usuario };
}

async function tokenDeAcesso() {
  const sessao = carregarSessao();
  if (!sessao) throw new Error('Sem sessão. Faça login novamente.');
  if (sessao.accessToken && sessao.expiraEm && sessao.expiraEm > Date.now() + 30000) return sessao.accessToken;
  if (!sessao.refreshToken) throw new Error('Sessão sem refresh token — faça login novamente (access_type=offline). Faça logout e conecte de novo.');
  const cid = lerClientId();
  const corpo = new URLSearchParams({ client_id: cid, client_secret: lerClientSecret() || '', refresh_token: sessao.refreshToken, grant_type: 'refresh_token' });
  const resposta = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo.toString(), signal: AbortSignal.timeout(20000) });
  const dados = await resposta.json().catch(() => ({}));
  if (!dados.access_token) throw new Error('Falha ao renovar token: ' + JSON.stringify(dados).slice(0, 400));
  sessao.accessToken = dados.access_token; sessao.expiraEm = Date.now() + (dados.expires_in || 3600) * 1000;
  if(dados.refresh_token) sessao.refreshToken = dados.refresh_token;
  salvarSessao(sessao); return sessao.accessToken;
}

module.exports = { entrarComGoogle, tokenDeAcesso, carregarSessao, apagarSessao, obterInfo, redirectUriFixo, salvarSessao };
