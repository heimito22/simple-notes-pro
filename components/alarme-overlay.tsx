/* eslint-disable react-hooks/immutability -- o AudioPlayer do expo-audio é um recurso
   nativo externo cuja API exige mutação (player.loop, play/pause). Não é estado React. */
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Modal, Platform, StyleSheet, Text, TouchableOpacity, View, Vibration } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alarmeEstado } from '../context/alarme-estado';
import { assetDoSom, SOM_PADRAO } from '../context/sons-alarme';
import { ACAO_DEIXAR_DEPOIS, ACAO_SONECA_10, ACAO_VOU_FAZER, useTarefas } from '../context/TarefasContext';
import { useTheme } from '../context/ThemeContext';
import { alarmeNativoDisponivel, buscarAlarmeInicial, ouvirAlarmeDisparado, pararSomAlarme, tocarSomAlarme , isKeyguardLocked, finishActivity } from '../modules/minhasnotas-alarm';
import { sonecaLembrete } from '../context/lembrete-notas';

interface AlarmeInfo {
  id: string;
  titulo: string;
  /** 'tarefa' (padrão) ou 'lembrete' (revisão de nota). */
  tipo?: string;
}

/**
 * "Alarme" próprio do app: sobreposição em tela cheia com SOM EM LOOP + VIBRAÇÃO
 * e animações (anéis pulsantes, brilho, entrada em cascata).
 *
 * No Android (build com o módulo nativo): o AlarmManager dispara uma notificação
 * fullScreenIntent que abre o app sozinho em tela cheia — mesmo fechado/bloqueado.
 * O overlay também reage ao evento onAlarmFired e ao alarme que abriu o app.
 *
 * No iOS / Expo Go (sem o módulo nativo): o expo-notifications mostra a notificação
 * com os 3 botões de ação; ao tocar, o app abre e este alarme é exibido.
 *
 * Biometria: enquanto o alarme está ativo (alarmeEstado.ativo), a tela de bloqueio
 * não pede biometria — o alarme é visível; as anotações só abrem após desbloquear.
 */
export default function AlarmeOverlay() {
  const router = useRouter();
  const { alternarTarefa, sonecaAlarme } = useTarefas();
  const { isDark, config, t } = useTheme();
  const insets = useSafeAreaInsets();
  const nomeSom = config?.somAlarme ?? SOM_PADRAO;
  const tempoSoneca = config?.tempoSoneca ?? 10;
  const [alarme, setAlarme] = useState<AlarmeInfo | null>(null);
  const [agora, setAgora] = useState(new Date());

  // Cores do overlay seguem o tema do app (escuro OLED ou claro)
  const tema = {
    fundo: isDark ? '#05050B' : '#F2F2F7',
    hora: isDark ? '#FFFFFF' : '#1C1C1E',
    horaBrilho: isDark ? '#FFD60A66' : '#FF9F0A55',
    rotulo: '#FF453A',
    anel: isDark ? '#FFD60A55' : '#FF9F0A55',
    iconeFundo: isDark ? '#16161D' : '#FFFFFF',
    iconeBorda: isDark ? '#2A2A33' : '#E2E2E7',
    iconeSombra: isDark ? '#FFD60A' : '#FF9F0A',
    iconeCor: '#FFD60A',
    titulo: isDark ? '#FFFFFF' : '#1C1C1E',
    sub: isDark ? '#8E8E93' : '#6E6E73',
    botaoNeutroFundo: isDark ? '#3A3A3C' : '#E5E5EA',
    botaoNeutroTexto: isDark ? '#FFFFFF' : '#1C1C1E',
    botaoTexto: '#FFFFFF',
  };

  // Som do alarme (loop) — só toca enquanto o alarme está na frente.
  // Android (módulo nativo): toca no stream de ALARME com volume MÁXIMO
  // (player do expo-audio nem é criado — source null).
  // iOS/Expo Go: player do expo-audio (o useAudioPlayer recria ao trocar o som).
  const player = useAudioPlayer(alarmeNativoDisponivel() ? null : assetDoSom(nomeSom));
  const alarmeRef = useRef<AlarmeInfo | null>(null);

  const tocarSom = useCallback(() => {
    if (alarmeNativoDisponivel()) {
      tocarSomAlarme(nomeSom);
      return;
    }
    player.loop = true;
    player.volume = 1.0;
    player.play();
  }, [player, nomeSom]);

  const pararSom = useCallback(() => {
    if (alarmeNativoDisponivel()) {
      pararSomAlarme();
      return;
    }
    player.pause();
  }, [player]);

  const fechar = useCallback(() => {
    alarmeEstado.setAtivo(false);
    setAlarme(null);
    alarmeRef.current = null;
    Vibration.cancel();
    pararSom();
    // Se o app foi aberto pela tela de bloqueio (alarme), fecha a activity
    // para voltar para a tela de bloqueio do celular — sem deixar o app aberto por trás.
    isKeyguardLocked().then(locked => {
      if (locked) finishActivity();
    }).catch(() => {});
  }, [pararSom]);

  const ativar = useCallback((info: AlarmeInfo) => {
    setAlarme(prev => (prev && prev.id === info.id ? prev : info));
    alarmeRef.current = info;
    alarmeEstado.setAtivo(true);
    // Remove a notificação do sistema (com som insistente) para não tocar 2x
    Notifications.dismissAllNotificationsAsync().catch(() => {});
    Vibration.vibrate([400, 300, 400, 300, 1000], true);
    tocarSom();
  }, [tocarSom]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  // Relógio ao vivo enquanto o alarme está ativo
  useEffect(() => {
    if (!alarme) return;
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, [alarme]);

  // O botão "voltar" não dispensa o alarme por engano
  useEffect(() => {
    if (!alarme) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [alarme]);

  // Listeners do alarme: nativo (Android) ou expo-notifications (iOS/Expo Go)
  useEffect(() => {
    if (Platform.OS === 'web') return;

    // ANDROID: alarme nativo (AlarmManager + fullScreenIntent)
    if (alarmeNativoDisponivel()) {
      const verificarInicial = async () => {
        const info = await buscarAlarmeInicial();
        if (info) ativar({ id: info.tarefaId, titulo: info.titulo, tipo: info.tipo });
      };
      const subEvento = ouvirAlarmeDisparado(info => ativar({ id: info.tarefaId, titulo: info.titulo, tipo: info.tipo }));
      verificarInicial();
      const subApp = AppState.addEventListener('change', estado => {
        if (estado === 'active') verificarInicial();
      });
      return () => {
        subEvento.remove();
        subApp.remove();
      };
    }

    // iOS / Expo Go: notificação recebida (app aberto) + resposta aos botões da notificação
    const subRecebida = Notifications.addNotificationReceivedListener(notif => {
      const data = notif.request.content.data as any;
      if (data?.tarefaId) {
        ativar({
          id: data.tarefaId,
          titulo: String(notif.request.content.title ?? 'Tarefa').replace(/^Lembrete:\s*/, ''),
          tipo: data.tipo,
        });
      }
    });

    const subResposta = Notifications.addNotificationResponseReceivedListener(resposta => {
      const data = resposta.notification.request.content.data as any;
      const id = data?.tarefaId;
      if (!id) return;
      const acao = resposta.actionIdentifier;
      const ehLembrete = data?.tipo === 'lembrete';

      if (acao === ACAO_VOU_FAZER) {
        if (!ehLembrete) alternarTarefa(id); // lembrete: só dispensa
        fechar();
      } else if (acao === ACAO_SONECA_10) {
        if (ehLembrete) {
          sonecaLembrete(id, String(resposta.notification.request.content.title ?? 'Nota'), tempoSoneca);
        } else {
          sonecaAlarme(id, tempoSoneca);
        }
        fechar();
      } else if (acao === ACAO_DEIXAR_DEPOIS) {
        // Próxima ocorrência já está agendada pela recorrência (diária/semanal)
        fechar();
      } else {
        // Toque direto na notificação: abre o alarme dentro do app
        ativar({
          id,
          titulo: String(resposta.notification.request.content.title ?? 'Tarefa').replace(/^Lembrete:\s*/, ''),
          tipo: data.tipo,
        });
      }
    });

    return () => {
      subRecebida.remove();
      subResposta.remove();
    };
  }, [ativar, fechar, alternarTarefa, sonecaAlarme, tempoSoneca]);

  // Som/vibração: param ao minimizar o app e voltam ao retornar (se o alarme segue ativo)
  useEffect(() => {
    const sub = AppState.addEventListener('change', estado => {
      if (estado !== 'active') {
        Vibration.cancel();
        pararSom();
      } else if (alarmeRef.current) {
        Vibration.vibrate([400, 300, 400, 300, 1000], true);
        tocarSom();
      }
    });
    return () => {
      Vibration.cancel();
      pararSom();
      alarmeEstado.setAtivo(false);
      sub.remove();
    };
  }, [pararSom, tocarSom]);

  if (!alarme) return null;

  const ehLembrete = alarme.tipo === 'lembrete';
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Modal nativo: garante que o alarme apareça ACIMA das telas apresentadas
  // como modal nativo (editores de nota/lista) e de qualquer rota do app.
  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={() => {}}>
      <View
        style={[
          styles.overlay,
          { backgroundColor: tema.fundo, paddingBottom: 96 + insets.bottom, paddingTop: 96 + insets.top },
        ]}
      >
        {/* Anéis pulsantes (efeito radar) ao redor do ícone */}
        <View style={styles.ringsArea} pointerEvents="none">
          <MotiView
            from={{ scale: 0.7, opacity: 0.8 }}
            animate={{ scale: 2.7, opacity: 0 }}
            transition={{ type: 'timing', duration: 2000, loop: true, repeatReverse: false }}
            style={[styles.ring, { borderColor: tema.anel }]}
          />
          <MotiView
            from={{ scale: 0.7, opacity: 0.6 }}
            animate={{ scale: 2.7, opacity: 0 }}
            transition={{ type: 'timing', duration: 2000, loop: true, repeatReverse: false, delay: 1000 }}
            style={[styles.ring, { borderColor: tema.anel }]}
          />
        </View>

        {/* Relógio */}
        <MotiView
          from={{ opacity: 0, translateY: -34, scale: 0.9 }}
          animate={{ opacity: 1, translateY: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 16, stiffness: 110 }}
          style={styles.horaArea}
        >
          <Text style={[styles.horaTexto, { color: tema.hora, textShadowColor: tema.horaBrilho }]}>{hora}</Text>
          <MotiView
            from={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 700, loop: true, repeatReverse: true }}
          >
            <Text style={[styles.alarmeLabel, { color: tema.rotulo }]}>● ALARME ●</Text>
          </MotiView>
        </MotiView>

        {/* Card da tarefa */}
        <MotiView
          from={{ opacity: 0, scale: 0.88, translateY: 26 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 13, stiffness: 100, delay: 160 }}
          style={styles.card}
        >
          <MotiView
            from={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: [1, 1.07, 1], opacity: 1 }}
            transition={{ type: 'spring', damping: 10, stiffness: 120, delay: 260 }}
            style={[
              styles.iconCircle,
              { backgroundColor: tema.iconeFundo, borderColor: tema.iconeBorda, shadowColor: tema.iconeSombra },
            ]}
          >
            <Ionicons name="alarm" size={46} color={tema.iconeCor} />
          </MotiView>
          <Text style={[styles.cardTitulo, { color: tema.titulo }]} numberOfLines={3}>{alarme.titulo}</Text>
          <Text style={[styles.cardSub, { color: tema.sub }]}>{ehLembrete ? t('Está na hora de revisar esta nota!') : t('Está na hora de fazer isso!')}</Text>
        </MotiView>

        {/* Botões em cascata */}
        <View style={styles.botoesArea}>
          <MotiView
            from={{ opacity: 0, translateY: 34 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 120, delay: 280 }}
          >
            <TouchableOpacity
              style={[styles.botao, { backgroundColor: '#34C759' }]}
              activeOpacity={0.85}
              onPress={() => {
                if (ehLembrete) {
                  // Lembrete de revisão de nota: vai DIRETO para a nota do lembrete
                  fechar();
                  router.push({ pathname: '/editor', params: { id: alarme.id } });
                } else {
                  alternarTarefa(alarme.id);
                  fechar();
                }
              }}
            >
              <Ionicons name="checkmark-circle" size={26} color={tema.botaoTexto} />
              <Text style={[styles.botaoTexto, { color: tema.botaoTexto }]}>{ehLembrete ? t('Revisar nota') : t('Vou fazer')}</Text>
            </TouchableOpacity>
          </MotiView>

          <MotiView
            from={{ opacity: 0, translateY: 34 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 120, delay: 380 }}
          >
            <TouchableOpacity
              style={[styles.botao, { backgroundColor: '#FF9F0A' }]}
              activeOpacity={0.85}
              onPress={() => {
                if (ehLembrete) {
                  sonecaLembrete(alarme.id, alarme.titulo, tempoSoneca);
                } else {
                  sonecaAlarme(alarme.id, tempoSoneca);
                }
                fechar();
              }}
            >
              <Ionicons name="time" size={26} color={tema.botaoTexto} />
              <Text style={[styles.botaoTexto, { color: tema.botaoTexto }]}>{t('Daqui a {n} min', { n: tempoSoneca })}</Text>
            </TouchableOpacity>
          </MotiView>

          <MotiView
            from={{ opacity: 0, translateY: 34 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 120, delay: 480 }}
          >
            <TouchableOpacity
              style={[styles.botao, { backgroundColor: tema.botaoNeutroFundo }]}
              activeOpacity={0.85}
              onPress={fechar}
            >
              <Ionicons name="calendar-clear" size={26} color={tema.botaoNeutroTexto} />
              <Text style={[styles.botaoTexto, { color: tema.botaoNeutroTexto }]}>{t('Deixar para depois')}</Text>
            </TouchableOpacity>
          </MotiView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 96,
    paddingHorizontal: 24,
  },
  ringsArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
  },
  horaArea: { alignItems: 'center' },
  horaTexto: {
    fontSize: 78,
    fontWeight: '200',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  alarmeLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 7,
    marginTop: 10,
  },
  card: { alignItems: 'center', width: '100%' },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 10,
  },
  cardTitulo: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  cardSub: {
    fontSize: 16,
    marginTop: 10,
  },
  botoesArea: { width: '100%' },
  botao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 58,
    borderRadius: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  botaoTexto: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
  },
});
