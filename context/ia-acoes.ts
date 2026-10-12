/**
 * AÇÕES DA IA — o protocolo que transforma o NotaIA em agente do app.
 *
 * A IA responde com um bloco ```json {"acoes":[...]} ``` propondo operações
 * (criar nota/lista/tarefa/pasta, mover, fixar, apagar, lembretes…). O app:
 *   1. extraiAcoes()  — separa o texto da conversa do bloco de ações
 *   2. resumoAcoes()  — mostra o cartão "Quero fazer isso" com as linhas legíveis
 *   3. executarAcoes() — SÓ após o usuário tocar em Aplicar, executa cada ação
 *      pelas funções OFICIAIS dos contexts (salvarNota, criarPasta,
 *      adicionarTarefa…) — mesmo caminho da UI, com dataModificacao carimbado,
 *      tombstones nas exclusões e alarmes agendados. A sincronização PC ↔
 *      celular acontece exatamente como se o usuário tivesse feito à mão.
 *
 * A IA NUNCA aplica nada sozinha — sempre com confirmação explícita.
 */

import { conteudoAplicadoDaProposta, extrairMidias } from './ia-service';

// ── Tipos ────────────────────────────────────────────────────────────────

export type TipoAcao =
  | 'criar_nota' | 'editar_nota' | 'criar_lista' | 'editar_lista'
  | 'apagar_nota' | 'fixar_nota' | 'criar_tarefa' | 'concluir_tarefa'
  | 'apagar_tarefa' | 'criar_pasta' | 'mover_para_pasta' | 'lembrete_nota';

/** Ação proposta pela IA — campos soltos, validados na extração e na execução. */
export interface AcaoIA {
  tipo: TipoAcao;
  /** Título (criar/editar nota, lista, tarefa) ou nome (pasta). */
  titulo?: string;
  nome?: string;
  /** Conteúdo em notação compacta (mesma do protocolo de edição). */
  conteudo?: string;
  /** Para listas: itens completos. */
  itens?: { texto: string; concluido?: boolean }[];
  /** Id do alvo (editar/apagar/fixar/lembrete/concluir) — vem do contexto da IA. */
  alvo?: string;
  /** Para mover: ids dos itens. */
  alvos?: string[];
  /** Nome da pasta de destino (null/vazio = lista principal). */
  pasta?: string | null;
  /** Fixar/concluir: estado desejado (default true). */
  valor?: boolean;
  /** Tarefa: 'Uma vez' | 'Diária' | 'Segunda'..'Domingo'. */
  recorrencia?: string;
  /** Tarefa/lembrete: 'HH:MM'. */
  horario?: string;
  /** Lembrete de nota (null = remover). */
  lembrete?: {
    tipo?: string; data?: string; intervaloDias?: number;
    diasSemana?: string[]; horario?: string;
  } | null;
  /** Fixar a nota recém-criada. */
  fixar?: boolean;
  /** Frase curta da IA sobre a ação (exibida no cartão). */
  explicacao?: string;
}

/** Dependências: as funções OFICIAIS dos contexts + dados atuais. */
export interface DepsAcoes {
  notas: any[];
  pastas: any[];
  listas: any[];
  tarefas: any[];
  salvarNota: (titulo: string, conteudo: string, id?: string, protegida?: boolean, pastaId?: string | null) => string;
  criarPasta: (nome: string) => string;
  moverNotasParaPasta: (ids: string[], pastaId: string | null) => void;
  moverListasParaPasta: (ids: string[], pastaId: string | null) => void;
  alternarFixarNota: (id: string) => void;
  alternarFixarLista?: (id: string) => void;
  salvarLembreteNota: (id: string, lembrete: any) => Promise<void>;
  excluirNota: (id: string) => void;
  excluirLista?: (id: string) => void;
  salvarLista: (lista: any) => void;
  adicionarTarefa: (titulo: string, recorrencia: string, horario: string) => Promise<void> | void;
  alternarTarefa: (id: string) => void;
  excluirTarefa?: (id: string) => void;
  /** Id da nota aberta no editor (edições nela passam pelo estado local). */
  notaAbertaId?: string;
  /** Aplica título+conteúdo na nota ABERTA (estado local do editor). */
  aplicarNaNotaAberta?: (titulo: string, conteudo: string) => void;
  /** Tradução (opcional — linhas de resultado do chat). */
  t?: (s: string) => string;
}

// ── Utilidades ────────────────────────────────────────────────────────────

const novoId = () => Math.random().toString(36).slice(2, 11);

const RECORRENCIAS = ['Uma vez', 'Diária', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

/** Normaliza a recorrência que a IA mandou (aceita variantes comuns). */
function normRecorrencia(v: any): string {
  const s = String(v ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // sem acentos
  if (!s) return 'Uma vez';
  if (/^(uma vez|once|unic[oa]|one time)$/.test(s)) return 'Uma vez';
  if (/^(diari[oa]|daily|todo dia|todos os dias|cada dia)$/.test(s)) return 'Diária';
  const dias: [RegExp, string][] = [
    [/^(domingo|sunday|sun)$/, 'Domingo'],
    [/^(segunda|monday|mon|segunda-feira)$/, 'Segunda'],
    [/^(terca|tuesday|tue|terca-feira)$/, 'Terça'],
    [/^(quarta|wednesday|wed|quarta-feira)$/, 'Quarta'],
    [/^(quinta|thursday|thu|quinta-feira)$/, 'Quinta'],
    [/^(sexta|friday|fri|sexta-feira)$/, 'Sexta'],
    [/^(sabado|saturday|sat|sabado-feira)$/, 'Sábado'],
  ];
  for (const [re, val] of dias) if (re.test(s)) return val;
  return 'Uma vez';
}

/** Valida/formato o horário — sempre 'HH:MM' (default 09:00). */
function normHorario(v: any): string {
  const m = String(v ?? '').match(/(\d{1,2})[:h](\d{2})/);
  if (!m) return '09:00';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const DIAS_VALIDOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Valida o lembrete proposto — null se inválido. */
function normLembrete(v: any): any | null {
  if (!v || typeof v !== 'object') return null;
  const tipo = v.tipo === 'dias' ? 'dias' : v.tipo === 'semana' ? 'semana' : 'data';
  const lembrete: any = { tipo, horario: normHorario(v.horario) };
  if (tipo === 'data') {
    const m = String(v.data ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    lembrete.data = `${m[1]}-${m[2]}-${m[3]}`;
  } else if (tipo === 'dias') {
    const n = Number(v.intervaloDias);
    if (!isFinite(n) || n < 1 || n > 365) return null;
    lembrete.intervaloDias = Math.floor(n);
  } else {
    const dias = Array.isArray(v.diasSemana)
      ? v.diasSemana.map((d: any) => {
          const s = String(d).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          const achou = DIAS_VALIDOS.find(x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === s);
          return achou || null;
        }).filter(Boolean)
      : [];
    if (!dias.length) return null;
    lembrete.diasSemana = dias;
  }
  return lembrete;
}

/** Título legível de um item pelo id (nota OU lista OU tarefa). */
function tituloDoId(id: string | undefined, deps: DepsAcoes): string {
  if (!id) return '?';
  const n = deps.notas.find((x: any) => x?.id === id);
  if (n) return n.titulo || 'Sem título';
  const l = deps.listas.find((x: any) => x?.id === id);
  if (l) return l.titulo || 'Sem título';
  const t = deps.tarefas.find((x: any) => x?.id === id);
  if (t) return t.titulo || '?';
  return '?';
}

/**
 * Resolve o NOME da pasta para id — cria a pasta se ainda não existir.
 * (O cartão de confirmação já mostra "Criar pasta X" quando isso vai acontecer.)
 */
function resolverPastaId(nome: string | null | undefined, deps: DepsAcoes, resultados: string[], t: (s: string) => string): string | null | undefined {
  if (nome === null) return null;               // explicitamente sair da pasta
  const alvo = String(nome ?? '').trim();
  if (!alvo) return undefined;                  // sem pasta → onde estiver
  const norm = (s: string) => s.trim().toLowerCase();
  const existente = deps.pastas.find((p: any) => norm(p?.nome || '') === norm(alvo));
  if (existente) return existente.id;
  const novoId = deps.criarPasta(alvo);
  resultados.push(`✅ ${t('Pasta criada')}: "${alvo}"`);
  return novoId;
}

// ── Extração do bloco de ações ────────────────────────────────────────────

const TIPOS_VALIDOS: TipoAcao[] = [
  'criar_nota', 'editar_nota', 'criar_lista', 'editar_lista',
  'apagar_nota', 'fixar_nota', 'criar_tarefa', 'concluir_tarefa',
  'apagar_tarefa', 'criar_pasta', 'mover_para_pasta', 'lembrete_nota',
];

const MAX_ACOES = 10;

/** Campo obrigatório presente? (string não vazia) */
const tem = (v: any) => typeof v === 'string' && v.trim().length > 0;

/**
 * Procura o bloco ```json {"acoes":[…]} ``` na resposta (ou JSON solto).
 * Valida tipo + campos mínimos; descarta ações inválidas silenciosamente
 * (a IA pode errar — cada ação é independente).
 */
export function extrairAcoes(texto: string): { acoes: AcaoIA[] | null; textoLimpo: string } {
  const bruto = String(texto || '');
  const cerca = bruto.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const solto = bruto.match(/\{[\s\S]*?"acoes"[\s\S]*\}/);
  const candidatos: string[] = [];
  if (cerca) candidatos.push(cerca[1]);
  if (solto) candidatos.push(solto[0]);

  for (const cand of candidatos) {
    try {
      const obj = JSON.parse(cand);
      const lista = obj && Array.isArray(obj.acoes) ? obj.acoes : null;
      if (!lista || !lista.length) continue;
      const validas: AcaoIA[] = [];
      for (const a of lista) {
        if (!a || typeof a !== 'object') continue;
        const tipo = TIPOS_VALIDOS.find(x => x === a.tipo);
        if (!tipo) continue;
        const ok =
          (tipo === 'criar_nota' && tem(a.titulo)) ||
          (tipo === 'editar_nota' && tem(a.alvo)) ||
          (tipo === 'criar_lista' && tem(a.titulo)) ||
          (tipo === 'editar_lista' && tem(a.alvo)) ||
          (tipo === 'apagar_nota' && tem(a.alvo)) ||
          (tipo === 'fixar_nota' && tem(a.alvo)) ||
          (tipo === 'criar_tarefa' && tem(a.titulo)) ||
          (tipo === 'concluir_tarefa' && tem(a.alvo)) ||
          (tipo === 'apagar_tarefa' && tem(a.alvo)) ||
          (tipo === 'criar_pasta' && tem(a.nome)) ||
          (tipo === 'mover_para_pasta' && Array.isArray(a.alvos) && a.alvos.length > 0) ||
          (tipo === 'lembrete_nota' && tem(a.alvo));
        if (ok) validas.push({ ...a, tipo });
      }
      if (validas.length) {
        const limpo = bruto.replace((cerca && cerca[0]) || (solto && solto[0]) || '', '').trim();
        return { acoes: validas.slice(0, MAX_ACOES), textoLimpo: limpo };
      }
    } catch { /* JSON inválido — tenta o próximo candidato */ }
  }
  return { acoes: null, textoLimpo: bruto };
}

// ── Resumo legível (cartão de confirmação) ────────────────────────────────

/** Linha curta e legível da ação, pro cartão "Quero fazer isto". */
export function resumoAcao(a: AcaoIA, deps?: Partial<DepsAcoes>): string {
  const nome = (id?: string) => (deps ? tituloDoId(id, deps as DepsAcoes) : id);
  switch (a.tipo) {
    case 'criar_nota': {
      let s = `📝 Criar nota "${a.titulo}"`;
      if (a.pasta) s += ` na pasta "${a.pasta}"`;
      if (a.lembrete) s += ` com lembrete`;
      if (a.fixar) s += ` (fixada)`;
      return s;
    }
    case 'editar_nota': return `✏️ Editar nota "${nome(a.alvo)}"`;
    case 'criar_lista': return `📋 Criar lista "${a.titulo}"${(a.itens?.length ?? 0) > 0 ? ` com ${a.itens!.length} itens` : ''}${a.pasta ? ` na pasta "${a.pasta}"` : ''}`;
    case 'editar_lista': return `✏️ Editar lista "${nome(a.alvo)}"`;
    case 'apagar_nota': return `🗑 Apagar "${nome(a.alvo)}"`;
    case 'fixar_nota': return `📌 ${a.valor === false ? 'Desafixar' : 'Fixar'} "${nome(a.alvo)}"`;
    case 'criar_tarefa': return `⏰ Criar tarefa "${a.titulo}" — ${normRecorrencia(a.recorrencia)} às ${normHorario(a.horario)}`;
    case 'concluir_tarefa': return `✔️ ${a.valor === false ? 'Reabrir' : 'Concluir'} tarefa "${nome(a.alvo)}"`;
    case 'apagar_tarefa': return `🗑 Apagar tarefa "${nome(a.alvo)}"`;
    case 'criar_pasta': return `📁 Criar pasta "${a.nome}"`;
    case 'mover_para_pasta': return `➡️ Mover ${(a.alvos?.length ?? 0)} item(ns) para ${a.pasta ? `"${a.pasta}"` : 'a lista principal'}`;
    case 'lembrete_nota': return a.lembrete ? `🔔 Lembrar da nota "${nome(a.alvo)}"` : `🔕 Remover lembrete da nota "${nome(a.alvo)}"`;
    default: return `• ${a.tipo}`;
  }
}

// ── Execução (SEMPRE após confirmação do usuário) ────────────────────────

/**
 * Executa as ações confirmadas pelas funções OFICIAIS dos contexts.
 * Devolve as linhas de resultado para o chat ("✅ Nota 'X' criada").
 */
export async function executarAcoes(acoes: AcaoIA[], deps: DepsAcoes): Promise<string[]> {
  const t = deps.t || ((s: string) => s);
  const resultados: string[] = [];

  for (const a of acoes) {
    try {
      switch (a.tipo) {
        case 'criar_nota': {
          const titulo = String(a.titulo || '').trim();
          const conteudo = conteudoAplicadoDaProposta(String(a.conteudo || ''), titulo, undefined, []);
          let pastaId: string | null | undefined;
          if (a.pasta) pastaId = resolverPastaId(a.pasta, deps, resultados, t) ?? undefined;
          const id = deps.salvarNota(titulo, conteudo, undefined, false, pastaId);
          if (a.fixar) deps.alternarFixarNota(id);
          if (a.lembrete) {
            const lem = normLembrete(a.lembrete);
            if (lem) await deps.salvarLembreteNota(id, lem);
          }
          resultados.push(`✅ ${t('Nota criada')}: "${titulo}"${a.lembrete ? ' 🔔' : ''}`);
          break;
        }

        case 'editar_nota': {
          const nota = deps.notas.find((n: any) => n?.id === a.alvo);
          if (!nota) { resultados.push(`⚠️ ${t('Nota não encontrada')} (${a.alvo})`); break; }
          const novoTitulo = tem(a.titulo) ? String(a.titulo).trim() : nota.titulo;
          // Mídia da nota ATUAL vira marca; o conteúdo da IA volta com ela.
          const prep = extrairMidias(String(nota.conteudo || ''));
          const novoConteudo = tem(a.conteudo)
            ? conteudoAplicadoDaProposta(String(a.conteudo), novoTitulo, nota.titulo, prep.midias)
            : String(nota.conteudo || '');
          if (deps.notaAbertaId && a.alvo === deps.notaAbertaId && deps.aplicarNaNotaAberta) {
            deps.aplicarNaNotaAberta(novoTitulo, novoConteudo);
          } else {
            deps.salvarNota(novoTitulo, novoConteudo, a.alvo, !!nota.protegida, nota.pastaId ?? undefined);
          }
          resultados.push(`✅ ${t('Nota atualizada')}: "${novoTitulo}"`);
          break;
        }

        case 'criar_lista': {
          const itens = (Array.isArray(a.itens) ? a.itens : [])
            .filter((it: any) => it && tem(it.texto))
            .map((it: any) => ({ id: novoId(), texto: String(it.texto).trim(), concluido: !!it.concluido }));
          let pastaId: string | null | undefined;
          if (a.pasta) pastaId = resolverPastaId(a.pasta, deps, resultados, t) ?? undefined;
          deps.salvarLista({
            id: novoId(),
            titulo: String(a.titulo || '').trim() || t('Nova lista'),
            itens,
            fixada: false,
            ...(pastaId ? { pastaId } : {}),
          });
          resultados.push(`✅ ${t('Lista criada')}: "${a.titulo}" (${itens.length} ${t('itens')})`);
          break;
        }

        case 'editar_lista': {
          const lista = deps.listas.find((l: any) => l?.id === a.alvo);
          if (!lista) { resultados.push(`⚠️ ${t('Lista não encontrada')} (${a.alvo})`); break; }
          const nova = {
            ...lista,
            titulo: tem(a.titulo) ? String(a.titulo).trim() : lista.titulo,
            itens: Array.isArray(a.itens)
              ? a.itens.filter((it: any) => it && tem(it.texto))
                  .map((it: any) => ({ id: novoId(), texto: String(it.texto).trim(), concluido: !!it.concluido }))
              : lista.itens,
          };
          deps.salvarLista(nova);
          resultados.push(`✅ ${t('Lista atualizada')}: "${nova.titulo}"`);
          break;
        }

        case 'apagar_nota': {
          const nota = deps.notas.find((n: any) => n?.id === a.alvo);
          if (nota) {
            deps.excluirNota(a.alvo!);
            resultados.push(`🗑 ${t('Apagada')}: "${nota.titulo || t('Sem título')}"`);
            break;
          }
          const lista = deps.listas.find((l: any) => l?.id === a.alvo);
          if (lista) {
            if (deps.excluirLista) deps.excluirLista(a.alvo!);
            else { resultados.push(`⚠️ ${t('Não consegui apagar a lista')}`); break; }
            resultados.push(`🗑 ${t('Apagada')}: "${lista.titulo || t('Nova lista')}"`);
            break;
          }
          resultados.push(`⚠️ ${t('Item não encontrado')} (${a.alvo})`);
          break;
        }

        case 'fixar_nota': {
          const quer = a.valor !== false;
          const nota = deps.notas.find((n: any) => n?.id === a.alvo);
          if (nota) {
            if (!!nota.fixada !== quer) deps.alternarFixarNota(a.alvo!);
            resultados.push(`${quer ? '📌' : '📌'} ${quer ? t('Fixada') : t('Desafixada')}: "${nota.titulo || t('Sem título')}"`);
            break;
          }
          const lista = deps.listas.find((l: any) => l?.id === a.alvo);
          if (lista && deps.alternarFixarLista) {
            if (!!lista.fixada !== quer) deps.alternarFixarLista(a.alvo!);
            resultados.push(`${quer ? '📌' : '📌'} ${quer ? t('Fixada') : t('Desafixada')}: "${lista.titulo || ''}"`);
            break;
          }
          resultados.push(`⚠️ ${t('Item não encontrado')} (${a.alvo})`);
          break;
        }

        case 'criar_tarefa': {
          const rec = normRecorrencia(a.recorrencia);
          const hor = normHorario(a.horario);
          await deps.adicionarTarefa(String(a.titulo || '').trim(), rec, hor);
          resultados.push(`✅ ${t('Tarefa criada')}: "${a.titulo}" — ${rec} ${t('às')} ${hor}`);
          break;
        }

        case 'concluir_tarefa': {
          const tarefa = deps.tarefas.find((x: any) => x?.id === a.alvo);
          if (!tarefa) { resultados.push(`⚠️ ${t('Tarefa não encontrada')} (${a.alvo})`); break; }
          const quer = a.valor !== false;
          if (!!tarefa.concluida !== quer) deps.alternarTarefa(a.alvo!);
          resultados.push(`${quer ? '✔️' : '↩️'} ${quer ? t('Tarefa concluída') : t('Tarefa reaberta')}: "${tarefa.titulo}"`);
          break;
        }

        case 'apagar_tarefa': {
          const tarefa = deps.tarefas.find((x: any) => x?.id === a.alvo);
          if (!tarefa || !deps.excluirTarefa) { resultados.push(`⚠️ ${t('Tarefa não encontrada')} (${a.alvo})`); break; }
          deps.excluirTarefa(a.alvo!);
          resultados.push(`🗑 ${t('Tarefa apagada')}: "${tarefa.titulo}"`);
          break;
        }

        case 'criar_pasta': {
          deps.criarPasta(String(a.nome || '').trim());
          resultados.push(`✅ ${t('Pasta criada')}: "${a.nome}"`);
          break;
        }

        case 'mover_para_pasta': {
          const alvos = (Array.isArray(a.alvos) ? a.alvos : []).filter(Boolean);
          let pastaId: string | null;
          if (a.pasta) pastaId = resolverPastaId(a.pasta, deps, resultados, t) ?? null;
          else pastaId = null;
          const idsNotas = alvos.filter((id: string) => deps.notas.some((n: any) => n?.id === id));
          const idsListas = alvos.filter((id: string) => deps.listas.some((l: any) => l?.id === id));
          if (idsNotas.length) deps.moverNotasParaPasta(idsNotas, pastaId);
          if (idsListas.length && deps.moverListasParaPasta) deps.moverListasParaPasta(idsListas, pastaId);
          const destino = a.pasta ? `"${a.pasta}"` : t('a lista principal');
          resultados.push(`✅ ${(idsNotas.length + idsListas.length)} ${t('item(ns) movido(s) para')} ${destino}`);
          break;
        }

        case 'lembrete_nota': {
          const nota = deps.notas.find((n: any) => n?.id === a.alvo);
          if (!nota) { resultados.push(`⚠️ ${t('Nota não encontrada')} (${a.alvo})`); break; }
          if (a.lembrete === null) {
            await deps.salvarLembreteNota(a.alvo!, null);
            resultados.push(`🔕 ${t('Lembrete removido')}: "${nota.titulo || t('Sem título')}"`);
          } else {
            const lem = normLembrete(a.lembrete);
            if (!lem) { resultados.push(`⚠️ ${t('Lembrete inválido — use data (yyyy-mm-dd), intervalo de dias ou dias da semana, com horário HH:MM')}`); break; }
            await deps.salvarLembreteNota(a.alvo!, lem);
            const quando = lem.tipo === 'data' ? lem.data
              : lem.tipo === 'dias' ? `${t('a cada')} ${lem.intervaloDias} ${t('dias')}`
              : (lem.diasSemana || []).join(', ');
            resultados.push(`🔔 ${t('Lembrete criado')}: "${nota.titulo || t('Sem título')}" — ${quando} ${t('às')} ${lem.horario}`);
          }
          break;
        }
      }
    } catch (e: any) {
      resultados.push(`⚠️ ${a.tipo}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }

  return resultados;
}
