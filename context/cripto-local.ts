/**
 * CRIPTOGRAFIA LOCAL (CELULAR) — encripta dados sensíveis no AsyncStorage.
 *
 * Usa o mesmo módulo compartilhado com o PC (`desktop/src/lib/cripto.js`).
 * A chave é derivada do email da conta Google (mesma chave = PC e celular).
 * Se não logado, usa uma chave derivada do device ID.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { derivarChave, encriptar, descriptografar, encriptarJSON, descriptografarJSON, estaEncriptado } from '../desktop/src/lib/cripto';

const CHAVE_ENC = '@sn_chave_local';
let chaveCache: string | null = null;

/** Obtém a chave de criptografia (derivada do email da conta, ou device ID). */
export async function obterChave(email?: string): Promise<string | null> {
  if (chaveCache) return chaveCache;
  try {
    let emailUso = email;
    if (!emailUso) {
      const salvo = await AsyncStorage.getItem('@sn_email_drive');
      emailUso = salvo || undefined;
    }
    if (!emailUso) {
      // Sem conta Google: usa identificador local
      const devId = await AsyncStorage.getItem('@sn_device_id');
      if (!devId) {
        const novo = Math.random().toString(36).substring(2) + Date.now().toString(36);
        await AsyncStorage.setItem('@sn_device_id', novo);
        emailUso = novo;
      } else {
        emailUso = devId;
      }
    }
    const chave = derivarChave(emailUso);
    if (chave) chaveCache = chave;
    return chave;
  } catch (e) {
    return null;
  }
}

/** Invalida cache da chave (ao trocar de conta). */
export function limparChave(): void {
  chaveCache = null;
}

/** Encripta um valor string antes de gravar no AsyncStorage. */
export async function gravarSeguro(chave: string, valor: string): Promise<boolean> {
  try {
    const chaveEnc = await obterChave();
    if (!chaveEnc) {
      await AsyncStorage.setItem(chave, valor);
      return true;
    }
    const enc = encriptar(valor, chaveEnc);
    if (enc) {
      await AsyncStorage.setItem(chave, JSON.stringify({ __enc: 'AES-256-CBC', iv: enc.iv, dados: enc.dados }));
      return true;
    }
    await AsyncStorage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
}

/** Descriptografa um valor gravado com gravarSeguro. */
export async function lerSeguro(chave: string): Promise<string | null> {
  try {
    const bruto = await AsyncStorage.getItem(chave);
    if (!bruto) return null;
    // Verifica se está encriptado
    if (!estaEncriptado(bruto)) return bruto;
    const chaveEnc = await obterChave();
    if (!chaveEnc) return null;
    const obj = JSON.parse(bruto);
    const texto = descriptografar(obj, chaveEnc);
    return texto;
  } catch {
    return null;
  }
}

/** Encripta um objeto JSON antes de gravar. */
export async function gravarJSONSeguro(chave: string, obj: any): Promise<boolean> {
  try {
    const chaveEnc = await obterChave();
    if (!chaveEnc) {
      await AsyncStorage.setItem(chave, JSON.stringify(obj));
      return true;
    }
    const encriptado = encriptarJSON(obj, chaveEnc);
    if (encriptado) {
      await AsyncStorage.setItem(chave, encriptado);
      return true;
    }
    await AsyncStorage.setItem(chave, JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

/** Descriptografa um objeto JSON gravado com gravarJSONSeguro. */
export async function lerJSONSeguro(chave: string): Promise<any | null> {
  try {
    const bruto = await AsyncStorage.getItem(chave);
    if (!bruto) return null;
    if (!estaEncriptado(bruto)) {
      return JSON.parse(bruto);
    }
    const chaveEnc = await obterChave();
    if (!chaveEnc) return null;
    return descriptografarJSON(bruto, chaveEnc);
  } catch {
    return null;
  }
}
