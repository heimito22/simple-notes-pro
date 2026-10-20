/**
 * Endereço do PROXY da IA (Cloudflare Worker em server/ia-proxy).
 *
 * É o que permite a IA funcionar sem o usuário colar chave nenhuma: o app
 * manda a conversa para este endereço, o Worker valida o login Google e
 * chama o OpenRouter com a chave que fica SÓ no servidor (nunca no APK).
 *
 * Vazio = recurso desligado (o app pede a chave própria, como antes).
 * Depois do deploy do Worker, cole aqui a URL (sem barra no fim) e gere um
 * build novo — ex.: 'https://simple-notes-ia.SEUNOME.workers.dev'.
 */
export const URL_PROXY_IA = '';

/** true quando existe servidor configurado (IA pronta, sem chave do usuário). */
export const PROXY_IA_ATIVO = URL_PROXY_IA.length > 0;
