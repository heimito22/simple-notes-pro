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
import { tIdioma, type Idioma } from './idiomas';

// Nome do idioma para os prompts do modelo (o modelo entende o nome nativo).
const NOME_IDIOMA: Record<Idioma, string> = {
  pt: 'Português (Brasil)',
  en: 'English',
  es: 'Español',
};

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
  'Pastas para organizar notas e listas: segure um item para selecionar vários de uma vez, crie e renomeie pastas, mova os selecionados para uma pasta ou crie uma nota/lista direto dentro de uma pasta',
  'Listas (checklists simples): fixar, criar dentro de pastas, abrir/editar com um toque e excluir',
  'Botão flutuante "ir para o fim" (seta em círculo) em notas com anexos grandes',
  'Lembretes de nota: em data/hora, a cada X dias ou em dias da semana (disparam alarme em tela cheia)',
  'Alarme em tela cheia com som próprio, soneca (5 a 60 min) e volume de alarme forçado',
  'Tarefas com recorrência (uma vez, diária ou em dias específicos) e horário, com notificação',
  'Login com conta Google e backup automático no Drive (notas, tarefas e chave de IA)',
  'Ajustes: modo escuro, idioma do app, som/soneca/permissões do alarme, remover anúncios (pagamento único na Play Store), premium por convite, chave de IA gratuita (OpenRouter) e bloqueio com biometria',
].join(' · ');

// FAQ local (modo offline, sem chave): perguntas sobre o PRÓPRIO app respondidas
// com a lista oficial de recursos — nunca com invenções. As respostas são
// traduzidas para o idioma ativo no momento em que são usadas.
const FAQ_APP: { palavras: string[]; resposta: string }[] = [
  {
    palavras: ['exportar', 'pdf', 'compartilhar', 'imprimir', 'export', 'share'],
    resposta: 'Esse recurso não existe no Simple Notes: o app não exporta nem compartilha notas. Ele salva tudo automaticamente na sua conta Google (Drive). ✨',
  },
  {
    palavras: ['anuncio', 'anúncio', 'anuncios', 'anúncios', 'premium', 'assinatura', 'remover anuncio', 'remover anúncio', 'ads', 'ad-free'],
    resposta: 'Sim! Em Ajustes → Anúncios há "Remover anúncios para sempre" (pagamento único pela Play Store). Também existe o Premium liberado por convite do desenvolvedor.',
  },
  {
    palavras: ['modo escuro', 'modo claro', 'tema escuro', 'tema claro', 'tema do app', 'dark', 'tema', 'theme'],
    resposta: 'Sim! Em Ajustes → Aparência você alterna o Modo Escuro.',
  },
  {
    palavras: ['som do alarme', 'soneca', 'permissão do alarme', 'permissao do alarme', 'alarme', 'alarm', 'snooze'],
    resposta: 'Em Ajustes → Alarme você escolhe o som do alarme, ajusta a soneca (5 a 60 min) e confere as permissões (popup em tela cheia, Xiaomi e bateria).',
  },
  {
    palavras: ['biometria', 'impressão digital', 'impressao digital', 'rosto', 'bloquear app', 'bloquear o app', 'trancar o app', 'bloqueio', 'biometric', 'fingerprint', 'face id', 'lock'],
    resposta: 'Em Ajustes → Segurança, o app pode exigir biometria (digital ou rosto) ao abrir, com tempo de bloqueio de imediato até 30 minutos.',
  },
  {
    palavras: ['backup', 'drive', 'google', 'sincroniz', 'restaurar', 'login', 'logar', 'cloud'],
    resposta: 'Entrando com sua conta Google, notas, tarefas e a chave de IA ficam salvas no Drive com backup automático — ao trocar de aparelho, entre com a mesma conta e tudo volta.',
  },
  {
    palavras: ['tarefa', 'tarefas', 'recorrência', 'recorrencia', 'task', 'tasks'],
    resposta: 'Na aba Tarefas você cria tarefas com recorrência (uma vez, diária ou em dias específicos) e horário, marca como concluída e exclui. Cada tarefa dispara uma notificação no horário.',
  },
  {
    palavras: ['pasta', 'pastas', 'folder', 'carpeta', 'organizar em pastas', 'mover para pasta', 'renomear pasta'],
    resposta: 'Na tela principal, a fileira de pastas fica acima das notas: toque no sinal de + para criar uma pasta e, para mover itens, segure uma nota ou lista até entrar no modo de seleção — aí você escolhe vários itens e toca em "mover para pasta". Você também pode renomear a pasta abrindo-a.',
  },
  {
    palavras: ['lista', 'listas', 'checklist', 'check-list'],
    resposta: 'As listas são checklists simples que aparecem junto das notas: crie pela tela principal, fixe as importantes, e elas também podem morar dentro de pastas (crie uma lista direto dentro da pasta).',
  },
  {
    palavras: ['lembrete', 'lembrar', 'sino', 'reminder', 'remind'],
    resposta: 'Em cada nota, o ícone de sino agenda lembretes: em data e horário, a cada X dias ou em dias da semana. Quando toca, o alarme abre em tela cheia com som e soneca.',
  },
  {
    palavras: ['chave da ia', 'chave gratuita', 'chave do openrouter', 'openrouter', 'inteligência', 'inteligencia', 'ai key', 'api key'],
    resposta: 'A IA fica em Ajustes → IA: adicione a chave gratuita do OpenRouter (há o tutorial "Como criar a chave") para respostas completas sobre suas notas. Sem chave, respondo com buscas locais nas suas notas.',
  },
  {
    palavras: ['imagem', 'foto', 'áudio', 'audio', 'gravar', 'gravação', 'gravacao', 'anexo', 'image', 'photo', 'voice', 'record'],
    resposta: 'No editor da nota você pode anexar imagens e gravar áudio. Em notas com anexos grandes, um botão (seta em círculo) leva você direto ao fim da nota.',
  },
  {
    palavras: ['idioma', 'língua', 'lingua', 'language', 'english', 'español', 'espanhol', 'trocar idioma'],
    resposta: 'Em Ajustes → Aparência → Idioma você escolhe entre Português, English e Español — o app inteiro e o assistente de IA passam a responder no idioma escolhido.',
  },
];

/** Pergunta sobre o próprio app? Retorna a resposta local (ou null se não for). */
function respostaRecursoApp(pergunta: string, idioma: Idioma): string | null {
  const p = pergunta.toLowerCase();
  for (const item of FAQ_APP) {
    if (item.palavras.some(w => p.includes(w))) {
      return tIdioma(idioma, item.resposta);
    }
  }
  return null;
}

/** Converte uma tarefa em texto para o contexto. */
function tarefaParaTexto(tarefa: any, idioma: Idioma): string {
  const titulo = String(tarefa.titulo || tIdioma(idioma, 'Sem título')).trim();
  const status = tarefa.concluida
    ? tIdioma(idioma, 'concluída')
    : tIdioma(idioma, 'pendente');
  const rec = tarefa.recorrencia
    ? `, ${tIdioma(idioma, 'recorrência')}: ${tarefa.recorrencia}`
    : '';
  const hor = tarefa.horario ? `, ${tIdioma(idioma, 'horário')}: ${tarefa.horario}` : '';
  return `• [${tIdioma(idioma, 'Tarefa')} - ${status}] "${titulo}"${rec}${hor}`;
}

/** Converte uma nota (HTML) em texto puro e truncado para o contexto. */
function notaParaTexto(nota: any, idioma: Idioma): string {
  const limpo = limparTexto(String(nota.conteudo || ''));
  const titulo = String(nota.titulo || tIdioma(idioma, 'Sem título')).trim();
  const corpo = limpo.length > MAX_CHARS_NOTA ? limpo.slice(0, MAX_CHARS_NOTA) + '…' : limpo;
  return corpo
    ? `• "${titulo}": ${corpo}`
    : `• "${titulo}" (${tIdioma(idioma, 'sem conteúdo')})`;
}

/**
 * Monta o contexto das notas e tarefas. ONLINE: envia as notas e tarefas relevantes.
 * OFFLINE: envia só os trechos correspondentes.
 */
function montarContexto(notas: any[], tarefas: any[], pergunta: string, online: boolean, idioma: Idioma): string {
  const todasNotas = Array.isArray(notas) ? notas : [];
  const todasTarefas = Array.isArray(tarefas) ? tarefas : [];
  
  if (todasNotas.length === 0 && todasTarefas.length === 0) return '';

  let textoNotas = '';
  if (online) {
    const relevantes = buscarResposta(todasNotas, pergunta, todasNotas.length);
    const idsRelevantes = new Set(relevantes.trechos.map((t: any) => t.notaId));
    const ordenadas = [
      ...todasNotas.filter((n: any) => idsRelevantes.has(n.id)),
      ...todasNotas.filter((n: any) => !idsRelevantes.has(n.id)),
    ];
    textoNotas = ordenadas
      .slice(0, MAX_NOTAS_CONTEXTO)
      .map(n => notaParaTexto(n, idioma))
      .join('\n');
  } else {
    const resultado = buscarResposta(todasNotas, pergunta, MAX_TRECHOS_LOCAIS);
    if (resultado.temResposta) {
      textoNotas = resultado.trechos.map((t: any) => `• "${t.titulo}": ${t.frase}`).join('\n');
    }
  }

  const p = pergunta.toLowerCase();
  const tarefasFiltradas = online 
    ? todasTarefas.slice(0, 10) 
    : todasTarefas.filter(t => t.titulo?.toLowerCase().includes(p) || p.includes('tarefa') || p.includes('tarefas'));
  
  const rotuloTarefas = tIdioma(idioma, 'Tarefas:');
  const textoTarefas = tarefasFiltradas.length > 0
    ? (textoNotas ? `\n\n${rotuloTarefas}\n` : `${rotuloTarefas}\n`) + tarefasFiltradas.map(t => tarefaParaTexto(t, idioma)).join('\n')
    : '';

  return (textoNotas + textoTarefas).trim();
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
export async function resumirNotaComIA(nota: any, chaveApi: string, idioma: Idioma = 'pt'): Promise<RespostaChat> {
  if (!nota) {
    return { texto: tIdioma(idioma, 'Abra uma nota para eu resumir. ✍️'), modo: 'fora' };
  }
  if (!chaveApi) {
    return {
      texto: tIdioma(idioma, 'Para resumir com IA, configure sua chave gratuita em Ajustes → IA. 🔑'),
      modo: 'offline',
    };
  }

  const contexto = notaParaTexto(nota, idioma);
  const system = [
    'Você é o NotaIA, o assistente de IA do app de anotações "Simple Notes".',
    `Responda SEMPRE em ${NOME_IDIOMA[idioma]}.`,
    idioma === 'pt'
      ? 'Gere um resumo curto e claro da nota do usuário (máx. ~120 palavras), destacando as informações mais importantes em tópicos quando fizer sentido.'
      : idioma === 'en'
        ? 'Write a short, clear summary of the user note (max ~120 words), highlighting the most important information, using bullet points when it makes sense.'
        : 'Escribe un resumen breve y claro de la nota del usuario (máx. ~120 palabras), destacando la información más importante en viñetas cuando tenga sentido.',
    idioma === 'pt'
      ? 'Não invente nem mencione recursos ou funções do aplicativo: o resumo deve falar apenas do conteúdo da nota.'
      : idioma === 'en'
        ? 'Do not invent or mention app features: the summary must talk only about the note content.'
        : 'No inventes ni menciones funciones de la app: el resumen debe hablar solo del contenido de la nota.',
  ].join(' ');

  const messages: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: `${tIdioma(idioma, 'Resuma esta nota:')}\n\n${contexto}` },
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
        return { texto: tIdioma(idioma, 'A chave de IA configurada não é válida. Verifique em Ajustes → IA.'), modo: 'offline' };
      }
      if (res.status === 429) {
        return { texto: tIdioma(idioma, 'A IA gratuita está com limite de uso no momento. Aguarde um minuto e tente de novo.'), modo: 'offline' };
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
      texto: tIdioma(idioma, 'Não consegui conectar à IA online agora. Verifique sua internet ou a chave em Ajustes → IA e tente de novo.'),
      modo: 'offline',
    };
  }
}

export async function responderPergunta(
  pergunta: string,
  notas: any[],
  chaveApi: string,
  historico: MensagemChat[] = [],
  tarefas: any[] = [],
  idioma: Idioma = 'pt'
): Promise<RespostaChat> {
  const todasNotas = Array.isArray(notas) ? notas : [];
  const todasTarefas = Array.isArray(tarefas) ? tarefas : [];

  if (todasNotas.length === 0 && todasTarefas.length === 0) {
    // Sem notas nem tarefas: perguntas sobre o próprio app ainda são respondidas usando a
    // lista REAL de recursos — nada de invenção.
    if (!chaveApi) {
      const recurso = respostaRecursoApp(pergunta, idioma);
      if (recurso) return { texto: recurso, modo: 'offline' };
    }
    return {
      texto: tIdioma(idioma, 'Você ainda não tem nenhuma nota ou tarefa. Crie uma nota ou tarefa primeiro e depois me pergunte! 📝✨'),
      modo: 'fora',
    };
  }

  // --- Modo offline: sem chave, usa a busca local (instantânea) ---
  if (!chaveApi) {
    const contexto = montarContexto(todasNotas, todasTarefas, pergunta, false, idioma);
    if (!contexto) {
      const recurso = respostaRecursoApp(pergunta, idioma);
      if (recurso) return { texto: recurso, modo: 'offline' };
      return {
        texto: tIdioma(idioma, 'Só posso ajudar com assuntos sobre as suas notas e tarefas ✨\n\nNão encontrei nada relacionado à sua pergunta. Configure a chave gratuita de IA em Ajustes → IA para eu conseguir responder melhor.'),
        modo: 'fora',
      };
    }
    const cab = tIdioma(idioma, 'Encontrei isso nas suas notas e tarefas:');
    const roda = tIdioma(idioma, '(modo offline — adicione a chave gratuita de IA em Ajustes → IA para respostas completas como ChatGPT)');
    return {
      texto: `${cab}\n\n${contexto}\n\n_${roda}_`,
      modo: 'offline',
    };
  }

  // --- Modo online: sempre chama a API com as notas e tarefas como contexto ---
  const contexto = montarContexto(todasNotas, todasTarefas, pergunta, true, idioma);

  const foraEscopo =
    idioma === 'pt'
      ? '"Só posso ajudar com assuntos sobre as suas notas e tarefas ✨"'
      : idioma === 'en'
        ? '"I can only help with things about your notes and tasks ✨"'
        : '"Solo puedo ayudar con asuntos sobre tus notas y tareas ✨"';
  const system =
    idioma === 'pt'
      ? [
          'Você é o NotaIA, o assistente de IA do app de anotações "Simple Notes".',
          'Você responde SEMPRE em português do Brasil, de forma clara, amigável e direta.',
          'Você ajuda com: (1) as anotações e tarefas do usuário (resumir, organizar, explicar, comparar, tirar dúvidas) e (2) dúvidas sobre o próprio aplicativo.',
          `Estes são TODOS os recursos reais do app (não invente outros): ${RECURSOS_DO_APP}.`,
          'NUNCA mencione recursos que não estejam nessa lista (ex.: exportar PDF, versão web, sincronizar com outro serviço, reconhecimento de voz etc.).',
          'Se o usuário perguntar por algo que não existe no app, responda educadamente que esse recurso não existe no Simple Notes e, se houver algo parecido na lista, sugira.',
          'Use o conteúdo das notas e tarefas fornecidas como base para responder, mas pode conversar naturalmente e explicar ideias, organizar informações, resumir, comparar e tirar dúvidas sobre o que está nas notas e tarefas.',
          `Se a pergunta não tiver relação com as notas, tarefas nem com o aplicativo, responda: ${foraEscopo}.`,
          'Responda de forma curta e objetiva (máx. ~180 palavras).',
        ]
      : idioma === 'en'
        ? [
          'You are NotaIA, the AI assistant of the note-taking app "Simple Notes".',
          'Always answer in English, clearly, friendly and straight to the point.',
          'You help with: (1) the user notes and tasks (summarizing, organizing, explaining, comparing, answering doubts) and (2) questions about the app itself.',
          `These are ALL the real app features (never invent others): ${RECURSOS_DO_APP}.`,
          'NEVER mention features that are not in that list (e.g.: exporting PDF, a web version, syncing with another service, voice recognition, etc.).',
          'If the user asks for something that does not exist in the app, politely say that feature does not exist in Simple Notes and, if there is something similar in the list, suggest it.',
          'Use the provided notes and tasks as your base, but you may chat naturally: explain ideas, organize information, summarize, compare and answer doubts about what is in the notes and tasks.',
          `If the question is unrelated to the notes, tasks or the app, answer: ${foraEscopo}.`,
          'Keep answers short and objective (max ~180 words).',
        ]
      : [
          'Eres NotaIA, el asistente de IA de la app de notas "Simple Notes".',
          'Responde SIEMPRE en español, de forma clara, amable y directa.',
          'Ayudas con: (1) las notas y tareas del usuario (resumir, organizar, explicar, comparar, resolver dudas) y (2) dudas sobre la propia app.',
          `Estas son TODAS las funciones reales de la app (no inventes otras): ${RECURSOS_DO_APP}.`,
          'NUNCA menciones funciones que no estén en esa lista (p. ej.: exportar PDF, versión web, sincronizar con otro servicio, reconocimiento de voz, etc.).',
          'Si el usuario pregunta por algo que no existe en la app, responde amablemente que esa función no existe en Simple Notes y, si hay algo parecido en la lista, sugiérelo.',
          'Usa el contenido de las notas y tareas proporcionadas como base, pero puedes conversar con naturalidad: explicar ideas, organizar información, resumir, comparar y resolver dudas sobre lo que está en las notas y tareas.',
          `Si la pregunta no tiene relación con las notas, las tareas ni con la app, responde: ${foraEscopo}.`,
          'Responde de forma breve y objetiva (máx. ~180 palabras).',
        ]
      .join(' ');

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
      content: `Estas são as notas e tarefas do usuário:\n\n${contexto}\n\nPergunta do usuário: ${pergunta}`,
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
          texto: tIdioma(idioma, 'A chave de IA configurada não é válida. Verifique em Ajustes → IA.'),
          modo: 'offline',
        };
      }
      if (res.status === 429) {
        return {
          texto: tIdioma(idioma, 'A IA gratuita está com limite de uso no momento (muitas perguntas em pouco tempo). Aguarde um minuto e tente de novo — ou pergunte em Ajustes → IA se a chave está certa.'),
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
    const local = montarContexto(todasNotas, todasTarefas, pergunta, false, idioma);
    if (local) {
      const cab = tIdioma(idioma, 'Não consegui conectar à IA online agora, mas encontrei isto nas suas notas e tarefas:');
      const roda = tIdioma(idioma, '(Verifique sua internet ou a chave de IA em Ajustes.)');
      return {
        texto: `${cab}\n\n${local}\n\n${roda}`,
        modo: 'offline',
      };
    }
    return {
      texto: tIdioma(idioma, 'Não consegui conectar à IA online agora. Verifique sua internet ou a chave de IA em Ajustes → IA e tente de novo.'),
      modo: 'offline',
    };
  }
}
