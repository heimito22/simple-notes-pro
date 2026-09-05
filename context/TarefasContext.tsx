import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useTheme } from './ThemeContext';
import {
  agendarAlarmeAndroid,
  alarmeNativoDisponivel,
  cancelarAlarmeAndroid,
  definirSomAlarme,
} from '../modules/minhasnotas-alarm';
import { verificarTelaCheia } from './permissao-alarme';
import { SOM_PADRAO } from './sons-alarme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type Recorrencia = 'Diária' | 'Segunda' | 'Terça' | 'Quarta' | 'Quinta' | 'Sexta' | 'Sábado' | 'Domingo' | 'Uma vez';

export interface Tarefa {
  id: string;
  titulo: string;
  recorrencia: Recorrencia;
  horario: string;
  concluida: boolean;
  notificacaoId?: string;
  dataUltimaConclusao?: string;
}

// Categoria de notificação com os botões de ação do "alarme" do app
export const CATEGORIA_TAREFA = 'tarefa_alarme';
export const ACAO_VOU_FAZER = 'vou_fazer';
export const ACAO_DEIXAR_DEPOIS = 'deixar_depois';
export const ACAO_SONECA_10 = 'soneca_10';

const CHANNEL_TAREFAS = 'tarefas';

// Próximo timestamp de disparo (ms) para agendar o alarme nativo do Android
const proximoDisparo = (recorrencia: Recorrencia, horario: string): number => {
  const [h, m] = horario.split(':').map(Number);
  const agora = new Date();
  const alvo = new Date();
  alvo.setHours(h || 0, m || 0, 0, 0);

  if (recorrencia === 'Diária' || recorrencia === 'Uma vez') {
    if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 1);
  } else {
    const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    // 0 = hoje (se o horário ainda não passou, dispara hoje; senão, próxima semana)
    const diff = (dias.indexOf(recorrencia) - agora.getDay() + 7) % 7;
    alvo.setDate(alvo.getDate() + diff);
    if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 7);
  }
  return alvo.getTime();
};

const TarefasContext = createContext<any>({});

export default function TarefasProvider({ children }: any) {
  const { config, t } = useTheme();
  const tempoSoneca = config?.tempoSoneca ?? 10;
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  // Só passa a salvar depois que os dados foram carregados (evita apagar tudo no 1º launch)
  const [carregado, setCarregado] = useState(false);

  // Ref espelhado do estado para uso em handlers assíncronos (listeners) sem closure obsoleta
  const tarefasRef = useRef<Tarefa[]>([]);
  // Notificações extras (sonecas) — canceladas junto com a tarefa
  const extrasRef = useRef<{ tarefaId: string; id: string }[]>([]);

  useEffect(() => {
    tarefasRef.current = tarefas;
  }, [tarefas]);

  // --- SETUP: canal Android (importância máxima = som/vibração/heads-up) ---
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync(CHANNEL_TAREFAS, {
      name: 'Tarefas',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 300, 400, 900],
      sound: 'default',
    }).catch(e => console.error("[Notificações] Erro no canal:", e));
  }, []);

  // Mantém o som selecionado sincronizado com o nativo (usado na hora do disparo)
  useEffect(() => {
    if (Platform.OS !== 'android' || !alarmeNativoDisponivel()) return;
    definirSomAlarme(config?.somAlarme ?? SOM_PADRAO);
  }, [config?.somAlarme]);

  // Categoria com os botões de ação — o título da soneca usa o tempo configurado
  // (não existe na web: setNotificationCategoryAsync não é implementado)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.setNotificationCategoryAsync(CATEGORIA_TAREFA, [
      { identifier: ACAO_VOU_FAZER, buttonTitle: t('Vou fazer'), options: { opensAppToForeground: true } },
      { identifier: ACAO_SONECA_10, buttonTitle: t('Daqui a {n} min', { n: tempoSoneca }), options: { opensAppToForeground: true } },
      { identifier: ACAO_DEIXAR_DEPOIS, buttonTitle: t('Deixar para depois'), options: { opensAppToForeground: true } },
    ]).catch(e => console.error("[Notificações] Erro na categoria:", e));
  }, [tempoSoneca, t]);

  // --- LÓGICA DE AUTO-RESET ---
  // Usa data LOCAL (não UTC) para o "dia" — evita erro no Brasil (UTC-3) após as 21h
  const formatarDataLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const verificarEResetarTarefas = useCallback((listaTarefas: Tarefa[]) => {
    const hoje = new Date();
    const diaSemanaAtual = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][hoje.getDay()];

    // String comparável (YYYY-MM-DD) em horário local para saber se mudou o dia
    const hojeString = formatarDataLocal(hoje);

    return listaTarefas.map(t => {
      // Se não está concluída ou é "Uma vez", não precisa de reset
      if (!t.concluida || t.recorrencia === 'Uma vez' || !t.dataUltimaConclusao) return t;

      // dataUltimaConclusao é guardada em ISO (UTC) — converte para a data local correspondente
      const dataConclusao = formatarDataLocal(new Date(t.dataUltimaConclusao));
      const diaMudou = dataConclusao !== hojeString;

      // 1. Reset Diário: Se mudou o dia, reseta.
      if (t.recorrencia === 'Diária' && diaMudou) {
        return { ...t, concluida: false, dataUltimaConclusao: undefined };
      }

      // 2. Reset por Dia da Semana: Se hoje é o dia da tarefa e o dia mudou (não é a mesma conclusão de hoje)
      if (t.recorrencia === diaSemanaAtual && diaMudou) {
        return { ...t, concluida: false, dataUltimaConclusao: undefined };
      }

      return t;
    });
  }, []);

  // --- RESET AUTOMÁTICO MESMO COM O APP ABERTO ---
  // Agenda um timer para a meia-noite (e re-agenda a cada disparo); ao voltar do
  // background também revalida, cobrindo atrasos de timer enquanto o app esteve suspenso.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function armar() {
      if (timer) clearTimeout(timer);
      const agora = new Date();
      const proximaMeiaNoite = new Date(agora);
      proximaMeiaNoite.setHours(24, 0, 5, 0); // 5s depois da meia-noite
      timer = setTimeout(() => {
        setTarefas(prev => verificarEResetarTarefas(prev));
        armar();
      }, proximaMeiaNoite.getTime() - agora.getTime());
    }

    armar();
    const sub = AppState.addEventListener('change', estado => {
      if (estado === 'active') {
        setTarefas(prev => verificarEResetarTarefas(prev));
        armar();
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [verificarEResetarTarefas]);

  // --- PERSISTÊNCIA ---
  useEffect(() => {
    async function carregarDados() {
      try {
        const guardado = await AsyncStorage.getItem('@minhas_tarefas_v1');
        if (guardado) {
          const dadosParseados = JSON.parse(guardado);
          // Aplica o reset assim que carrega os dados do storage
          setTarefas(verificarEResetarTarefas(dadosParseados));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setCarregado(true);
      }
    }
    carregarDados();
  }, [verificarEResetarTarefas]);

  useEffect(() => {
    if (!carregado) return;
    AsyncStorage.setItem('@minhas_tarefas_v1', JSON.stringify(tarefas)).catch(e => console.error(e));
  }, [tarefas, carregado]);

  // Migração/re-sync do alarme nativo (Android): garante que tarefas existentes
  // (criadas antes do módulo nativo) também tenham alarme agendado. É idempotente.
  useEffect(() => {
    if (!carregado) return;
    if (Platform.OS !== 'android' || !alarmeNativoDisponivel()) return;
    const sincronizar = async () => {
      for (const t of tarefasRef.current) {
        if (!t.horario) continue;
        if (t.recorrencia === 'Uma vez' && t.concluida) continue;
        await agendarAlarmeAndroid(t.id, t.id, t.titulo, proximoDisparo(t.recorrencia, t.horario), t.recorrencia, t.horario);
      }
    };
    sincronizar().catch(() => {});
  }, [carregado]);

  // --- NOTIFICAÇÕES (ALARME PRÓPRIO DO APP) ---

  // Monta o gatilho de recorrência a partir do horário/dia escolhidos
  const montarTrigger = useCallback((horario: string, recorrencia: Recorrencia): Notifications.NotificationTriggerInput => {
    const [horas, min] = horario.split(':').map(Number);

    if (recorrencia === 'Uma vez') {
      const data = new Date();
      data.setHours(horas, min, 0, 0);
      if (data <= new Date()) data.setDate(data.getDate() + 1);
      return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data };
    }

    if (recorrencia === 'Diária') {
      return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: horas, minute: min };
    }

    // Mapeamento: 1 = Domingo ... 7 = Sábado (padrão do expo-notifications)
    const diasMapa: Record<string, number> = {
      'Domingo': 1, 'Segunda': 2, 'Terça': 3, 'Quarta': 4, 'Quinta': 5, 'Sexta': 6, 'Sábado': 7,
    };
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: diasMapa[recorrencia],
      hour: horas,
      minute: min,
    };
  }, []);

  const agendarNotificacaoExpo = useCallback(async (
    titulo: string,
    horario: string,
    recorrencia: Recorrencia,
    tarefaId: string,
    trigger?: Notifications.NotificationTriggerInput
  ): Promise<string | undefined> => {
    try {
      const content: Notifications.NotificationContentInput = {
        title: t('Lembrete: {titulo}', { titulo }),
        body: t('Está na hora de: {titulo}', { titulo }),
        sound: true,
        data: { tarefaId },
        categoryIdentifier: CATEGORIA_TAREFA,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_TAREFAS } : {}),
      };
      return await Notifications.scheduleNotificationAsync({
        content,
        trigger: trigger ?? montarTrigger(horario, recorrencia),
      });
    } catch {
      return undefined;
    }
  }, [montarTrigger, t]);

  // --- AÇÕES ---
  // Verificação das permissões do alarme (popup/tela cheia/Xiaomi) compartilhada
  // com os lembretes de notas — abre /permissoes na 1ª vez se algo estiver
  // bloqueando; depois vira um lembrete leve (1x por sessão).

  const adicionarTarefa = useCallback(async (titulo: string, recorrencia: Recorrencia, horario: string) => {
    // Garante a permissão de notificação (obrigatória no Android 13+ e iOS)
    try {
      const permissao = await Notifications.getPermissionsAsync();
      if (!permissao.granted) {
        const pedido = await Notifications.requestPermissionsAsync();
        if (!pedido.granted) {
          Alert.alert(
            "Notificações desativadas",
            "Permita as notificações nas configurações do aparelho para receber os lembretes das tarefas."
          );
        }
      }
    } catch (e) {
      console.warn("[Notificações] Falha ao pedir permissão:", e);
    }

    const id = Math.random().toString(36).substr(2, 9);
    let notificacaoId: string | undefined;

    if (Platform.OS === 'android' && alarmeNativoDisponivel()) {
      // Alarme nativo (AlarmManager + fullScreenIntent): abre o app sozinho em tela cheia
      await agendarAlarmeAndroid(id, id, titulo, proximoDisparo(recorrencia, horario), recorrencia, horario);
      verificarTelaCheia();
    } else {
      // Fallback (Expo Go / iOS): notificação do expo-notifications
      notificacaoId = await agendarNotificacaoExpo(titulo, horario, recorrencia, id);
    }

    const nova: Tarefa = {
      id,
      titulo,
      recorrencia,
      horario,
      concluida: false,
      notificacaoId,
    };
    setTarefas(prev => [nova, ...prev]);
  }, [agendarNotificacaoExpo]);

  // Cancela todas as notificações/alarmes de uma tarefa (principal + sonecas)
  const cancelarNotificacoesTarefa = useCallback(async (tarefaId: string) => {
    const tarefa = tarefasRef.current.find(t => t.id === tarefaId);
    const extras = extrasRef.current.filter(e => e.tarefaId === tarefaId);
    extrasRef.current = extrasRef.current.filter(e => e.tarefaId !== tarefaId);

    if (Platform.OS === 'android' && alarmeNativoDisponivel()) {
      await cancelarAlarmeAndroid(tarefaId);
      await Promise.all(extras.map(e => cancelarAlarmeAndroid(e.id)));
    } else {
      const promessas: Promise<void>[] = [];
      if (tarefa?.notificacaoId) {
        promessas.push(Notifications.cancelScheduledNotificationAsync(tarefa.notificacaoId).catch(() => {}));
      }
      extras.forEach(e => promessas.push(Notifications.cancelScheduledNotificationAsync(e.id).catch(() => {})));
      await Promise.all(promessas);
    }
  }, []);

  const excluirTarefa = useCallback(async (id: string) => {
    await cancelarNotificacoesTarefa(id);
    setTarefas(prev => prev.filter(t => t.id !== id));
  }, [cancelarNotificacoesTarefa]);

  const alternarTarefa = useCallback((id: string) => {
    const alvo = tarefasRef.current.find(t => t.id === id);
    const marcandoConcluida = !!alvo && !alvo.concluida;

    if (marcandoConcluida && alvo!.recorrencia === 'Uma vez') {
      // Tarefas "Uma vez" concluídas não devem mais disparar alarme (nem sonecas)
      cancelarNotificacoesTarefa(id).catch(() => {});
    }

    setTarefas(prev => prev.map(t => {
      if (t.id === id) {
        const novoStatus = !t.concluida;
        return {
          ...t,
          concluida: novoStatus,
          // Se marcar como concluída, salva a data/hora de agora. Se desmarcar, remove.
          dataUltimaConclusao: novoStatus ? new Date().toISOString() : undefined,
        };
      }
      return t;
    }));
  }, [cancelarNotificacoesTarefa]);

  // Soneca: agenda um novo alarme pontual daqui a X minutos.
  // A recorrência (diária/semanal) NÃO é cancelada — a cadência continua intacta.
  const sonecaAlarme = useCallback(async (tarefaId: string, minutos = 10) => {
    const tarefa = tarefasRef.current.find(t => t.id === tarefaId);
    if (!tarefa) return;
    try {
      const data = new Date(Date.now() + minutos * 60 * 1000);
      if (Platform.OS === 'android' && alarmeNativoDisponivel()) {
        // Alarme pontual nativo (não re-arma) — a recorrência da tarefa segue intacta
        const chave = `soneca:${tarefaId}:${Date.now()}`;
        await agendarAlarmeAndroid(chave, tarefaId, tarefa.titulo, data.getTime(), 'Uma vez', tarefa.horario);
        extrasRef.current.push({ tarefaId, id: chave });
      } else {
        const novoId = await agendarNotificacaoExpo(tarefa.titulo, tarefa.horario, tarefa.recorrencia, tarefaId, {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: data,
        });
        if (novoId) extrasRef.current.push({ tarefaId, id: novoId });
      }
    } catch (e) {
      console.error("[Notificações] Erro na soneca:", e);
    }
  }, [agendarNotificacaoExpo]);

  return (
    <TarefasContext.Provider value={{ tarefas, adicionarTarefa, alternarTarefa, excluirTarefa, sonecaAlarme }}>
      {children}
    </TarefasContext.Provider>
  );
}

export const useTarefas = () => useContext(TarefasContext);
