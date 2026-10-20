/**
 * Proxy da IA do Simple Notes (Cloudflare Worker).
 *
 * Problema que resolve: o app hoje exige que o usuário crie uma chave no
 * OpenRouter. Leigos param aí. Aqui a chave fica SÓ no servidor e o app usa
 * a IA pronta, autenticando com o login Google que ele já tem.
 *
 * Segurança:
 *  - A chave NUNCA vai para o APK (fica em variável secreta do Worker).
 *  - Toda requisição precisa de um access token do Google válido.
 *  - Cota por usuário/dia e cota global/dia (em memória do isolate — reset
 *    quando o Worker recicla; suficiente para frear abuso casual).
 *
 * Deploy: veja README.md nesta pasta.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TOKENINFO_URL = 'https://www.googleapis.com/oauth2/v3/tokeninfo';

const LIMITE_USUARIO_DIA = 120;
const LIMITE_GLOBAL_DIA = 4000;

const estado = { dia: '', porUsuario: new Map(), total: 0 };

function hojeUTC() {
  return new Date().toISOString().slice(0, 10);
}

function resetarSeVirouODia() {
  const dia = hojeUTC();
  if (estado.dia !== dia) {
    estado.dia = dia;
    estado.porUsuario.clear();
    estado.total = 0;
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

function json(corpo, status) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

async function usuarioDoToken(accessToken, clientIdEsperado) {
  const res = await fetch(
    `${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const dados = await res.json().catch(() => null);
  if (!dados || !dados.sub) return null;
  if (Number(dados.expires_in || 0) <= 0) return null;
  if (clientIdEsperado && dados.aud && dados.aud !== clientIdEsperado) return null;
  return { sub: String(dados.sub), email: String(dados.email || '') };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'POST') return json({ error: { message: 'Use POST.' } }, 405);

    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json({ error: { message: 'login_necessario' } }, 401);

    const usuario = await usuarioDoToken(token, env.GOOGLE_CLIENT_ID || '');
    if (!usuario) return json({ error: { message: 'token_invalido' } }, 401);

    resetarSeVirouODia();
    const usado = estado.porUsuario.get(usuario.sub) || 0;
    if (usado >= LIMITE_USUARIO_DIA) {
      return json({ error: { message: 'limite_diario', limite: LIMITE_USUARIO_DIA } }, 429);
    }
    if (estado.total >= LIMITE_GLOBAL_DIA) {
      return json({ error: { message: 'limite_global' } }, 429);
    }

    let corpo;
    try {
      corpo = await request.json();
    } catch {
      return json({ error: { message: 'json_invalido' } }, 400);
    }
    const messages = Array.isArray(corpo?.messages) ? corpo.messages : null;
    if (!messages || !messages.length) return json({ error: { message: 'messages_obrigatorio' } }, 400);

    const chave = env.OPENROUTER_KEY;
    if (!chave) return json({ error: { message: 'servidor_sem_chave' } }, 500);

    // Modelos: lista separada por vírgula em MODELS (o 1º é o padrão).
    const modelos = String(env.MODELS || 'openrouter/free')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    const teto = Math.min(Number(corpo?.max_tokens) || 400, 8000);
    const temperatura = Number.isFinite(Number(corpo?.temperature)) ? Number(corpo.temperature) : 0.7;

    let ultimoStatus = 502;
    let ultimoErro = 'sem_resposta';

    for (const modelo of modelos) {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${chave}`,
          'HTTP-Referer': 'https://simple-note-web.vercel.app',
          'X-Title': 'Simple Notes',
        },
        body: JSON.stringify({
          model: modelo,
          messages: messages.map((m) => ({
            role: String(m?.role || 'user'),
            content: [{ type: 'text', text: String(m?.content ?? '') }],
          })),
          temperature: temperatura,
          max_tokens: teto,
        }),
      });

      if (res.ok) {
        estado.porUsuario.set(usuario.sub, usado + 1);
        estado.total += 1;
        const dados = await res.text();
        return new Response(dados, {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...cors() },
        });
      }

      ultimoStatus = res.status === 401 || res.status === 402 ? 503 : res.status;
      ultimoErro = await res.text().catch(() => '');
      // 401/402 = problema de conta/chave: não adianta tentar outro modelo.
      if (res.status === 401 || res.status === 402) break;
    }

    return json(
      { error: { message: 'openrouter_falhou', status: ultimoStatus, detalhe: String(ultimoErro).slice(0, 300) } },
      ultimoStatus === 429 ? 429 : 502,
    );
  },
};
