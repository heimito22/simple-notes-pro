import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';

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
  dataUltimaConclusao?: string; // NOVO: Para controlar o reset automático
}

const TarefasContext = createContext<any>({});

export default function TarefasProvider({ children }: any) {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);

  // --- LÓGICA DE AUTO-RESET (O CORAÇÃO DA MUDANÇA) ---
  // Usa data LOCAL (não UTC) para o "dia" — evita erro no Brasil (UTC-3) após as 21h
  const formatarDataLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const verificarEResetarTarefas = (listaTarefas: Tarefa[]) => {
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
  };

  // --- PERSISTÊNCIA ---
  useEffect(() => {
    async function carregarDados() {
      try {
        const guardado = await AsyncStorage.getItem('@minhas_tarefas_v1');
        if (guardado) {
          const dadosParseados = JSON.parse(guardado);
          // Aplica o reset assim que carrega os dados do storage
          const tarefasResetadas = verificarEResetarTarefas(dadosParseados);
          setTarefas(tarefasResetadas);
        }
      } catch (e) { console.error(e); }
    }
    carregarDados();
  }, []);

  useEffect(() => {
    async function salvarDados() {
      try { 
        await AsyncStorage.setItem('@minhas_tarefas_v1', JSON.stringify(tarefas)); 
      } catch (e) { console.error(e); }
    }
    salvarDados();
  }, [tarefas]);

  // --- ALARME NATIVO (ANDROID) ---
  // --- FUNÇÃO PARA O RELÓGIO DO DISPOSITIVO (COM REPETIÇÃO) ---
  const configurarAlarmeNativo = async (titulo: string, horario: string, recorrencia: Recorrencia) => {
    if (Platform.OS === 'android') {
      const [horas, min] = horario.split(':').map(Number);
      
      // Mapeamento Android: 1 é Domingo, 2 é Segunda...
      const diasMapa: Record<string, number> = {
        'Domingo': 1, 'Segunda': 2, 'Terça': 3, 'Quarta': 4, 'Quinta': 5, 'Sexta': 6, 'Sábado': 7
      };

      let diasSelecionados: number[] = [];

      if (recorrencia === 'Diária') {
        diasSelecionados = [1, 2, 3, 4, 5, 6, 7];
      } else if (recorrencia !== 'Uma vez') {
        diasSelecionados = [diasMapa[recorrencia]];
      }

      try {
        // Objeto de extras base
        const extras: any = {
          'android.intent.extra.alarm.HOUR': horas,
          'android.intent.extra.alarm.MINUTES': min,
          'android.intent.extra.alarm.MESSAGE': titulo,
          'android.intent.extra.alarm.SKIP_UI': false,
        };

        // Se houver dias para repetir (Xiaomi/Samsung Fix)
        if (diasSelecionados.length > 0) {
          // Formato 1: Array comum
          extras['android.intent.extra.alarm.DAYS'] = diasSelecionados;
          
          // Formato 2: Explicitamente pedindo repetição (Exigido em algumas MIUI)
          extras['android.intent.extra.alarm.REPEATING'] = true;
        }

        await IntentLauncher.startActivityAsync('android.intent.action.SET_ALARM', {
          extra: extras,
        });
      } catch (e) {
        console.error("Erro ao abrir alarme:", e);
      }
    }
  };

  // --- NOTIFICAÇÕES ---
  const agendarNotificacao = async (titulo: string, horario: string, recorrencia: Recorrencia) => {
    try {
      const [horas, min] = horario.split(':').map(Number);
      const content = {
        title: "Lembrete: " + titulo,
        body: `Está na hora de: ${titulo}`,
        sound: true,
      };

      let trigger: Notifications.NotificationTriggerInput;

      if (recorrencia === 'Uma vez') {
        const data = new Date();
        data.setHours(horas, min, 0, 0);
        if (data <= new Date()) data.setDate(data.getDate() + 1);
        trigger = { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data };
      } else if (recorrencia === 'Diária') {
        trigger = { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: horas, minute: min };
      } else {
        const diasMapa: any = { 'Domingo': 1, 'Segunda': 2, 'Terça': 3, 'Quarta': 4, 'Quinta': 5, 'Sexta': 6, 'Sábado': 7 };
        trigger = { 
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY, 
            weekday: diasMapa[recorrencia], 
            hour: horas, 
            minute: min 
        };
      }

      return await Notifications.scheduleNotificationAsync({ content, trigger });
    } catch (error) { return undefined; }
  };

  // --- AÇÕES ---
  const adicionarTarefa = async (titulo: string, recorrencia: Recorrencia, horario: string) => {
    // Agora passamos a recorrencia aqui também!
    await configurarAlarmeNativo(titulo, horario, recorrencia);

    const notificacaoId = await agendarNotificacao(titulo, horario, recorrencia);
    
    const nova: Tarefa = { 
      id: Math.random().toString(36).substr(2, 9), 
      titulo, 
      recorrencia, 
      horario,
      concluida: false,
      notificacaoId
    };
    setTarefas(prev => [nova, ...prev]);
  };

  const excluirTarefa = async (id: string) => {
    const tarefaParaExcluir = tarefas.find(t => t.id === id);
    if (tarefaParaExcluir?.notificacaoId) {
      await Notifications.cancelScheduledNotificationAsync(tarefaParaExcluir.notificacaoId);
    }
    setTarefas(prev => prev.filter(t => t.id !== id));
  };

  const alternarTarefa = (id: string) => {
    setTarefas(prev => prev.map(t => {
      if (t.id === id) {
        const novoStatus = !t.concluida;
        return { 
          ...t, 
          concluida: novoStatus,
          // Se marcar como concluída, salva a data/hora de agora. Se desmarcar, remove.
          dataUltimaConclusao: novoStatus ? new Date().toISOString() : undefined 
        };
      }
      return t;
    }));
  };

  return (
    <TarefasContext.Provider value={{ tarefas, adicionarTarefa, alternarTarefa, excluirTarefa }}>
      {children}
    </TarefasContext.Provider>
  );
}

export const useTarefas = () => useContext(TarefasContext);