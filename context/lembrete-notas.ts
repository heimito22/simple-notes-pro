import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { agendarAlarmeAndroid, alarmeNativoDisponivel, cancelarAlarmeAndroid } from '../modules/minhasnotas-alarm';

export type TipoLembrete = 'data' | 'dias' | 'semana';

/** Configuração de lembrete de revisão de uma nota. */
export interface LembreteNota {
  tipo: TipoLembrete;
  /** 'data': dia alvo (yyyy-mm-dd). */
  data?: string;
  /** 'dias': intervalo em dias. */
  intervaloDias?: number;
  /** 'semana': dias da semana selecionados. */
  diasSemana?: string[];
  /** Horário do lembrete (HH:MM). */
  horario: string;
}

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Chaves nativas determinísticas por nota (0 = data única/intervalo; 1..7 = dias da semana)
const chaveLembrete = (notaId: string, i: number) => `lembrete:${notaId}:${i}`;

/** Próxima ocorrência do horário (hoje se ainda não passou, senão amanhã). */
export const proximoHorario = (horario: string): Date => {
  const [h, m] = horario.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
};

/** Próxima ocorrência de um dia da semana no horário. */
export const proximaOcorrenciaDia = (dia: string, horario: string): Date => {
  const [h, m] = horario.split(':').map(Number);
  const alvo = new Date();
  alvo.setHours(h || 0, m || 0, 0, 0);
  const diff = (DIAS_SEMANA.indexOf(dia) - alvo.getDay() + 7) % 7;
  alvo.setDate(alvo.getDate() + diff);
  if (alvo.getTime() <= Date.now()) alvo.setDate(alvo.getDate() + 7);
  return alvo;
};

/**
 * Agenda os lembretes de uma nota.
 * - Android (módulo nativo): AlarmManager com rearm automático (funciona app fechado).
 * - iOS/Expo Go: expo-notifications.
 * Cancela antes os lembretes anteriores (nativos por chave + fallback pelos expoIds).
 * Retorna os IDs do expo-notifications (vazio no Android nativo).
 */
export const agendarLembretes = async (
  notaId: string,
  titulo: string,
  lembrete: LembreteNota,
  expoIdsAnteriores: string[] = []
): Promise<string[]> => {
  const nativo = Platform.OS === 'android' && alarmeNativoDisponivel();

  // Cancela o que existia antes (no nativo: chaves 0..7; no fallback: os expoIds
  // antigos) para não acumular notificações duplicadas ao re-agendar.
  await cancelarLembretes(notaId, expoIdsAnteriores);

  if (nativo) {
    const promessas: Promise<void>[] = [];

    if (lembrete.tipo === 'data' && lembrete.data) {
      const [y, m, d] = lembrete.data.split('-').map(Number);
      const [hh, mm] = lembrete.horario.split(':').map(Number);
      const alvo = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
      if (alvo.getTime() > Date.now()) {
        promessas.push(
          agendarAlarmeAndroid(chaveLembrete(notaId, 0), notaId, titulo, alvo.getTime(), 'Uma vez', lembrete.horario, 'lembrete')
        );
      }
    } else if (lembrete.tipo === 'dias') {
      const n = Math.min(90, Math.max(1, lembrete.intervaloDias ?? 1));
      promessas.push(
        agendarAlarmeAndroid(
          chaveLembrete(notaId, 0),
          notaId,
          titulo,
          proximoHorario(lembrete.horario).getTime(),
          `A cada ${n} dias`,
          lembrete.horario,
          'lembrete'
        )
      );
    } else if (lembrete.tipo === 'semana' && lembrete.diasSemana?.length) {
      lembrete.diasSemana.forEach((dia, i) => {
        promessas.push(
          agendarAlarmeAndroid(
            chaveLembrete(notaId, i + 1),
            notaId,
            titulo,
            proximaOcorrenciaDia(dia, lembrete.horario).getTime(),
            dia,
            lembrete.horario,
            'lembrete'
          )
        );
      });
    }

    await Promise.all(promessas);
    return [];
  }

  // Fallback (iOS / Expo Go)
  const ids: string[] = [];
  const content = (): Notifications.NotificationContentInput => ({
    title: titulo,
    body: 'Está na hora de revisar esta nota',
    sound: true,
    data: { tarefaId: notaId, tipo: 'lembrete' },
    ...(Platform.OS === 'android' ? { channelId: 'tarefas' } : {}),
  });

  if (lembrete.tipo === 'data' && lembrete.data) {
    const [y, m, d] = lembrete.data.split('-').map(Number);
    const [hh, mm] = lembrete.horario.split(':').map(Number);
    const alvo = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
    if (alvo.getTime() > Date.now()) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: content(),
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alvo },
        })
      );
    }
  } else if (lembrete.tipo === 'dias') {
    const n = Math.min(90, Math.max(1, lembrete.intervaloDias ?? 1));
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: content(),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: n * 86400,
          repeats: true,
        },
      })
    );
  } else if (lembrete.tipo === 'semana' && lembrete.diasSemana?.length) {
    const mapa: Record<string, number> = {
      Domingo: 1, Segunda: 2, Terça: 3, Quarta: 4, Quinta: 5, Sexta: 6, Sábado: 7,
    };
    const [hh, mm] = lembrete.horario.split(':').map(Number);
    for (const dia of lembrete.diasSemana) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: content(),
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: mapa[dia],
            hour: hh,
            minute: mm,
          },
        })
      );
    }
  }
  return ids;
};

/**
 * Soneca do lembrete: re-dispara o alarme daqui a X minutos.
 * (Android: alarme pontual nativo; iOS/Expo Go: notificação DATE.)
 */
// Chave FIXA por nota: só existe uma soneca ativa por lembrete e a próxima
// substitui a anterior (AlarmScheduler sobrescreve pelo key) — assim a soneca
// também pode ser cancelada junto com o lembrete.
const chaveSonecaLembrete = (notaId: string) => `soneca:lembrete:${notaId}:0`;

export const sonecaLembrete = async (notaId: string, titulo: string, minutos = 10): Promise<void> => {
  const data = new Date(Date.now() + minutos * 60 * 1000);
  if (Platform.OS === 'android' && alarmeNativoDisponivel()) {
    // Alarme pontual (não re-arma) — a recorrência do lembrete segue intacta
    await agendarAlarmeAndroid(chaveSonecaLembrete(notaId), notaId, titulo, data.getTime(), 'Uma vez', '00:00', 'lembrete');
  } else {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: titulo,
        body: 'Está na hora de revisar esta nota',
        sound: true,
        data: { tarefaId: notaId, tipo: 'lembrete' },
        ...(Platform.OS === 'android' ? { channelId: 'tarefas' } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data },
    }).catch(() => {});
  }
};

/** Cancela todos os lembretes de uma nota (nativo por chaves + fallback por ids). */
export const cancelarLembretes = async (notaId: string, expoIds: string[] = []): Promise<void> => {
  if (Platform.OS === 'android' && alarmeNativoDisponivel()) {
    for (let i = 0; i < 8; i++) {
      await cancelarAlarmeAndroid(chaveLembrete(notaId, i));
    }
    // Soneca pendente do lembrete também é cancelada ao remover
    await cancelarAlarmeAndroid(chaveSonecaLembrete(notaId)).catch(() => {});
  }
  for (const id of expoIds) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
};

/** Texto amigável do lembrete (exibido na nota). */
export const resumoLembrete = (l: LembreteNota): string => {
  if (l.tipo === 'data' && l.data) {
    const [y, m, d] = l.data.split('-').map(Number);
    const data = new Date(y, (m || 1) - 1, d || 1);
    return `Lembrete em ${data.toLocaleDateString('pt-BR')} às ${l.horario}`;
  }
  if (l.tipo === 'dias') {
    return `Revisar a cada ${l.intervaloDias} dias às ${l.horario}`;
  }
  const dias = (l.diasSemana ?? []).join(', ');
  return dias ? `Revisar às ${dias}, às ${l.horario}` : `Revisar às ${l.horario}`;
};
