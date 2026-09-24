/**
 * BACKUP NO DRIVE — quem é o arquivo canônico.
 *
 * A conta pode acabar com MAIS DE UM `backup_notas.json` (dois aparelhos criando
 * o arquivo, ou um "apagar tudo" que removeu só o primeiro). Pegar sempre
 * `files[0]` de uma lista sem ordem garantida fazia um aparelho LER um arquivo e
 * GRAVAR em outro — a alteração "não salvava na nuvem" e às vezes sumia.
 *
 * A REGRA (o mais recente é o canônico, o resto é duplicado) é a mesma do PC e
 * vive numa fonte única: desktop/src/lib/politica-sync.js. Aqui fica só o I/O.
 */
import { escolherCanonico, ordenarBackups } from '../desktop/src/lib/politica-sync';

export const NOME_BACKUP = 'backup_notas.json';

const CAMPOS = 'files(id%2CmodifiedTime%2Csize)';
const CONSULTA =
  `https://www.googleapis.com/drive/v3/files?q=name%3D%27${NOME_BACKUP}%27+and+parents+in+%27appDataFolder%27` +
  `&spaces=appDataFolder&fields=${CAMPOS}&orderBy=modifiedTime%20desc`;

export type BackupInfo = { id: string; modifiedTime: string; size?: number };

/** Lista todos os backups da conta, do mais recente para o mais antigo. */
export async function listarBackupsDrive(token: string): Promise<BackupInfo[]> {
  try {
    const r = await fetch(CONSULTA, { headers: { Authorization: `Bearer ${token}` } });
    const j: any = await r.json().catch(() => ({} as any));
    const files: BackupInfo[] = (j?.files || []).filter((f: any) => f && f.id);
    // ordena aqui também: `orderBy` não é garantido para appDataFolder
    return ordenarBackups(files);
  } catch {
    return [];
  }
}

/** Remove os backups duplicados, mantendo só o canônico. */
export async function removerBackupsDuplicados(token: string, manterId: string): Promise<number> {
  const files = await listarBackupsDrive(token);
  let removidos = 0;
  for (const f of files) {
    if (f.id === manterId) continue;
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok || r.status === 204) removidos++;
    } catch {}
  }
  return removidos;
}

/**
 * O backup canônico da conta (o mais recente), podando duplicados de passagem.
 * `null` = a conta ainda não tem backup.
 */
export async function acharBackupCanonico(token: string): Promise<BackupInfo | null> {
  const files = await listarBackupsDrive(token);
  const { canonico, duplicados } = escolherCanonico(files);
  if (!canonico) return null;
  if (duplicados.length) {
    console.log(`[Cloud] ${duplicados.length} backup(s) duplicado(s) — mantendo o mais recente.`);
    removerBackupsDuplicados(token, canonico.id).catch(() => {});
  }
  return canonico;
}
