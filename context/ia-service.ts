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
import { URL_PROXY_IA, PROXY_IA_ATIVO } from '../constants/ia-proxy';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

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
  /** true quando a pergunta foi interpretada como ORDEM de edição (ex.: "adiciona X na lista").
   *  A UI usa isto: se a IA deu só texto, ainda oferece aplicar o texto na nota. */
  ordemEdicao?: boolean;
}

/**
 * Proposta de edição que a IA pode anexar ao fim da resposta (protocolo
 * compartilhado celular/PC): a IA PRIMEIRO explica em texto o que vai mudar e
 * DEPOIS inclui um bloco ```json com {"edicao": {...}}. O app NUNCA aplica
 * sozinho — mostra a proposta e só aplica após o usuário confirmar.
 */
export interface PropostaEdicao {
  /** O que a IA vai alterar (própria IA descreve — aparece no cartão). */
  explicacao?: string;
  /** Novo título (se ausente, mantém o atual). */
  titulo?: string;
  /** HTML final COMPLETO da nota (nota inteira substituída). */
  conteudo?: string;
  /** Lista final COMPLETA de itens (existentes + mudanças). */
  itens?: { texto: string; concluido: boolean }[];
}

/**
 * Extrai a proposta de edição de uma resposta da IA.
 * Procura um bloco ```json ... ``` (ou um objeto solto) com a chave "edicao".
 * Retorna o texto limpo (sem o bloco) para exibir na conversa.
 */
export function extrairPropostaEdicao(texto: string): { proposta: PropostaEdicao | null; textoLimpo: string } {
  const bruto = String(texto || '');
  // 1) Bloco cercado ```json { ... } ```
  const cerca = bruto.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const candidatos = [];
  if (cerca) candidatos.push(cerca[1]);
  // 2) Objeto solto contendo "edicao" (IA esqueceu a cerca)
  const solto = bruto.match(/\{[\s\S]*"edicao"[\s\S]*\}/);
  if (solto) candidatos.push(solto[0]);
  for (const brutoJson of candidatos) {
    try {
      const obj = JSON.parse(brutoJson);
      const ed = obj && typeof obj === 'object' ? obj.edicao : null;
      if (ed && typeof ed === 'object') {
        const proposta: PropostaEdicao = {};
        if (typeof ed.explicacao === 'string') proposta.explicacao = ed.explicacao;
        if (typeof ed.titulo === 'string' && ed.titulo.trim()) proposta.titulo = ed.titulo.trim();
        if (typeof ed.conteudo === 'string' && ed.conteudo.trim()) proposta.conteudo = ed.conteudo;
        if (Array.isArray(ed.itens)) {
          const itens = ed.itens
            .filter((it: any) => it && typeof it === 'object' && typeof it.texto === 'string' && it.texto.trim())
            .map((it: any) => ({ texto: String(it.texto).trim(), concluido: !!it.concluido }));
          if (itens.length) proposta.itens = itens;
        }
        // Só é proposta se traz algum conteúdo aplicável
        if (proposta.conteudo || proposta.itens || proposta.titulo) {
          const textoLimpo = bruto.replace(cerca ? cerca[0] : (solto ? solto[0] : ''), '').trim();
          return { proposta, textoLimpo: textoLimpo || proposta.explicacao || '' };
        }
      }
    } catch {
      // JSON inválido — ignora e tenta o próximo candidato
    }
  }
  return { proposta: null, textoLimpo: bruto };
}

/** Instrução de edição por conta própria (anexada ao prompt quando há nota aberta). */
function instrucaoEdicao(idioma: Idioma): string {
  if (idioma === 'en') {
    return 'THE USER ORDERED AN EDIT of the open note. Do this now: FIRST one short text line explaining exactly what changes, THEN — mandatory, not optional — append a fenced block with the COMPLETE final note: ```json {"edicao": {"titulo": "new title (or same)", "conteudo": "<complete final note in the formatting notation>"}} ```. CONTENT NOTATION (use the SAME one you received, never HTML): **bold**, *italic*, <u>underline</u>, ~~strikethrough~~, [cor=#RRGGBB]colored text[/cor], `code`, - list item, 1. numbered item, # title, ## subtitle, > quote and [text](url) for links; one line per paragraph (a blank line separates paragraphs). RULES: (1) KEEP the formatting the note already has — text that was bold stays bold and lists stay lists; change only what the user asked; (2) add the new content ALREADY FORMATTED (requested bullets = "- "; requested highlight = "**"); (3) keep EVERY [[midia1]], [[midia2]] mark exactly where they appear — they are the user images/audio and must NEVER be removed or renamed; (4) conteudo contains ONLY the note — no phrases of yours like "Done" or "The note was updated", and not the title; (5) the title goes ONLY in the titulo field. The JSON block is EXEMPT from the length limit. Never apply changes silently — the app asks the user first.';
  }
  if (idioma === 'es') {
    return 'EL USUARIO ORDENÓ UNA EDICIÓN de la nota abierta. Hazlo ahora: PRIMERO una línea corta explicando exactamente qué cambia, LUEGO — obligatorio, no opcional — añade un bloque cercado con la nota final COMPLETA: ```json {"edicao": {"titulo": "título nuevo (o el mismo)", "conteudo": "<nota final completa en la notación de formato>"}} ```. NOTACIÓN DEL CONTENIDO (usa la MISMA que recibiste, nunca HTML): **negrita**, *cursiva*, <u>subrayado</u>, ~~tachado~~, [cor=#RRGGBB]texto con color[/cor], `código`, - elemento de lista, 1. elemento numerado, # título, ## subtítulo, > cita y [texto](url) para enlaces; una línea por párrafo (una línea vacía separa párrafos). REGLAS: (1) CONSERVA el formato que la nota ya tiene — lo que estaba en negrita sigue en negrita y las listas siguen siendo listas; cambia solo lo que el usuario pidió; (2) añade el contenido nuevo YA FORMATEADO (viñetas pedidas = "- "; destacado pedido = "**"); (3) conserva TODAS las marcas [[midia1]], [[midia2]] exactamente donde están — son las imágenes/audios del usuario y NUNCA deben quitarse ni renombrarse; (4) conteudo contiene SOLO la nota — nada de frases tuyas como "Listo" o "La nota fue actualizada", ni el título; (5) el título va SOLO en el campo titulo. El bloque JSON está EXENTO del límite de longitud. Nunca apliques cambios en silencio — la app pide confirmación al usuario.';
  }
  return 'O USUÁRIO ORDENOU UMA EDIÇÃO na nota aberta. Faça agora: PRIMEIRO uma linha curta explicando exatamente o que muda, DEPOIS — obrigatório, não opcional — acrescente um bloco cercado com a nota final COMPLETA: ```json {"edicao": {"titulo": "título novo (ou o mesmo de antes)", "conteudo": "<nota final COMPLETA na notação de formatação>"}} ```. NOTAÇÃO DO CONTEÚDO (use a MESMA que você recebeu, nunca HTML): **negrito**, *itálico*, <u>sublinhado</u>, ~~riscado~~, [cor=#RRGGBB]texto colorido[/cor], `código`, - item de lista, 1. item numerado, # título, ## subtítulo, > citação e [texto](url) para links; uma linha por parágrafo (linha vazia separa parágrafos). REGRAS: (1) CONSERVE a formatação que a nota já tem — o que estava em negrito continua em negrito e as listas continuam listas; altere apenas o que o usuário pediu; (2) acrescente o conteúdo novo JÁ FORMATADO (tópicos pedidos = "- "; destaque pedido = "**"); (3) preserve TODAS as marcas [[midia1]], [[midia2]]... exatamente onde aparecem — são as imagens/áudios do usuário e NUNCA podem ser removidas nem renomeadas; (4) o conteudo contém SOMENTE a nota — nada de frases suas como "Pronto" ou "A nota foi alterada", e nem o título; (5) o título vai SÓ no campo titulo. O bloco JSON está ISENTO do limite de tamanho. Nunca aplique a mudança em silencio — o app pergunta ao usuário antes de aplicar.';
}

/**
 * CATÁLOGO DE AÇÕES — transforma o NotaIA em AGENTE: ele pode propor criar
 * notas/listas/tarefas/pastas, mover, fixar, agendar lembretes, apagar.
 * O app NUNCA aplica sozinho: extrai o bloco, mostra o cartão de confirmação
 * e só executa pelas funções oficiais dos contexts quando o usuário permite.
 */
const REGRA_SEM_FINGIR =
  'NUNCA diga que já criou, adicionou, alterou ou apagou algo: o app só executa depois que o usuário tocar em Permitir. Fale no futuro ("vou criar...") e não invente resultados.';

function instrucaoAcoes(idioma: Idioma): string {
  if (idioma === 'en') {
    return 'AGENT ACTIONS: you can EXECUTE app operations — the user always confirms before anything is applied. Whenever the user asks to CREATE, ORGANIZE, SCHEDULE, DELETE or CHANGE anything (note, checklist, task, folder, reminder, pin), reply with 1-2 short sentences saying what you will do and THEN — mandatory — a fenced block: ```json {"acoes":[ ...one or more actions... ]} ```. Action types (use EXACTLY these "tipo"): {"tipo":"criar_nota","titulo":"...","conteudo":"...","pasta":"Folder name (optional)","fixar":true,"lembrete":{"tipo":"data","data":"yyyy-mm-dd","horario":"HH:MM"}} · {"tipo":"editar_nota","alvo":"<note id>","titulo":"...","conteudo":"<complete final content>"} · {"tipo":"criar_lista","titulo":"...","itens":[{"texto":"...","concluido":false}],"pasta":"..."} · {"tipo":"editar_lista","alvo":"<id>","titulo":"...","itens":[...]} · {"tipo":"criar_tarefa","titulo":"...","recorrencia":"Uma vez"|"Diária"|"Segunda"|"Terça"|"Quarta"|"Quinta"|"Sexta"|"Sábado"|"Domingo","horario":"HH:MM"} · {"tipo":"concluir_tarefa","alvo":"<id>","valor":true} · {"tipo":"apagar_tarefa","alvo":"<id>"} · {"tipo":"apagar_nota","alvo":"<note OR checklist id>"} · {"tipo":"fixar_nota","alvo":"<id>","valor":true} · {"tipo":"criar_pasta","nome":"..."} · {"tipo":"mover_para_pasta","alvos":["<id>"],"pasta":"Name"} · {"tipo":"lembrete_nota","alvo":"<id>","lembrete":{"tipo":"data"|"dias"|"semana","data":"yyyy-mm-dd"|"intervaloDias":7|"diasSemana":["Segunda"],"horario":"HH:MM"}} (lembrete null removes). RULES: (1) "conteudo" uses the notes formatting notation (**bold**, *italic*, <u>underline</u>, ~~strikethrough~~, [cor=#RRGGBB]colored text[/cor], - item, 1. numbered, # title, > quote); (2) organization tags are #hashtags written INSIDE the content; (3) "alvo"/"alvos" MUST be ids from the provided INVENTORY — never invent ids; (4) to EDIT, "conteudo" carries the ENTIRE final note; (5) lembrete requires a horario; for "tomorrow" use {"tipo":"dias","intervaloDias":1}; (6) do NOT propose actions for casual questions — only for operational requests; (7) you may combine several actions in one reply (e.g. note + task + reminder of the same topic). The JSON block is EXEMPT from the length limit.';
  }
  if (idioma === 'es') {
    return 'ACCIONES DEL AGENTE: puedes EJECUTAR operaciones de la app — el usuario siempre confirma antes de aplicar. Cuando el usuario pida CREAR, ORGANIZAR, AGENDAR, BORRAR o CAMBIAR algo (nota, checklist, tarea, carpeta, recordatorio, fijar), responde con 1-2 frases cortas diciendo qué harás y LUEGO — obligatorio — un bloque cercado: ```json {"acoes":[ ...una o más acciones... ]} ```. Tipos de acción (usa EXACTAMENTE estos "tipo"): {"tipo":"criar_nota","titulo":"...","conteudo":"...","pasta":"Nombre de carpeta (opcional)","fixar":true,"lembrete":{"tipo":"data","data":"yyyy-mm-dd","horario":"HH:MM"}} · {"tipo":"editar_nota","alvo":"<id de nota>","titulo":"...","conteudo":"<contenido final COMPLETO>"} · {"tipo":"criar_lista","titulo":"...","itens":[{"texto":"...","concluido":false}],"pasta":"..."} · {"tipo":"editar_lista","alvo":"<id>","titulo":"...","itens":[...]} · {"tipo":"criar_tarefa","titulo":"...","recorrencia":"Uma vez"|"Diária"|"Segunda"|"Terça"|"Quarta"|"Quinta"|"Sexta"|"Sábado"|"Domingo","horario":"HH:MM"} · {"tipo":"concluir_tarefa","alvo":"<id>","valor":true} · {"tipo":"apagar_tarefa","alvo":"<id>"} · {"tipo":"apagar_nota","alvo":"<id de nota O lista>"} · {"tipo":"fixar_nota","alvo":"<id>","valor":true} · {"tipo":"criar_pasta","nome":"..."} · {"tipo":"mover_para_pasta","alvos":["<id>"],"pasta":"Nombre"} · {"tipo":"lembrete_nota","alvo":"<id>","lembrete":{"tipo":"data"|"dias"|"semana","data":"yyyy-mm-dd"|"intervaloDias":7|"diasSemana":["Segunda"],"horario":"HH:MM"}} (lembrete null elimina). REGLAS: (1) "conteudo" usa la notación de formato de las notas (**negrita**, *cursiva*, <u>subrayado</u>, ~~tachado~~, [cor=#RRGGBB]texto con color[/cor], - elemento, 1. numerado, # título, > cita); (2) las etiquetas de organización son #hashtags escritos DENTRO del contenido; (3) "alvo"/"alvos" DEBEN ser ids del INVENTARIO proporcionado — nunca inventes ids; (4) para EDITAR, "conteudo" lleva la nota ENTERA final; (5) lembrete exige horario; para "mañana" usa {"tipo":"dias","intervaloDias":1}; (6) NO propongas acciones en preguntas de conversación — solo ante peticiones operativas; (7) puedes combinar varias acciones en una respuesta. El bloque JSON está EXENTO del límite de longitud.';
  }
  return 'AÇÕES DE AGENTE: você pode EXECUTAR operações do app — o usuário sempre confirma antes de qualquer aplicação. Sempre que o usuário pedir para CRIAR, ORGANIZAR, AGENDAR, APAGAR ou ALTERAR algo (nota, lista de verificação, tarefa, pasta, lembrete, fixar), responda com 1-2 frases curtas dizendo o que fará e EM SEGUIDA — obrigatório — um bloco cercado: ```json {"acoes":[ ...uma ou mais ações... ]} ```. Tipos de ação (use EXATAMENTE estes "tipo"): {"tipo":"criar_nota","titulo":"...","conteudo":"...","pasta":"Nome da pasta (opcional)","fixar":true,"lembrete":{"tipo":"data","data":"yyyy-mm-dd","horario":"HH:MM"}} · {"tipo":"editar_nota","alvo":"<id da nota>","titulo":"...","conteudo":"<conteúdo final COMPLETO>"} · {"tipo":"criar_lista","titulo":"...","itens":[{"texto":"...","concluido":false}],"pasta":"..."} · {"tipo":"editar_lista","alvo":"<id>","titulo":"...","itens":[...]} · {"tipo":"criar_tarefa","titulo":"...","recorrencia":"Uma vez"|"Diária"|"Segunda"|"Terça"|"Quarta"|"Quinta"|"Sexta"|"Sábado"|"Domingo","horario":"HH:MM"} · {"tipo":"concluir_tarefa","alvo":"<id>","valor":true} · {"tipo":"apagar_tarefa","alvo":"<id>"} · {"tipo":"apagar_nota","alvo":"<id de nota OU lista>"} · {"tipo":"fixar_nota","alvo":"<id>","valor":true} · {"tipo":"criar_pasta","nome":"..."} · {"tipo":"mover_para_pasta","alvos":["<id>"],"pasta":"Nome"} · {"tipo":"lembrete_nota","alvo":"<id>","lembrete":{"tipo":"data"|"dias"|"semana","data":"yyyy-mm-dd"|"intervaloDias":7|"diasSemana":["Segunda"],"horario":"HH:MM"}} (lembrete null remove). REGRAS: (1) "conteudo" usa a notação de formatação das notas (**negrito**, *itálico*, <u>sublinhado</u>, ~~riscado~~, [cor=#RRGGBB]texto colorido[/cor], - item, 1. numerado, # título, > citação); (2) tags de organização são #hashtags escritas DENTRO do conteúdo; (3) "alvo"/"alvos" DEVEM ser ids do INVENTÁRIO fornecido — nunca invente ids; (4) para EDITAR, o campo conteudo traz a nota INTEIRA final; (5) lembrete exige horário; para "amanhã" use {"tipo":"dias","intervaloDias":1}; (6) NÃO proponha ações em perguntas de conversa — apenas em pedidos operativos; (7) pode combinar várias ações numa resposta só (ex.: nota + tarefa + lembrete do mesmo tema). O bloco JSON está ISENTO do limite de tamanho.';
}

/**
 * Detecta pedido OPERACIONAL (criar/agendar/organizar/apagar/mover/fixar) —
 * além das edições de nota. Nestes casos o teto de tokens sobe para o bloco
 * de ações não ser truncado. Perguntas genuínas nunca casam.
 */
export function ehOrdemAcao(texto: string): boolean {
  const s = String(texto || '').trim().toLowerCase();
  if (!s) return false;
  if (/^\s*(como|qual|quais|quando|onde|por que|porque|o que|quem|sera?\s*que|can|could|how|what|where|when|why|which|c[oó]mo|cu[aá]l|cu[aá]ndo|d[oó]nde|qu[ié])\b/.test(s)) return false;
  return /\b(cria|crie|criar|adiciona|adicionar|adiciono|novo|nova|apaga|apagar|apague|remove|remover|remova|mova|mover|move|organiza|organizar|organize|fixa|fixar|desafixa|desafixar|agenda|agendar|agende|lembra|lembrar|me lembra|conclui|concluir|marca|desmarca|anota pra mim|cadastra|cadastrar|create|add|make a|new note|new task|delete|organize|schedule|remind)\b/.test(s);
}

/**
 * INVENTÁRIO com ids — o mapa que a IA usa para preencher "alvo"/"alvos".
 * Títulos truncados (o conteúdo das notas relevantes já vem no contexto).
 */
function montarInventario(notas: any[], listas: any[], pastas: any[], tarefas: any[], idioma: Idioma): string {
  const corta = (s: any, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const linhas: string[] = [];
  const pastaDe = (pastaId?: string) => {
    const p = (pastas || []).find((x: any) => x?.id === pastaId);
    return p ? ` | ${tIdioma(idioma, 'pasta')}: ${corta(p.nome, 40)}` : '';
  };
  const rotNota = tIdioma(idioma, 'Nota');
  const rotLista = tIdioma(idioma, 'Lista');
  const rotPasta = tIdioma(idioma, 'Pasta');
  const rotTarefa = tIdioma(idioma, 'Tarefa');
  (notas || []).slice(0, 80).forEach((n: any) => {
    if (!n?.id) return;
    linhas.push(`• [id=${n.id}] ${rotNota}: "${corta(n.titulo, 80) || tIdioma(idioma, 'Sem título')}"${n.fixada ? ' | 📌' : ''}${n.lembrete ? ' | 🔔' : ''}${pastaDe(n.pastaId)}`);
  });
  (listas || []).slice(0, 40).forEach((l: any) => {
    if (!l?.id) return;
    linhas.push(`• [id=${l.id}] ${rotLista}: "${corta(l.titulo, 80)}" (${(l.itens || []).length} ${tIdioma(idioma, 'itens')})${l.fixada ? ' | 📌' : ''}${pastaDe(l.pastaId)}`);
  });
  (pastas || []).forEach((p: any) => {
    if (!p?.id) return;
    linhas.push(`• [id=${p.id}] ${rotPasta}: "${corta(p.nome, 60)}"`);
  });
  (tarefas || []).slice(0, 40).forEach((t: any) => {
    if (!t?.id) return;
    linhas.push(`• [id=${t.id}] ${rotTarefa}: "${corta(t.titulo, 80)}" — ${t.recorrencia || ''} ${t.horario || ''} (${t.concluida ? tIdioma(idioma, 'concluída') : tIdioma(idioma, 'pendente')})`);
  });
  return linhas.join('\n');
}


/**
 * Detecta ORDEM de edição (não pergunta). Só aqui a IA recebe a instrução de
 * propor a edição — conversa normal nunca gera bloco JSON, evitando que toda
 * pergunta vire um cartão de edição.
 */
export function ehOrdemEdicao(texto: string): boolean {
  const s = String(texto || '').toLowerCase();
  if (!s.trim()) return false;
  // Pergunta disfarçada de ordem ("como faço pra apagar uma nota?") nunca é ordem.
  if (/^\s*(como|qual|quais|quando|onde|por que|porque|o que|quem|ser[áa]\s*que|can|could|how|what|where|when|why|which|c[óo]mo|cu[áa]l|cu[áa]ndo|d[óo]nde|qu[ée]|qui[ée]n)\b/.test(s)) return false;
  // verbo de mudança no imperativo/infinitivo + alvo (nota/lista/anot[ação])
  const verbo = /\b(adicion\w*|inclu\w*|colo(ca|que|car)\w*|insir\w*|apag\w*|delet\w*|remov\w*|tirar?|exclu\w*|corrij\w*|corrig\w*|arrum\w*|consert\w*|edit\w*|alter\w*|mud\w*|modific\w*|reescrev\w*|reescrev\w*|reformul\w*|reorganiz\w*|organiz\w*|atualiz\w*|substitu\w*|troc\w*|complet\w*|preench\w*|resum\w*|traduz\w*|converter?|format\w*|add|insert|remove|delete|fix|correct|change|modify|rewrite|edit|update|replace|organize|complete|fill|summarize|translate|format|agreg\w*|a(ñ|n)ad\w*|elimin\w*|cambi\w*|reescrib\w*|corrig\w*|arregl\w*|actualiz\w*|reemplaz\w*|organiz\w*|complet\w*|traduc\w*|formate\w*)\b/;
  if (!verbo.test(s)) return false;
  // alvo explícito ou referência clara ao conteúdo em edição
  const alvo = /\b(nota|notas|lista|listas|anotac\w*|anota(ç|c)\w*|tarefa|tarefas|item|itens|texto|t(í|i)tulo|note|notes|list|lists|task|tasks|item|items|title|conte(ú|u)do|content)\b/.test(s);
  const deitico = /\b(nele|nela|nisso|aqui|esse|essa|isso|ele|ela|it|this|that|there|lo|la|ah(í|i))\b/.test(s);
  if (alvo || deitico) return true;
  // Comando curto no imperativo ("reescreve em tópicos") sem alvo explícito:
  // sem interrogação e com o verbo no início da frase.
  const palavras = s.split(/\s+/).filter(Boolean);
  if (/\?/.test(s) || palavras.length > 12) return false;
  return verbo.test(palavras.slice(0, 2).join(' '));
}

// ---- Mídia da nota -------------------------------------------------------
// A IA recebe uma MARCA no lugar de cada imagem/áudio (nunca vê o base64) e
// devolve a marca; ao aplicar, a marca volta a ser a mídia original. Marca que
// o modelo perder é re-anexada no fim: a IA NUNCA apaga a mídia do usuário.
const RE_MIDIA = /<img\b[^>]*>|<audio\b[\s\S]*?<\/audio>|<video\b[\s\S]*?<\/video>/gi;
/** Mídias da nota aberta no momento do pedido, na ordem das marcas [[midiaN]]. */
let midiasNotaAberta: string[] = [];

export function extrairMidias(html: string): { texto: string; midias: string[] } {
  const midias: string[] = [];
  const texto = String(html || '').replace(RE_MIDIA, (tag) => { midias.push(tag); return `\n[[midia${midias.length}]]\n`; });
  return { texto, midias };
}

function restaurarMidias(texto: string, midias: string[]): string {
  let out = String(texto || '');
  (midias || []).forEach((tag, i) => {
    const marca = `[[midia${i + 1}]]`;
    out = out.includes(marca) ? out.split(marca).join(tag) : out + tag;
  });
  return out;
}

// Frases que a IA escreve PARA O USUÁRIO e que não podem virar conteúdo da nota.
const RE_FALA_IA = /^\s*(pronto|prontinho|feito|conclu[ií]do|ok|beleza|perfeito|claro|certeza|aqui est[áa]|segue|a seguir|a nota (foi|j[áa] foi)?\s*(alterada|editada|atualizada|criada|modificada)|nota (alterada|editada|atualizada|modificada)|done|listo|la nota (ha sido|fue)?\s*(actualizada|editada|modificada))[\s!.,:;—\-]*$/i;

// Linha de conversa com RELATO da mudança: "Pronto! Acrescentei o passo do
// forno", "Feito: organizei em tópicos", "Done — I added the list". Sem isto a
// explicação da IA virava conteúdo da nota.
const RE_FALA_IA_RELATO = /^\s*(pronto|prontinho|feito|conclu[íi]do|ok|beleza|perfeito|claro|certeza|done|listo)\b[^\n]{0,160}\b(acrescent|adicion|añad|inclu|alter|atualiz|actualic|organiz|organic|corrig|correg|arrum|reescrev|reformul|format|coloqu|coloc|remov|apagu|exclu|tirei|tirar|added|add |updated|organized|fixed|rewrote|removed|changed|formatted|agregu|cambi)/i;

function ehFalaIA(linha: string): boolean {
  return RE_FALA_IA.test(linha) || RE_FALA_IA_RELATO.test(linha);
}

function limparFalasIA(texto: string): string {
  const linhas = String(texto || '').split('\n');
  while (linhas.length > 1 && ehFalaIA(linhas[0])) linhas.shift();
  while (linhas.length > 1 && ehFalaIA(linhas[linhas.length - 1])) linhas.pop();
  return linhas.join('\n').trim();
}

// Título não se repete dentro do corpo da nota (a IA costuma colocar lá).
function semTituloNoCorpo(html: string, titulo: string): string {
  const t = String(titulo || '').trim();
  if (!t) return html;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(html || '')
    .replace(new RegExp(`^\\s*<h[1-3][^>]*>\\s*${esc}\\s*<\\/h[1-3]>\\s*`, 'i'), '')
    .replace(new RegExp(`^\\s*${esc}\\s*(<br\\s*\\/?>|\n|$)`, 'i'), '')
    .trim();
}

function paraHtml(texto: string): string {
  const esc = (v: string) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(texto || '').split(/\n+/).map(l => l.trim()).filter(Boolean)
    .map(l => `<p>${esc(l.replace(/^[-*•]\s+/, '• '))}</p>`).join('');
}

// ---- Formatação (notação compacta) ---------------------------------------
// A IA vê a nota COM a formatação numa notação compacta (Markdown) e devolve a
// mesma notação. Enviar só texto puro obrigava o modelo a recriar do zero o que
// já existia — e negrito, listas e títulos se perdiam. Aqui ela PRESERVA o que
// existe e acrescenta conteúdo novo já formatado.
const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodificaEntidades(s: string): string {
  return String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e.charAt(0) === '#') {
      const n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(n) ? m : String.fromCharCode(n);
    }
    return ENTIDADES[e.toLowerCase()] != null ? ENTIDADES[e.toLowerCase()] : m;
  });
}

/** Normaliza a cor do editor (rgb/hex) para #RRGGBB — a notação que a IA entende. */
function corParaHex(c: string): string {
  const v = String(c || '').trim();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    return '#' + h.toUpperCase();
  }
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(v2 => {
      const n = Math.max(0, Math.min(255, parseInt(v2, 10) || 0)).toString(16).toUpperCase();
      return n.length < 2 ? '0' + n : n;
    }).join('');
  }
  return '';
}

/** HTML da nota -> notação compacta que a IA consegue manter e estender. */
export function htmlParaMarkdown(html: string): string {
  let s = String(html || '').replace(/\r/g, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${'#'.repeat(Number(n))} ${t.trim()}\n\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, t: string) => `\n\n> ${t.trim().replace(/\s*\n\s*/g, ' ')}\n\n`);
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    let i = 0;
    return `\n${inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t: string) => `${++i}. ${t.trim()}\n`)}\n`;
  });
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) =>
    `\n${inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t: string) => `- ${t.trim()}\n`)}\n`);
  s = s.replace(/<\/(p|div)>/gi, '\n\n').replace(/<(p|div)\b[^>]*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  // Cor do texto: vira [cor=#RRGGBB]…[/cor] para a IA preservar e reaproveitar.
  s = s.replace(/<span\b[^>]*style=["'][^"']*color\s*:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_m, c: string, t: string) => { const hex = corParaHex(c); return hex ? `[cor=${hex}]${t}[/cor]` : t; });
  s = s.replace(/<font\b[^>]*color=["']([^"']+)["'][^>]*>([\s\S]*?)<\/font>/gi,
    (_m, c: string, t: string) => { const hex = corParaHex(c); return hex ? `[cor=${hex}]${t}[/cor]` : t; });
  // <u> é mantido: a notação não tem sublinhado
  s = s.replace(/<(?!\/?u>)[^>]+>/g, '');
  s = decodificaEntidades(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** O texto veio na notação compacta (e não em HTML)? */
export function pareceMarkdown(s: string): boolean {
  const t = String(s || '');
  if (/<\s*(p|div|h[1-6]|ul|ol|li|br|blockquote)\b/i.test(t)) return false;
  return /\*\*[^*\n]+\*\*|^\s*[-*•]\s+\S|^\s*\d+[.)]\s+\S|^#{1,6}\s|~~[^~\n]+~~|^\s*>\s|\[cor=#[0-9a-f]{3,6}\]/im.test(t);
}

function linhaInlineHtml(txt: string): string {
  let s = String(txt || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');
  s = s.replace(/\[cor=(#[0-9a-f]{3}|#[0-9a-f]{6})\]([\s\S]*?)\[\/cor\]/gi,
    (_m, c: string, t: string) => `<span style="color:${c}">${t}</span>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

/** Notação compacta -> HTML (o que entra na nota). */
export function markdownParaHtml(md: string): string {
  const linhas = String(md || '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let lista: { tipo: 'ul' | 'ol'; itens: string[] } | null = null;
  const fecha = () => {
    if (lista) { out.push(`<${lista.tipo}>${lista.itens.map(i => `<li>${i}</li>`).join('')}</${lista.tipo}>`); lista = null; }
  };
  for (const raw of linhas) {
    const l = raw.trim();
    if (!l) { fecha(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^[-*•]\s+(.*)$/))) {
      if (!lista || lista.tipo !== 'ul') { fecha(); lista = { tipo: 'ul', itens: [] }; }
      lista.itens.push(linhaInlineHtml(m[1])); continue;
    }
    if ((m = l.match(/^\d+[.)]\s+(.*)$/))) {
      if (!lista || lista.tipo !== 'ol') { fecha(); lista = { tipo: 'ol', itens: [] }; }
      lista.itens.push(linhaInlineHtml(m[1])); continue;
    }
    fecha();
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { const n = Math.min(m[1].length, 3); out.push(`<h${n}>${linhaInlineHtml(m[2])}</h${n}>`); continue; }
    if ((m = l.match(/^>\s*(.*)$/))) { out.push(`<blockquote>${linhaInlineHtml(m[1])}</blockquote>`); continue; }
    out.push(`<p>${linhaInlineHtml(l)}</p>`);
  }
  fecha();
  return out.join('');
}

/**
 * Conteúdo final para gravar na nota: devolve a mídia original, tira falas da
 * IA ("Pronto", "A nota foi alterada"), não repete o título e GARANTE HTML — a
 * IA devolve texto puro com frequência, e gravar texto puro destruiria os
 * parágrafos (e as imagens) da nota.
 */
/** Mídias capturadas na última pergunta — a UI guarda junto da proposta. */
export function midiasDaNotaAberta(): string[] {
  return midiasNotaAberta.slice();
}

export function conteudoAplicadoDaProposta(conteudo: string, titulo: string, tituloAntigo?: string, midias?: string[]): string {
  let base = limparFalasIA(String(conteudo || ''));
  // A IA devolve a nota na notação compacta (com a formatação preservada).
  if (pareceMarkdown(base)) base = markdownParaHtml(base);
  base = semTituloNoCorpo(base, titulo);
  if (tituloAntigo && tituloAntigo !== titulo) base = semTituloNoCorpo(base, tituloAntigo);
  if (!/<(p|br|h[1-6]|ul|ol|li|div|blockquote|table|strong|em|b|i|u|span|code|pre)\b/i.test(base)) base = paraHtml(base);
  // Marca que sobrou (modelo inventou) nunca aparece dentro da nota.
  return restaurarMidias(base, midias || midiasNotaAberta).replace(/\[\[midia\d+\]\]/g, '').trim();
}

const URL_API = 'https://openrouter.ai/api/v1/chat/completions';

// ── Proxy da IA (sem chave do usuário) ───────────────────────────────────────
// O accessToken do Google vale ~1h; cacheia para não pedir a cada mensagem.
let tokenGoogleCache: { token: string; expira: number } | null = null;

async function obterTokenGoogle(): Promise<string | null> {
  if (tokenGoogleCache && Date.now() < tokenGoogleCache.expira) return tokenGoogleCache.token;
  try {
    await GoogleSignin.signInSilently().catch(() => {});
    const tokens = await GoogleSignin.getTokens();
    if (!tokens?.accessToken) return null;
    tokenGoogleCache = { token: tokens.accessToken, expira: Date.now() + 50 * 60 * 1000 };
    return tokens.accessToken;
  } catch {
    return null;
  }
}

/** Chama o Worker do app: mesma resposta do OpenRouter, sem expor a chave. */
async function chamarProxyIA(
  messages: any[],
  maxTokens: number,
  temperature: number,
): Promise<{ ok: boolean; status: number; texto: string; corpo: string }> {
  const token = await obterTokenGoogle();
  if (!token) {
    return { ok: false, status: 401, texto: '', corpo: 'login_necessario' };
  }
  const corpoReq = JSON.stringify({
    messages: messages.map((m: any) => ({ role: m.role, content: String(m.content ?? '') })),
    temperature,
    max_tokens: maxTokens,
  });
  // Duas tentativas: free model às vezes devolve 502/timeout; uma repetição
  // resolve a maioria dos "erro de conexão" que o usuário via.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 45000);
    try {
      const res = await fetch(URL_PROXY_IA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: corpoReq,
        signal: controle.signal,
      });
      const bruto = await res.text().catch(() => '');
      if (!res.ok) {
        console.warn(`[IA] proxy falhou (HTTP ${res.status}, tentativa ${tentativa}):`, bruto.slice(0, 160));
        if (tentativa === 2) return { ok: false, status: res.status, texto: '', corpo: bruto };
        continue;
      }
      let data: any = null;
      try { data = JSON.parse(bruto); } catch {}
      const conteudo: any = data?.choices?.[0]?.message?.content;
      const brutoTexto = typeof conteudo === 'string'
        ? conteudo
        : Array.isArray(conteudo)
          ? conteudo.map((p: any) => String(p?.text || '')).join('')
          : '';
      const texto = limparRaciocinio(brutoTexto).trim();
      if (!texto) {
        // Modelo pequeno vazou o raciocínio em vez da resposta: tenta de novo.
        if (tentativa === 1) continue;
        return { ok: false, status: 502, texto: '', corpo: 'resposta_invalida' };
      }
      return { ok: true, status: res.status, texto, corpo: '' };
    } catch (e) {
      if (tentativa === 2) {
        console.warn('[IA] proxy sem resposta:', e);
        return { ok: false, status: 0, texto: '', corpo: 'sem_conexao' };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, texto: '', corpo: 'sem_conexao' };
}

/**
 * Alguns modelos free pequenos "pensam em voz alta" (Analyze the Request...,
 * Persona, Constraints, Wait...). Isso nunca deve chegar ao usuário: remove os
 * parágrafos de raciocínio e, se sobrar só isso, devolve vazio (quem chamou
 * tenta outro modelo/avisa).
 */
function limparRaciocinio(texto: string): string {
  const t = String(texto || '').trim();
  if (!t) return '';
  const marcas = [
    /\*\*Analyze the Request/i,
    /User'?s Question:/i,
    /\*\*Constraints/i,
    /\*\*Persona/i,
    /\bLet me (think|analyze|check)/i,
    /\bWait,?/i,
    /I should (probably|respond|answer)/i,
    /^(Okay|Ok|Sure),?\s+(let me|I)/i,
  ];
  const temRaciocinio = marcas.some((r) => r.test(t));
  if (!temRaciocinio) return t;
  const paragrafos = t.split(/\n{2,}/);
  const respostas = paragrafos.filter((p) => !marcas.some((r) => r.test(p)));
  const limpo = respostas.join('\n\n').trim();
  return limpo.length >= 2 ? limpo : '';
}

/**
 * Chamada à API do OpenRouter — O formato canônico do app.
 *
 * (1) content sempre como ARRAY DE PARTES `[{type:'text'}]`: o validador de
 *     certos backends do roteador recusa string ("messages[N].content[M]
 *     must be an object") — era o erro que fazia a IA do CELULAR nunca
 *     conectar enquanto o PC funcionava.
 * (2) model 'openrouter/auto' (o mesmo que o PC usa na prática — os modelos
 *     "free" fixos que ele listava estão mortos/instáveis), com
 *     'openrouter/free' de reserva.
 * (3) Em falha, loga o corpo da requisição — diagnóstico no logcat sem
 *     precisar de proxy.
 * A resposta vem normalizada pra string (aceita content string OU partes).
 */
const chamarOpenRouter = async (
  chaveApi: string,
  model: string,
  messages: any[],
  maxTokens: number,
  temperature: number,
  fallback: string | null = null,
): Promise<{ ok: boolean; status: number; texto: string; corpo: string }> => {
  // Sem chave própria: usa o servidor do app (IA pronta para leigos).
  if (!chaveApi && PROXY_IA_ATIVO) {
    return chamarProxyIA(messages, maxTokens, temperature);
  }
  const corpoReq = JSON.stringify({
    model,
    messages: messages.map((m: any) => ({
      role: m.role,
      content: [{ type: 'text', text: String(m.content ?? '') }],
    })),
    temperature,
    max_tokens: maxTokens,
  });
  const res = await fetch(URL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chaveApi}`,
      'HTTP-Referer': 'https://simple-notes.app',
      'X-Title': 'Simple Notes',
    },
    body: corpoReq,
  });
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    if (fallback && res.status !== 401 && res.status !== 429) {
      console.warn(`[IA] modelo ${model} falhou (HTTP ${res.status}) — tentando ${fallback}`);
      return chamarOpenRouter(chaveApi, fallback, messages, maxTokens, temperature, null);
    }
    console.warn(`[IA] requisição falhou (HTTP ${res.status}):`, errTxt.slice(0, 200), '| corpo:', corpoReq.slice(0, 400));
    return { ok: false, status: res.status, texto: '', corpo: errTxt };
  }
  const data = await res.json().catch(() => null);
  const bruto: any = data?.choices?.[0]?.message?.content;
  const textoBruto = typeof bruto === 'string'
    ? bruto.trim()
    : Array.isArray(bruto)
      ? bruto.map((p: any) => String(p?.text || '')).join('').trim()
      : '';
  const texto = limparRaciocinio(textoBruto);
  return { ok: true, status: res.status, texto, corpo: '' };
};

// Tetos de resposta: conversa é curta; EDIÇÃO devolve a nota inteira em HTML
// (nota longa truncada perderia o bloco JSON e a edição nunca chegaria).
const TETO_CHAT = 400;
const TETO_EDICAO = 16000;
const TETO_RESERVA = 4000;

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
  'Notas com editor rico (negrito, cores, itálico, sublinhado, listas, citação, títulos e links)',
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
  if (!chaveApi && !PROXY_IA_ATIVO) {
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
    const r = await chamarOpenRouter(chaveApi, 'openrouter/auto', messages, 400, 0.5, 'openrouter/free');

    if (!r.ok) {
      if (r.status === 401) {
        return { texto: tIdioma(idioma, 'A chave de IA configurada não é válida. Verifique em Ajustes → IA.'), modo: 'offline' };
      }
      if (r.status === 429) {
        return { texto: tIdioma(idioma, 'A IA gratuita está com limite de uso no momento. Aguarde um minuto e tente de novo.'), modo: 'offline' };
      }
      throw new Error(`API ${r.status}: ${r.corpo.slice(0, 120)}`);
    }

    const texto = r.texto;
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
  idioma: Idioma = 'pt',
  /** Contexto de edição: a nota (ou lista) ABERTA no editor, para a IA poder propor alterações. */
  notaAberta?: { titulo: string; conteudo?: string; itens?: { texto: string; concluido: boolean }[]; tipo: 'nota' | 'lista' },
  /** Inventário p/ ações do agente: pastas e listas existentes (com ids). */
  pastas: any[] = [],
  listas: any[] = [],
): Promise<RespostaChat> {
  const todasNotas = Array.isArray(notas) ? notas : [];
  const todasTarefas = Array.isArray(tarefas) ? tarefas : [];
  const ordemAcao = ehOrdemAcao(pergunta);

  if (todasNotas.length === 0 && todasTarefas.length === 0 && (listas || []).length === 0) {
    // Sem notas nem tarefas: perguntas sobre o próprio app ainda são respondidas usando a
    // lista REAL de recursos — nada de invenção. Pedido OPERACIONAL com chave
    // segue em frente — a IA pode CRIAR a primeira nota/tarefa/pasta.
    if (!chaveApi && !PROXY_IA_ATIVO) {
      const recurso = respostaRecursoApp(pergunta, idioma);
      if (recurso) return { texto: recurso, modo: 'offline' };
    }
    if (!ordemAcao) {
      return {
        texto: tIdioma(idioma, 'Você ainda não tem nenhuma nota ou tarefa. Crie uma nota ou tarefa primeiro e depois me pergunte! 📝✨'),
        modo: 'fora',
      };
    }
  }

  // --- Modo offline: sem chave E sem servidor, usa a busca local (instantânea) ---
  if (!chaveApi && !PROXY_IA_ATIVO) {
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
  // A instrução de edição (e o orçamento extra de tokens para o HTML completo)
  // só entram quando o usuário realmente ORDENA uma mudança — perguntas,
  // saudações e conversa normal nunca geram carta de edição.
  const ordemEdicao = ehOrdemEdicao(pergunta);
  const contexto = montarContexto(todasNotas, todasTarefas, pergunta, true, idioma);
  // Inventário com ids: o mapa que a IA usa para preencher alvo/alvos das ações.
  const inventario = montarInventario(todasNotas, listas || [], pastas || [], todasTarefas, idioma);

  // Contexto da nota/lista aberta: dá à IA o material exato que ela pode
  // propor editar (o app só aplica após confirmação do usuário).
  let ctxAberta = '';
  if (notaAberta) {
    const tipoTxt = notaAberta.tipo === 'lista'
      ? (idioma === 'en' ? 'open list' : idioma === 'es' ? 'lista abierta' : 'lista aberta')
      : (idioma === 'en' ? 'open note' : idioma === 'es' ? 'nota abierta' : 'nota aberta');
    let conteudoTxt = '';
    if (notaAberta.tipo === 'lista' && notaAberta.itens) {
      conteudoTxt = notaAberta.itens.map(it => `- [${it.concluido ? 'x' : ' '}] ${it.texto}`).join('\n');
    } else {
      // Marcas no lugar da mídia: a IA sabe onde cada imagem/áudio está e as
      // preserva; nada de base64 (e nem de imagem sumindo na edição).
      const prep = extrairMidias(String(notaAberta.conteudo || ''));
      midiasNotaAberta = prep.midias;
      // COM a formatação: a IA mantém negrito/listas/títulos e estende a nota.
      conteudoTxt = htmlParaMarkdown(prep.texto);
      if (conteudoTxt.length > 4000) conteudoTxt = conteudoTxt.slice(0, 4000) + '…';
    }
    ctxAberta = `\n\n--- ${tipoTxt.toUpperCase()} ---\n${tIdioma(idioma, 'Título:')} ${notaAberta.titulo || tIdioma(idioma, 'Sem título')}\n${conteudoTxt}\n---`;
  }

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
          'FORMATAÇÃO DO CHAT: use **negrito**, *itálico*, listas com "- ", títulos com "## " e cores no formato [cor=#RRGGBB]texto[/cor] (ex.: [cor=#FF9F0A]Atenção[/cor]), preferindo a paleta #FF453A, #FF9F0A, #FFB300, #30D158, #64D2FF, #0A84FF, #BF5AF2 e #FF375F. Use cores com moderação, só para destacar.',
          ...(ordemEdicao && notaAberta ? [instrucaoEdicao('pt')] : []),
          instrucaoAcoes('pt'),
          REGRA_SEM_FINGIR,
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
          'CHAT FORMATTING: use **bold**, *italic*, lists with "- ", headings with "## " and colors as [cor=#RRGGBB]text[/cor] (e.g. [cor=#FF9F0A]Attention[/cor]), preferring #FF453A, #FF9F0A, #FFB300, #30D158, #64D2FF, #0A84FF, #BF5AF2 and #FF375F. Use colors sparingly, only for highlights.',
          ...(ordemEdicao && notaAberta ? [instrucaoEdicao('en')] : []),
          instrucaoAcoes('en'),
          REGRA_SEM_FINGIR,
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
          'FORMATO DEL CHAT: usa **negrita**, *cursiva*, listas con "- ", títulos con "## " y colores como [cor=#RRGGBB]texto[/cor] (ej.: [cor=#FF9F0A]Atención[/cor]), prefiriendo #FF453A, #FF9F0A, #FFB300, #30D158, #64D2FF, #0A84FF, #BF5AF2 y #FF375F. Usa colores con moderación, solo para destacar.',
          ...(ordemEdicao && notaAberta ? [instrucaoEdicao('es')] : []),
          instrucaoAcoes('es'),
          REGRA_SEM_FINGIR,
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
      content: `Estas são as notas e tarefas do usuário:\n\n${contexto}${ctxAberta}\n\nINVENTÁRIO COM IDs (use estes ids para preencher alvo/alvos das ações):\n${inventario || '(vazio)'}\n\nPergunta do usuário: ${pergunta}`,
    },
  ];

  try {
    let r = await chamarOpenRouter(chaveApi, 'openrouter/auto', messages, ordemEdicao || ordemAcao ? TETO_EDICAO : TETO_CHAT, 0.7, 'openrouter/free');
    if ((ordemEdicao || ordemAcao) && r.status === 400 && /max_tokens|maximum|too large|context length/i.test(r.corpo)) {
      r = await chamarOpenRouter(chaveApi, 'openrouter/auto', messages, TETO_RESERVA, 0.7, 'openrouter/free');
    }

    if (!r.ok) {
      if (r.status === 401) {
        return {
          texto: tIdioma(idioma, 'A chave de IA configurada não é válida. Verifique em Ajustes → IA.'),
          modo: 'offline',
        };
      }
      if (r.status === 429) {
        return {
          texto: tIdioma(idioma, 'A IA gratuita está com limite de uso no momento (muitas perguntas em pouco tempo). Aguarde um minuto e tente de novo — ou pergunte em Ajustes → IA se a chave está certa.'),
          modo: 'offline',
        };
      }
      throw new Error(`API ${r.status}: ${r.corpo.slice(0, 120)}`);
    }

    const texto = r.texto;
    if (!texto) throw new Error('Resposta vazia da API');
    return { texto, modo: 'online', ordemEdicao };
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
