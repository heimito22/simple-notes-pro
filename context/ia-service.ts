// ============================================================================
// SERVIÇO DE IA HÍBRIDO — "ChatGPT leve" para as notas.
//
// Modo ONLINE (chave configurada): chama a API do OpenRouter (modelos
// gratuitos, auto-router "openrouter/free") passando as notas do usuário
// como contexto — respostas geradas de verdade, como um ChatGPT. A IA
// recebe TODAS as notas (não só trechos com palavras exatas), então ela
// entende o contexto e consegue conversar sobre qualquer assunto das notas.
// Modo OFFLINE (sem chave): usa a busca local por relevância (ia-notas.ts)
// e responde com os trechos encontrados.
//
// Fora do escopo: a IA só responde sobre as notas. Se a pergunta não tiver
// relação com nenhuma nota, ela avisa que só pode ajudar com as notas.
// ============================================================================

import { buscarResposta, limparTexto } from './ia-notas';

export interface MensagemChat {
  papel: 'usuario' | 'ia';
  texto: string;
  erro?: boolean;
}

export interface RespostaChat {
  texto: string;
  modo: 'online' | 'offline' | 'fora';
}

const URL_API = 'https://openrouter.ai/api/v1/chat/completions';

// Limites para manter a resposta rápida e dentro do token dos modelos grátis.
const MAX_NOTAS_CONTEXTO = 8;       // máx. de notas enviadas à IA
const MAX_CHARS_NOTA = 400;         // máx. de caracteres de cada nota no contexto
const MAX_TRECHOS_LOCAIS = 3;       // trechos usados no modo offline

// ============================================================================
// RECURSOS REAIS DO APP — a IA (online e offline) só pode citar o que está
// AQUI. Nunca invente funções: o Simple Notes não exporta PDF, não tem versão
// web, não sincroniza com outros serviços, etc.
// ============================================================================
const RECURSOS_DO_APP = [
  'Notas com editor rico (negrito, itálico, sublinhado, listas, citação, títulos e links)',
  'Anexos de imagem e gravação de áudio nas notas',
  'Botão flutuante "ir para o fim" (seta em círculo) em notas com anexos grandes',
  'Lembretes de nota: em data/hora, a cada X dias ou em dias da semana (disparam alarme em tela cheia)',
  'Alarme em tela cheia com som próprio, soneca (5 a 60 min) e volume de alarme forçado',
  'Tarefas com recorrência (uma vez, diária ou em dias específicos) e horário, com notificação',
  'Login com conta Google e backup automático no Drive (notas, tarefas e chave de IA)',
  'Ajustes: modo escuro, som/soneca/permissões do alarme, remover anúncios (pagamento único na Play Store), premium por convite, chave de IA gratuita (OpenRouter) e bloqueio com biometria',
].join(' · ');

// FAQ local (modo offline, sem chave): perguntas sobre o PRÓPRIO app respondidas
// com a lista oficial de recursos — nunca com invenções.
const FAQ_APP: { palavras: string[]; resposta: string }[] = [
  {
    palavras: ['exportar', 'pdf', 'compartilhar', 'imprimir'],
    resposta: 'Esse recurso não existe no Simple Notes: o app não exporta nem compartilha notas. Ele salva tudo automaticamente na sua conta Google (Drive). ✨',
  },
  {
    palavras: ['anuncio', 'anúncio', 'anuncios', 'anúncios', 'premium', 'assinatura', 'remover anuncio', 'remover anúncio'],
    resposta: 'Sim! Em Ajustes → Anúncios há "Remover anúncios para sempre" (pagamento único pela Play Store). Também existe o Premium liberado por convite do desenvolvedor.',
  },
  {
    palavras: ['modo escuro', 'modo claro', 'tema escuro', 'tema claro', 'tema do app', 'dark'],
    resposta: 'Sim! Em Ajustes → Aparência você alterna o Modo Escuro.',
  },
  {
    palavras: ['som do alarme', 'soneca', 'permissão do alarme', 'permissao do alarme', 'alarme'],
    resposta: 'Em Ajustes → Alarme você escolhe o som do alarme, ajusta a soneca (5 a 60 min) e confere as permissões (popup em tela cheia, Xiaomi e bateria).',
  },
  {
    palavras: ['biometria', 'impressão digital', 'impressao digital', 'rosto', 'bloquear app', 'bloquear o app', 'trancar o app', 'bloqueio'],
    resposta: 'Em Ajustes → Segurança, o app pode exigir biometria (digital ou rosto) ao abrir, com tempo de bloqueio de imediato até 30 minutos.',
  },
  {
    palavras: ['backup', 'drive', 'google', 'sincroniz', 'restaurar', 'login', 'logar'],
    resposta: 'Entrando com sua conta Google, notas, tarefas e a chave de IA ficam salvas no Drive com backup automático — ao trocar de aparelho, entre com a mesma conta e tudo volta.',
  },
  {
    palavras: ['tarefa', 'tarefas', 'recorrência', 'recorrencia'],
    resposta: 'Na aba Tarefas você cria tarefas com recorrência (uma vez, diária ou em dias específicos) e horário, marca como concluída e exclui. Cada tarefa dispara uma notificação no horário.',
  },
  {
    palavras: ['lembrete', 'lembrar', 'sino'],
    resposta: 'Em cada nota, o ícone de sino agenda lembretes: em data e horário, a cada X dias ou em dias da semana. Quando toca, o alarme abre em tela cheia com som e soneca.',
  },
  {
    palavras: ['chave da ia', 'chave gratuita', 'chave do openrouter', 'openrouter', 'inteligência', 'inteligencia'],
    resposta: 'A IA fica em Ajustes → IA: adicione a chave gratuita do OpenRouter (há o tutorial "Como criar a chave") para respostas completas sobre suas notas. Sem chave, respondo com buscas locais nas suas notas.',
  },
  {
    palavras: ['imagem', 'foto', 'áudio', 'audio', 'gravar', 'gravação', 'gravacao', 'anexo'],
    resposta: 'No editor da nota você pode anexar imagens e gravar áudio. Em notas com anexos grandes, um botão (seta em círculo) leva você direto ao fim da nota.',
  },
];

/** Pergunta sobre o próprio app? Retorna a resposta local (ou null se não for). */
function respostaRecursoApp(pergunta: string): string | null {
  const p = pergunta.toLowerCase();
  for (const item of FAQ_APP) {
    if (item.palavras.some(w => p.includes(w))) return item.resposta;
  }
  return null;
}

/** Converte uma nota (HTML) em texto puro e truncado para o contexto. */
function notaParaTexto(nota: any): string {
  const limpo = limparTexto(String(nota.conteudo || ''));
  const titulo = String(nota.titulo || 'Sem título').trim();
  const corpo = limpo.length > MAX_CHARS_NOTA ? limpo.slice(0, MAX_CHARS_NOTA) + '…' : limpo;
  return corpo ? `• "${titulo}": ${corpo}` : `• "${titulo}" (sem conteúdo)`;
}

/**
 * Monta o contexto das notas. ONLINE: envia as notas mais recentes/relevantes
 * (a IA entende o todo). OFFLINE: envia só os trechos com palavras casadas.
 */
function montarContexto(notas: any[], pergunta: string, online: boolean): string {
  const todas = Array.isArray(notas) ? notas : [];
  if (todas.length === 0) return '';

  if (online) {
    // Ordena: primeiro as mais relevantes (palavras da pergunta), depois as recentes.
    const relevantes = buscarResposta(todas, pergunta, todas.length);
    const idsRelevantes = new Set(relevantes.trechos.map((t: any) => t.notaId));
    const ordenadas = [
      ...todas.filter((n: any) => idsRelevantes.has(n.id)),
      ...todas.filter((n: any) => !idsRelevantes.has(n.id)),
    ];
    return ordenadas
      .slice(0, MAX_NOTAS_CONTEXTO)
      .map(notaParaTexto)
      .join('\n');
  }

  // Modo offline: só os trechos com palavras casadas.
  const resultado = buscarResposta(todas, pergunta, MAX_TRECHOS_LOCAIS);
  if (!resultado.temResposta) return '';
  return resultado.trechos.map((t: any) => `• "${t.titulo}": ${t.frase}`).join('\n');
}

/**
 * Pergunta para a IA sobre as notas.
 * - Com chave + internet: resposta gerada pela API (modo 'online') — a IA
 *   recebe TODAS as notas e conversa naturalmente sobre elas.
 * - Sem chave/sem internet: resposta montada com a busca local (modo 'offline').
 * - Sem nenhuma nota salva: mensagem amigável.
 */
/**
 * Gera o resumo de UMA nota usando a IA online (requer chave configurada).
 * Sem chave, retorna uma mensagem orientando a configurar.
 */
export async function resumirNotaComIA(nota: any, chaveApi: string): Promise<RespostaChat> {
  if (!nota) {
    return { texto: 'Abra uma nota para eu resumir. ✍️', modo: 'fora' };
  }
  if (!chaveApi) {
    return {
      texto: 'Para resumir com IA, configure sua chave gratuita em Ajustes → IA. 🔑',
      modo: 'offline',
    };
  }

  const contexto = notaParaTexto(nota);
  const system = [
    'Você é o assistente do app de anotações "Simple Notes".',
    'Responda SEMPRE em português do Brasil.',
    'Gere um resumo curto e claro da nota do usuário (máx. ~120 palavras), destacando as informações mais importantes em tópicos quando fizer sentido.',
    'Não invente nem mencione recursos ou funções do aplicativo: o resumo deve falar apenas do conteúdo da nota.',
  ].join(' ');

  const messages: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: `Resuma esta nota:\n\n${contexto}` },
  ];

  try {
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chaveApi}`,
        'HTTP-Referer': 'https://simple-notes.app',
        'X-Title': 'Simple Notes',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages,
        temperature: 0.5,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      if (res.status === 401) {
        return { texto: 'A chave de IA configurada não é válida. Verifique em Ajustes → IA.', modo: 'offline' };
      }
      if (res.status === 429) {
        return { texto: 'A IA gratuita está com limite de uso no momento. Aguarde um minuto e tente de novo.', modo: 'offline' };
      }
      throw new Error(`API ${res.status}: ${corpo.slice(0, 120)}`);
    }

    const data = await res.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) throw new Error('Resposta vazia da API');
    return { texto, modo: 'online' };
  } catch (e) {
    console.warn('[IA] Erro no resumo online:', e);
    return {
      texto: 'Não consegui conectar à IA online agora. Verifique sua internet ou a chave em Ajustes → IA e tente de novo.',
      modo: 'offline',
    };
  }
}

export async function responderPergunta(
  pergunta: string,
  notas: any[],
  chaveApi: string,
  historico: MensagemChat[] = []
): Promise<RespostaChat> {
  const todas = Array.isArray(notas) ? notas : [];

  if (todas.length === 0) {
    // Sem notas: perguntas sobre o próprio app ainda são respondidas usando a
    // lista REAL de recursos — nada de invenção.
    if (!chaveApi) {
      const recurso = respostaRecursoApp(pergunta);
      if (recurso) return { texto: recurso, modo: 'offline' };
    }
    return {
      texto: 'Você ainda não tem nenhuma nota. Crie uma nota primeiro e depois me pergunte sobre ela! 📝✨',
      modo: 'fora',
    };
  }

  // --- Modo offline: sem chave, usa a busca local (instantânea) ---
  // A busca nas notas TEM PRIORIDADE; o FAQ do app só entra quando não há
  // trecho relacionado — assim perguntas de conteúdo nunca são sequestradas.
  if (!chaveApi) {
    const contexto = montarContexto(todas, pergunta, false);
    if (!contexto) {
      const recurso = respostaRecursoApp(pergunta);
      if (recurso) return { texto: recurso, modo: 'offline' };
      return {
        texto: 'Só posso ajudar com assuntos sobre as suas notas ✨\n\nNão encontrei nada relacionado à sua pergunta. Configure a chave gratuita de IA em Ajustes → IA para eu conseguir responder melhor (até perguntas feitas com outras palavras).',
        modo: 'fora',
      };
    }
    return {
      texto: `Encontrei isso nas suas notas:\n\n${contexto}\n\n_(modo offline — adicione a chave gratuita de IA em Ajustes → IA para respostas completas como ChatGPT)_`,
      modo: 'offline',
    };
  }

  // --- Modo online: sempre chama a API com as notas como contexto ---
  const contexto = montarContexto(todas, pergunta, true);

  const system = [
    'Você é o assistente de IA do app de anotações "Simple Notes".',
    'Você responde SEMPRE em português do Brasil, de forma clara, amigável e direta.',
    'Você ajuda com: (1) as anotações do usuário (resumir, organizar, explicar, comparar, tirar dúvidas) e (2) dúvidas sobre o próprio aplicativo.',
    `Estes são TODOS os recursos reais do app (não invente outros): ${RECURSOS_DO_APP}.`,
    'NUNCA mencione recursos que não estejam nessa lista (ex.: exportar PDF, versão web, sincronizar com outro serviço, reconhecimento de voz etc.).',
    'Se o usuário perguntar por algo que não existe no app, responda educadamente que esse recurso não existe no Simple Notes e, se houver algo parecido na lista, sugira.',
    'Use o conteúdo das notas fornecidas como base para responder, mas pode conversar naturalmente e explicar ideias, organizar informações, resumir, comparar e tirar dúvidas sobre o que está nas notas.',
    'Se a pergunta não tiver relação com as notas nem com o aplicativo, responda: "Só posso ajudar com assuntos sobre as suas notas ✨".',
    'Responda de forma curta e objetiva (máx. ~180 palavras).',
  ].join(' ');

  // Histórico (máx. 6 mensagens anteriores) ANTES da pergunta atual — ordem cronológica.
  const historicoMsgs = historico.slice(-6).map((m: MensagemChat) => ({
    role: m.papel === 'usuario' ? 'user' : 'assistant',
    content: m.texto,
  }));

  const messages: any[] = [
    { role: 'system', content: system },
    ...historicoMsgs,
    {
      role: 'user',
      content: `Estas são as notas do usuário:\n\n${contexto}\n\nPergunta do usuário: ${pergunta}`,
    },
  ];

  try {
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chaveApi}`,
        'HTTP-Referer': 'https://simple-notes.app',
        'X-Title': 'Simple Notes',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages,
        temperature: 0.7,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      if (res.status === 401) {
        return {
          texto: 'A chave de IA configurada não é válida. Verifique em Ajustes → IA.',
          modo: 'offline',
        };
      }
      if (res.status === 429) {
        return {
          texto: 'A IA gratuita está com limite de uso no momento (muitas perguntas em pouco tempo). Aguarde um minuto e tente de novo — ou pergunte em Ajustes → IA se a chave está certa.',
          modo: 'offline',
        };
      }
      throw new Error(`API ${res.status}: ${corpo.slice(0, 120)}`);
    }

    const data = await res.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) throw new Error('Resposta vazia da API');
    return { texto, modo: 'online' };
  } catch (e) {
    console.warn('[IA] Erro na API, usando resposta local:', e);
    const local = montarContexto(todas, pergunta, false);
    if (local) {
      return {
        texto: `Não consegui conectar à IA online agora, mas encontrei isto nas suas notas:\n\n${local}\n\n(Verifique sua internet ou a chave de IA em Ajustes.)`,
        modo: 'offline',
      };
    }
    return {
      texto: 'Não consegui conectar à IA online agora. Verifique sua internet ou a chave de IA em Ajustes → IA e tente de novo.',
      modo: 'offline',
    };
  }
}
