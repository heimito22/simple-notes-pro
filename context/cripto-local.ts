/**
 * COFRE LOCAL DA CHAVE DE BACKUP (CELULAR) — expo-secure-store (Keychain/Keystore).
 *
 * A DEK (32 bytes) e o código de recuperação ficam no cofre do aparelho, um
 * par por conta Google. O envelope do backup no Drive carrega só a DEK
 * embrulhada com o código (PBKDF2); um aparelho novo precisa do código.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import Cripto from '../desktop/src/lib/cripto';

const OPCOES = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

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

/** Lê a chave da conta. Retorna {chave, codigo} ou null. */
export async function obterChave(email?: string): Promise<{ chave: string; codigo: string } | null> {
  try {
    const chave = await SecureStore.getItemAsync(chaveDek(email));
    if (!chave || !/^[0-9a-f]{64}$/i.test(chave)) return null;
    const codigo = (await SecureStore.getItemAsync(chaveCod(email))) || '';
    return { chave, codigo };
  } catch {
    return null;
  }
}

/** Cria uma DEK aleatória + código de recuperação e guarda no cofre. */
export async function criarChave(email?: string): Promise<{ chave: string; codigo: string } | null> {
  try {
    const chave = aleatorio(32);
    const codigo = Cripto.codigoDeHex(aleatorio(20));
    if (!codigo) return null;
    await SecureStore.setItemAsync(chaveDek(email), chave, OPCOES);
    await SecureStore.setItemAsync(chaveCod(email), codigo, OPCOES);
    return { chave, codigo };
  } catch {
    return null;
  }
}

/** Abre a DEK do envelope com o código digitado e guarda no cofre. */
export async function definirComCodigo(
  envelope: any,
  codigo: string,
  email?: string,
): Promise<{ chave: string; codigo: string } | null> {
  const chave = Cripto.abrirEnvelopeComCodigo(envelope, codigo);
  if (!chave) return null;
  const normalizado = Cripto.normalizarCodigo(codigo) || '';
  try {
    await SecureStore.setItemAsync(chaveDek(email), chave, OPCOES);
    await SecureStore.setItemAsync(chaveCod(email), normalizado, OPCOES);
    return { chave, codigo: normalizado };
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
  } catch {}
}
