/**
 * COFRE LOCAL DA CHAVE DE BACKUP (CELULAR) — expo-secure-store (Keychain/Keystore).
 *
 * Guarda a DEK (32 bytes), o código de recuperação e o BLOB DA DEK JÁ
 * EMBRULHADA. O blob é reutilizado em cada envio: o PBKDF2 (caro) roda só na
 * criação da chave e no desbloqueio em um aparelho novo — nunca no push.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import Cripto from '../desktop/src/lib/cripto';

const OPCOES = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const ITERACOES = 100000;

export type ChaveBackupLocal = {
  chave: string;
  codigo: string;
  kdf?: { alg: string; it: number; salt: string; tipo?: string };
  chaveEmbrulhada?: { iv: string; dados: string; mac: string };
};

/** Bytes aleatórios do CSPRNG nativo, em hex. */
export function aleatorio(n: number): string {
  const bytes = Crypto.getRandomBytes(n);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function slug(email?: string): string {
  return String(email || 'local').toLowerCase().trim()
    .replace(/[^a-z0-9]/g, '_').slice(0, 80) || 'local';
}
function chaveDek(email?: string) { return 'sn_pro_dek_' + slug(email); }
function chaveCod(email?: string) { return 'sn_pro_cod_' + slug(email); }
function chaveWrap(email?: string) { return 'sn_pro_wrap_' + slug(email); }

/** Lê a chave da conta. Retorna null se não houver. */
export async function obterChave(email?: string): Promise<ChaveBackupLocal | null> {
  try {
    const chave = await SecureStore.getItemAsync(chaveDek(email));
    if (!chave || !/^[0-9a-f]{64}$/i.test(chave)) return null;
    const codigo = (await SecureStore.getItemAsync(chaveCod(email))) || '';
    let kdf: ChaveBackupLocal['kdf'];
    let chaveEmbrulhada: ChaveBackupLocal['chaveEmbrulhada'];
    try {
      const bruto = await SecureStore.getItemAsync(chaveWrap(email));
      if (bruto) {
        const w = JSON.parse(bruto);
        if (w && w.kdf && w.chave && w.kdf.salt && w.chave.iv) {
          kdf = w.kdf;
          chaveEmbrulhada = w.chave;
        }
      }
    } catch {}
    return { chave, codigo, kdf, chaveEmbrulhada };
  } catch {
    return null;
  }
}

/** Guarda o blob da DEK embrulhada para reutilizar nos próximos pushes. */
export async function salvarEmbrulho(
  email: string | undefined,
  kdf: ChaveBackupLocal['kdf'],
  chaveEmbrulhada: ChaveBackupLocal['chaveEmbrulhada'],
): Promise<void> {
  try {
    if (!kdf || !chaveEmbrulhada) return;
    await SecureStore.setItemAsync(chaveWrap(email), JSON.stringify({ kdf, chave: chaveEmbrulhada }), OPCOES);
  } catch {}
}

/** Cria uma DEK aleatória + código e embrulha UMA vez (PBKDF2). */
export async function criarChave(email?: string): Promise<ChaveBackupLocal | null> {
  try {
    const chave = aleatorio(32);
    const codigo = Cripto.codigoDeHex(aleatorio(20));
    if (!codigo) return null;
    const salt = aleatorio(16);
    const ivChave = aleatorio(16);
    const w = Cripto.embrulharChave(chave, codigo, salt, ivChave, ITERACOES);
    if (!w) return null;
    const chaveEmbrulhada = { iv: ivChave, dados: w.dados, mac: w.mac };
    const kdf = { alg: 'PBKDF2-SHA256', it: ITERACOES, salt, tipo: 'codigo' };
    await SecureStore.setItemAsync(chaveDek(email), chave, OPCOES);
    await SecureStore.setItemAsync(chaveCod(email), codigo, OPCOES);
    await salvarEmbrulho(email, kdf, chaveEmbrulhada);
    return { chave, codigo, kdf, chaveEmbrulhada };
  } catch {
    return null;
  }
}

/** Abre a DEK do envelope com o código digitado e guarda no cofre. */
export async function definirComCodigo(
  envelope: any,
  codigo: string,
  email?: string,
): Promise<ChaveBackupLocal | null> {
  const chave = Cripto.abrirEnvelopeComCodigo(envelope, codigo);
  if (!chave) return null;
  const normalizado = Cripto.normalizarCodigo(codigo) || '';
  const kdf = envelope?.kdf;
  const chaveEmbrulhada = envelope?.chave;
  try {
    await SecureStore.setItemAsync(chaveDek(email), chave, OPCOES);
    await SecureStore.setItemAsync(chaveCod(email), normalizado, OPCOES);
    if (kdf && chaveEmbrulhada) await salvarEmbrulho(email, kdf, chaveEmbrulhada);
    return { chave, codigo: normalizado, kdf, chaveEmbrulhada };
  } catch {
    return null;
  }
}

/** Código para mostrar em Ajustes (null se não houver chave). */
export async function revelarCodigo(email?: string): Promise<string | null> {
  const o = await obterChave(email);
  return o ? o.codigo : null;
}

/** Remove a chave da conta. */
export async function limparChave(email?: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(chaveDek(email));
    await SecureStore.deleteItemAsync(chaveCod(email));
    await SecureStore.deleteItemAsync(chaveWrap(email));
  } catch {}
}
