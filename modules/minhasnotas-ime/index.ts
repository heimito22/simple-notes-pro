import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type EventoIme = { height: number };

interface ImeModuleApi {
  getImeHeight(): Promise<number>;
  addListener(event: 'onImeChange', listener: (evento: EventoIme) => void): { remove: () => void };
}

let nativo: ImeModuleApi | null = null;

if (Platform.OS === 'android') {
  try {
    nativo = requireNativeModule('MinhasNotasIme') as ImeModuleApi;
  } catch {
    // Expo Go ou build antigo sem o módulo — o JS cai nos eventos do RN
    nativo = null;
  }
}

/** true se a ponte nativa do inset do IME está disponível. */
export const imeNativoDisponivel = nativo !== null;

/**
 * Observa a altura REAL do teclado em dp (0 = fechado).
 * É o inset do SISTEMA (WindowInsets.Type.ime): inclui a faixa de sugestões
 * do Samsung, a barra extra do SwiftKey, teclado flutuante/partido — muda
 * junto com o teclado, sem depender dos eventos do React Native.
 * Retorna a função de cleanup.
 */
export function observarIme(callback: (alturaDp: number) => void): () => void {
  if (!nativo) return () => {};
  const sub = nativo.addListener('onImeChange', (e) => callback(e?.height ?? 0));
  return () => {
    try {
      sub.remove();
    } catch {}
  };
}

/** Altura atual do teclado em dp (consulta pontual). null = indisponível. */
export async function imeHeightAtual(): Promise<number | null> {
  if (!nativo) return null;
  try {
    const h = await nativo.getImeHeight();
    return typeof h === 'number' && h >= 0 ? h : null;
  } catch {
    return null;
  }
}
