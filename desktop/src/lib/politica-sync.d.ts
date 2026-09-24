/**
 * Tipos da política compartilhada (desktop/src/lib/politica-sync.js).
 *
 * O celular importa o .js por este caminho relativo; o TypeScript resolve
 * ESTE .d.ts (vem antes do .js na resolução de módulos), então a tipagem
 * acompanha o arquivo sem que o desktop precise de build.
 */

export type Tombstone = { id: string; ts: number };
export type ArquivoBackup = { id: string; modifiedTime?: string | null; size?: number | null };

export declare const JANELA_MS: number;
export declare const LIMITE: number;

export declare function tsDoItem(item: any): number;

export type RegistroApagados = {
  /** Carrega do disco/backup; nunca regride um ts. `janelaMs` descarta os vencidos. */
  hidratar(obj: Record<string, number> | null | undefined, opcoes?: { janelaMs?: number }): void;
  registrar(id: string): void;
  registrarVarios(ids: (string | { id: string })[]): void;
  foiApagado(id: string): boolean;
  ts(id: string): number;
  esquecer(id: string): void;
  serializar(): Tombstone[];
  carregar(lista: Tombstone[] | { id: string; ts?: number }[] | null | undefined): void;
  podar(maxIdadeMs?: number): void;
  limpar(): void;
  quantidade(): number;
  paraObjeto(): Record<string, number>;
};

export declare function criarRegistroApagados(opcoes?: {
  gravar?: (apagados: Record<string, number>) => void;
  agora?: () => number;
}): RegistroApagados;

export declare function mesclarPorItem(
  remotos: any[],
  locais: any[],
  registro?: RegistroApagados
): { itens: any[]; localVenceu: boolean };

export declare function ordenarBackups<T extends ArquivoBackup>(arquivos: T[] | null | undefined): T[];

export declare function escolherCanonico<T extends ArquivoBackup>(
  arquivos: T[] | null | undefined
): { canonico: T | null; duplicados: T[]; ordenados: T[] };
