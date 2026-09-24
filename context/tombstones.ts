/**
 * Registro de APAGADOS no CELULAR — persistência (AsyncStorage) + o que é só
 * do celular.
 *
 * A POLÍTICA (o que é um tombstone, quando ele vale, o merge por item) vive em
 * UMA única fonte compartilhada com o PC: desktop/src/lib/politica-sync.js
 * (+ .d.ts para os tipos). Antes ela era copiada aqui e lá, e as duas versões
 * divergiram — foi assim que PC e celular passaram a apagar diferente.
 *
 * O `.d.ts` ao lado dá a tipagem; o Metro empacota o `.js`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  criarRegistroApagados,
  mesclarPorItem as mesclarPolitica,
  tsDoItem,
  JANELA_MS,
  LIMITE,
} from '../desktop/src/lib/politica-sync';

/*
 * DURABILIDADE: o registro de exclusões vai para o disco a cada mudança.
 *
 * Sem isto ele vivia só na memória: ao fechar/reabrir o app as exclusões
 * conhecidas sumiam, o próximo push subia `apagados: []` (apagando o registro
 * que estava na nuvem) e o aparelho, vendo a nota apagada no outro como
 * "só-local", a REENVIAVA — a exclusão não se sustentava.
 */
const CHAVE_DISCO = '@sn_apagados';
let hidratado = false;

const registro = criarRegistroApagados({
  gravar: (apagados) => {
    // No disco do celular ficam só os LIMITE mais recentes: é o aparelho que
    // mais registra exclusão e não pode crescer sem fim.
    const ids = Object.keys(apagados)
      .sort((a, b) => (apagados[b] || 0) - (apagados[a] || 0))
      .slice(0, LIMITE);
    const guardar: Record<string, number> = {};
    for (const id of ids) guardar[id] = apagados[id];
    AsyncStorage.setItem(CHAVE_DISCO, JSON.stringify(guardar)).catch(() => {});
  },
});

/** Carrega o registro do disco (uma vez, no boot do NotasProvider). */
export const hidratarApagados = async () => {
  if (hidratado) return;
  hidratado = true;
  try {
    const bruto = await AsyncStorage.getItem(CHAVE_DISCO);
    if (!bruto) return;
    registro.hidratar(JSON.parse(bruto || '{}'), { janelaMs: JANELA_MS });
  } catch {}
};

export const registrarApagado = (id: string) => registro.registrar(id);

export const registrarApagados = (ids: (string | { id: string })[]) => registro.registrarVarios(ids);

export const foiApagado = (id: string) => registro.foiApagado(id);

/** Serializa para o backup (últimos 500). */
export const serializarApagados = () => registro.serializar();

/** Carrega do backup remoto, acumulando (nunca regride um ts). */
export const carregarApagados = (lista: { id: string; ts?: number }[] | undefined | null) => registro.carregar(lista);

export const esquecerApagado = (id: string) => registro.esquecer(id);

export const limparApagados = () => { hidratado = true; registro.limpar(); };

export const quantidadeApagados = () => registro.quantidade();

/**
 * Merge POR ITEM (política compartilhada) usando os tombstones deste aparelho.
 * `localVenceu` avisa que o resultado tem algo que a nuvem não tem — inclusive
 * uma exclusão que ela ainda não conhece.
 */
export const mesclarPorItem = (remotos: any[], locais: any[]) => mesclarPolitica(remotos, locais, registro);

/** Compat: mesmo merge, devolvendo só os itens. */
export const mesclarComTombstones = (remotos: any[], locais: any[]) => mesclarPolitica(remotos, locais, registro).itens;

export const tsDoItemExportado = tsDoItem;

/**
 * Assinatura barata do item (FNV-1a sobre os campos editáveis): diz o que
 * MUDOU de verdade sem comparar o JSON inteiro — nota com imagem em base64
 * chega a centenas de KB e o app roda em qualquer celular.
 */
const CAMPOS_ASSINATURA = ['titulo', 'conteudo', 'fixada', 'pastaId', 'concluida', 'recorrencia', 'horario', 'protegida'];
export const assinaturaItem = (it: any): string => {
  const partes: string[] = [];
  for (const campo of CAMPOS_ASSINATURA) partes.push(String(it?.[campo] ?? ''));
  partes.push(JSON.stringify(it?.lembrete ?? null));
  for (const x of it?.itens || []) partes.push(String(x?.texto ?? ''), x?.concluido ? '1' : '0');
  const s = partes.join('\u0001');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h.toString(36) + ':' + s.length;
};
