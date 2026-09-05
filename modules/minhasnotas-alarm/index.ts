import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface AlarmeDisparadoInfo {
  tarefaId: string;
  titulo: string;
  /** 'tarefa' (alarme de tarefa) ou 'lembrete' (revisão de nota). */
  tipo?: string;
}

let nativeModule: any = null;

if (Platform.OS === 'android') {
  try {
    nativeModule = requireNativeModule('MinhasNotasAlarm');
  } catch {
    // Módulo não linkado (Expo Go ou app sem prebuild) — código cai no fallback
    nativeModule = null;
  }
}

// ---------------------------------------------------------------------------
// GOOGLE PLAY BILLING (compra in-app "Remover anúncios")
// ---------------------------------------------------------------------------

let billingModule: any = null;

if (Platform.OS === 'android') {
  try {
    billingModule = requireNativeModule('SimpleNotesBilling');
  } catch {
    billingModule = null;
  }
}

export const billingNativoDisponivel = (): boolean => billingModule !== null;

/**
 * Abre a janela de pagamento da Play Store para o produto "remover_anuncios".
 * O resultado chega pelo evento onCompraAtualizada.
 */
export const comprarRemoverAnuncios = async (): Promise<{ ok: boolean; erro?: string }> => {
  if (!billingModule) return { ok: false, erro: 'Billing indisponível neste ambiente' };
  try {
    return await billingModule.comprarRemoverAnuncios();
  } catch {
    return { ok: false, erro: 'Não foi possível abrir o pagamento' };
  }
};

/** Restaura compras (chamada ao abrir o app / na tela de config). */
export const restaurarComprasRemoverAnuncios = async (): Promise<boolean> => {
  if (!billingModule) return false;
  try {
    return !!(await billingModule.restaurarCompras());
  } catch {
    return false;
  }
};

/** Preço real do produto lido do Play Console (ex.: "R$ 5,99"), ou null. */
export const obterPrecoRemoverAnuncios = async (): Promise<string | null> => {
  if (!billingModule) return null;
  try {
    const p = await billingModule.obterPrecoRemoverAnuncios();
    return typeof p === 'string' && p ? p : null;
  } catch {
    return null;
  }
};

/**
 * Escuta o evento de compra concluída/cancelada.
 * payload: { comprado: boolean; cancelado?: boolean; erro?: string }
 */
export const ouvirCompraAtualizada = (
  callback: (info: { comprado: boolean; cancelado?: boolean; erro?: string }) => void
): { remove: () => void } => {
  if (!billingModule) return { remove: () => {} };
  return billingModule.addListener('onCompraAtualizada', callback);
};

export const alarmeNativoDisponivel = (): boolean => nativeModule !== null;

/**
 * Agenda um alarme exato no Android (nativo). key = identificador único da agenda.
 * tipo = 'tarefa' (popup/overlay) ou 'lembrete' (notificação simples de nota).
 */
export const agendarAlarmeAndroid = async (
  key: string,
  tarefaId: string,
  titulo: string,
  timestampMs: number,
  recorrencia: string,
  horario: string,
  tipo: string = 'tarefa'
): Promise<void> => {
  if (nativeModule) {
    await nativeModule.scheduleAlarm(key, tarefaId, titulo, timestampMs, recorrencia, horario, tipo);
  }
};

/** Cancela um alarme nativo (key = id da tarefa ou de uma soneca). */
export const cancelarAlarmeAndroid = async (key: string): Promise<void> => {
  if (nativeModule) {
    await nativeModule.cancelAlarm(key);
  }
};

/** Retorna o alarme que abriu o app (limpa em seguida), ou null. */
export const buscarAlarmeInicial = async (): Promise<AlarmeDisparadoInfo | null> => {
  if (!nativeModule) return null;
  try {
    const info = await nativeModule.getLaunchAlarm();
    return info && info.tarefaId ? info : null;
  } catch {
    return null;
  }
};

/** Android 14+: verifica se o app pode usar tela cheia (fullScreenIntent). */
export const podeUsarTelaCheia = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return !!(await nativeModule.canUseFullScreenIntent());
  } catch {
    return false;
  }
};

/** Abre as configurações de "tela cheia" do Android 14+. */
export const abrirConfigTelaCheia = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openFullScreenIntentSettings();
    } catch {
      // ignora
    }
  }
};

/** Escuta o evento de alarme disparado com o app rodando. */
export const ouvirAlarmeDisparado = (
  callback: (info: AlarmeDisparadoInfo) => void
): { remove: () => void } => {
  if (!nativeModule) return { remove: () => {} };
  return nativeModule.addListener('onAlarmFired', callback);
};

// ---------------------------------------------------------------------------
// SOM DO ALARME (personalizado + volume máximo / stream de alarme)
// ---------------------------------------------------------------------------

/** Salva o som selecionado no nativo (usado na hora do disparo, app fechado). */
export const definirSomAlarme = (nome: string): void => {
  if (nativeModule) {
    try {
      nativeModule.definirSomAlarme(nome);
    } catch {
      // ignora
    }
  }
};

/** Toca o som em loop no stream de ALARME com volume MÁXIMO (overlay do app). */
export const tocarSomAlarme = (nome: string): void => {
  if (nativeModule) {
    try {
      nativeModule.tocarSom(nome);
    } catch {
      // ignora
    }
  }
};

/** Prévia única do som (seletor de sons) — sem forçar volume. */
export const previewSomAlarme = (nome: string): void => {
  if (nativeModule) {
    try {
      nativeModule.previewSom(nome);
    } catch {
      // ignora
    }
  }
};

/** Para o som e restaura o volume de alarme anterior. */
export const pararSomAlarme = (): void => {
  if (nativeModule) {
    try {
      nativeModule.pararSom();
    } catch {
      // ignora
    }
  }
};

export interface ResultadoSomPersonalizado {
  cancelado?: boolean;
  erro?: string;
  nome?: string;
}

/**
 * Abre o seletor de arquivos de áudio (SAF) e salva o arquivo escolhido como
 * som personalizado no armazenamento do app. Retorna { cancelado } ou { nome }.
 */
export const escolherSomPersonalizado = async (): Promise<ResultadoSomPersonalizado | null> => {
  if (!nativeModule) return null;
  try {
    return await nativeModule.escolherSomPersonalizado();
  } catch {
    return { cancelado: true };
  }
};

/** Remove o som personalizado (arquivo + preferências nativas). */
export const removerSomPersonalizado = (): void => {
  if (nativeModule) {
    try {
      nativeModule.removerSomPersonalizado();
    } catch {
      // ignora
    }
  }
};

// ---------------------------------------------------------------------------
// PERMISSÕES DO ALARME (tela de permissões — Xiaomi / Android)
// ---------------------------------------------------------------------------

/** Android 12+: alarmes exatos liberados (sem atraso no disparo). */
export const podeAgendarAlarmeExato = async (): Promise<boolean> => {
  if (!nativeModule) return true;
  try {
    return !!(await nativeModule.canScheduleExactAlarms());
  } catch {
    return true;
  }
};

/** Abre a tela de "Alarmes e lembretes" (alarme exato) do Android 12+. */
export const abrirConfigAlarmeExato = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openExactAlarmSettings();
    } catch {
      // ignora
    }
  }
};

/** App isento da otimização de bateria (alarme toca com o app fechado). */
export const estaIgnorandoOtimizacaoBateria = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return !!(await nativeModule.isIgnoringBatteryOptimizations());
  } catch {
    return false;
  }
};

/** Abre a tela de otimização de bateria do app. */
export const abrirConfigBateria = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openBatteryOptimizationSettings();
    } catch {
      // ignora
    }
  }
};

/**
 * Pode exibir popup sobre outros apps (Android "Exibir sobre outros apps" /
 * MIUI "Exibir pop-ups em segundo plano"). É o que libera o popup fora do app.
 */
export const podeExibirSobreposicao = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return !!(await nativeModule.canShowOverlays());
  } catch {
    return false;
  }
};

/** Abre a tela "Exibir sobre outros apps" do Android. */
export const abrirConfigSobreposicao = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openOverlaySettings();
    } catch {
      // ignora
    }
  }
};

/** Abre as configurações de notificações do app. */
export const abrirConfigNotificacoes = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openNotificationSettings();
    } catch {
      // ignora
    }
  }
};

/** Detecta Xiaomi / Redmi / POCO (MIUI ou HyperOS). */
export const ehDispositivoXiaomi = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return !!(await nativeModule.isXiaomi());
  } catch {
    return false;
  }
};

/** Abre a tela de "Iniciar automaticamente" (Autostart) do MIUI. */
export const abrirConfigAutostart = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openAutostartSettings();
    } catch {
      // ignora
    }
  }
};

/** Abre o editor de permissões do MIUI (pop-ups em segundo plano, etc.). */
export const abrirPermissoesMiui = (): void => {
  if (nativeModule) {
    try {
      nativeModule.openMiuiPermissionEditor();
    } catch {
      // ignora
    }
  }
};



// ---------------------------------------------------------------------------
// FECHAR APP NA TELA DE BLOQUEIO (após interagir com o alarme)
// ---------------------------------------------------------------------------

/** Verifica se o celular está com a tela de bloqueio ativa. */
export const isKeyguardLocked = async (): Promise<boolean> => {
  if (!nativeModule) return false;
  try {
    return !!(await nativeModule.isKeyguardLocked());
  } catch {
    return false;
  }
};

/** Fecha a Activity (volta para a tela de bloqueio do celular). */
export const finishActivity = (): void => {
  if (nativeModule) {
    try {
      nativeModule.finishActivity();
    } catch {
      // ignora
    }
  }
};
