// Driver de playtest via CDP (Chrome DevTools Protocol): conecta no webview do
// app (snapp://) exposto em --remote-debugging-port=9222 e roda JS/teclas.
// Uso: node playtest.js <arquivo-de-passo.json>
// O arquivo de passos é um JSON: [{ "expr": "..." }, ...] — cada expr roda no
// guest e o resultado vira stdout.
const http = require('http');
const WebSocket = require('ws');

function alvoWebview() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', res => {
      let dados = '';
      res.on('data', c => { dados += c; });
      res.on('end', () => {
        const alvos = JSON.parse(dados);
        const webview = alvos.find(a => a.type === 'webview' && a.url.startsWith('snapp://'));
        webview ? resolve(webview) : reject(new Error('webview snapp:// não encontrado'));
      });
    }).on('error', reject);
  });
}

async function main() {
  const passos = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  const alvo = await alvoWebview();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl, { perMessageDeflate: false });
  let idMsg = 0;
  const pendentes = new Map();

  const enviar = (metodo, params = {}) => new Promise((resolve, reject) => {
    const id = ++idMsg;
    pendentes.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: metodo, params }));
  });

  ws.on('message', bruto => {
    const msg = JSON.parse(bruto);
    if (msg.id && pendentes.has(msg.id)) {
      const { resolve, reject } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });

  await new Promise(r => ws.on('open', r));

  // Habilita o domínio Runtime para avaliar expressões
  await enviar('Runtime.enable');

  for (const passo of passos) {
    try {
      const r = await enviar('Runtime.evaluate', {
        expression: passo.expr,
        awaitPromise: true,
        returnByValue: true,
      });
      const valor = r.result?.value !== undefined ? r.result.value : JSON.stringify(r.result);
      console.log(`[${passo.nome || passo.expr.slice(0, 50)}] →`, typeof valor === 'string' ? valor.slice(0, 400) : JSON.stringify(valor)?.slice(0, 400));
    } catch (e) {
      console.log(`[${passo.nome || passo.expr.slice(0, 50)}] ERRO →`, e.message.slice(0, 300));
    }
    if (passo.esperaMs) await new Promise(r => setTimeout(r, passo.esperaMs));
  }

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
