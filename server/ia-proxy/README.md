# Proxy da IA — deploy em ~5 minutos (sem CLI, sem cartão)

O Worker guarda a chave do OpenRouter no servidor e só responde a quem tem
login Google válido. O APK nunca vê a chave.

## 1. Criar o Worker
1. Abra https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker**.
2. Nome: `simple-notes-ia` → **Deploy**.
3. **Edit code** → apague o conteúdo → cole `worker.js` → **Deploy**.

## 2. Configurar os segredos
No Worker → **Settings** → **Variables and Secrets**:

| Nome | Tipo | Valor |
|---|---|---|
| `OPENROUTER_KEY` | Secret | sua chave `sk-or-v1-...` |
| `GOOGLE_CLIENT_ID` | Text (opcional) | o client ID do app (recomendado) |
| `MODELS` | Text (opcional) | `openrouter/free` (padrão) |

Se `GOOGLE_CLIENT_ID` for definido, só tokens emitidos para o app entram.

## 3. Ligar no app
Copie a URL do Worker (`https://simple-notes-ia.SEUNOME.workers.dev`) e cole em
`C:\MinhasNotas\constants\ia-proxy.ts`:

```ts
export const URL_PROXY_IA = 'https://simple-notes-ia.SEUNOME.workers.dev';
```

Gere um build novo. Sem chave própria, o app usa esse servidor automaticamente;
com chave própria em Ajustes → IA, continua ilimitado e direto.

## Limites (importante)
- Cota do Worker: 120 mensagens/dia por conta Google, 4000/dia no total.
- **OpenRouter:** modelos `:free` têm limite de **50 req/dia** enquanto a conta
  tiver menos de US$ 10 de crédito; a partir de US$ 10 sobe para **1000/dia**.
  Se quiser fôlego, coloque um modelo barato pago em `MODELS` (ex.:
  `deepseek/deepseek-chat-v3.1`) e use o free como reserva:
  `MODELS=deepseek/deepseek-chat-v3.1,openrouter/free`.
- Se a chave vazar (foi colada em chat, por exemplo), **rotacione** em
  https://openrouter.ai/keys e atualize o secret.

## Teste rápido (PowerShell)

```powershell
$token = "<access token do Google do app>"
Invoke-RestMethod -Method Post -Uri "https://simple-notes-ia.SEUNOME.workers.dev" `
  -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' `
  -Body '{"messages":[{"role":"user","content":"diga oi"}],"max_tokens":50}'
```
