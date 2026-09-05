import AsyncStorage from '@react-native-async-storage/async-storage';
import { MotiView } from 'moti';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AppState, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { appColors } from '../constants/theme';
import { useMonetizacao } from './monetizacao';
import { useNotas } from './NotasContext';
import { useTheme } from './ThemeContext';

/**
 * Lembrete de FEEDBACK (plano gratuito).
 *
 * Mostra, de vez em quando, um pedido para a pessoa avaliar/enviar feedback —
 * mas SÓ quando:
 *  - está no plano GRATUITO (não comprou remoção de anúncios);
 *  - a conta logada NUNCA deu feedback (ou não há conta logada);
 *  - e o último pedido foi há mais de INTERVALO_DIAS.
 * Quando a pessoa avalia ou envia e-mail, a conta fica marcada como "já deu
 * feedback" e o app nunca mais pergunta para ela.
 */
const EMAIL_FEEDBACK = 'heitoruliacchrabeloreis@gmail.com';
const PLAYSTORE_ID = 'com.seuusuario.simplesnotes';
const INTERVALO_DIAS = 7;
// Só mostra depois do app ter carregado (evita aparecer por cima do boot/login)
const ATRASO_INICIAL_MS = 6000;

const chaveFeedbackDado = (usuarioId: string) => `@feedback_dado_${usuarioId}`;
const CHAVE_ULTIMO_PROMPT = '@feedback_ultimo_prompt';

interface FeedbackContextData {
  /** Abre o pedido de feedback manualmente (ex.: de um botão). */
  abrirFeedback: () => void;
}
const FeedbackContext = createContext<FeedbackContextData>({ abrirFeedback: () => {} });
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { isDark, t } = useTheme();
  const { anunciosRemovidos } = useMonetizacao();
  const { usuarioId } = useNotas();
  const [visivel, setVisivel] = useState(false);
  const checandoRef = useRef(false);

  const paleta = appColors(isDark);

  const fechar = useCallback(() => setVisivel(false), []);

  // Marca a conta (ou o modo local) como "já deu feedback" — nunca mais pergunta.
  const marcarFeedbackDado = useCallback(async (id: string) => {
    try {
      await AsyncStorage.setItem(chaveFeedbackDado(id), '1');
    } catch (e) {
      // ignora falha de storage
    }
  }, []);

  const avaliar = useCallback(() => {
    fechar();
    marcarFeedbackDado(usuarioId);
    Linking.openURL(`market://details?id=${PLAYSTORE_ID}`).catch(() => {
      Linking.openURL(`https://play.google.com/store/apps/details?id=${PLAYSTORE_ID}`).catch(() => {});
    });
  }, [fechar, marcarFeedbackDado, usuarioId]);

  const enviarEmail = useCallback(() => {
    fechar();
    marcarFeedbackDado(usuarioId);
    const assunto = encodeURIComponent(t('Feedback — Simple Notes'));
    Linking.openURL(`mailto:${EMAIL_FEEDBACK}?subject=${assunto}`).catch(() => {});
  }, [fechar, marcarFeedbackDado, usuarioId]);

  const verificar = useCallback(async () => {
    if (checandoRef.current) return;
    // Só no Android (a avaliação é na Play Store) e apenas no plano gratuito.
    if (Platform.OS !== 'android') return;
    if (anunciosRemovidos) return;
    // Conta logada OU modo local (sem conta): a regra vale para os dois.
    const id = usuarioId || 'local';
    try {
      const jaDeuFeedback = await AsyncStorage.getItem(chaveFeedbackDado(id));
      if (jaDeuFeedback === '1') return; // essa conta já avaliou → nunca mais
      const ultimo = await AsyncStorage.getItem(CHAVE_ULTIMO_PROMPT);
      const agora = Date.now();
      if (ultimo && agora - Number(ultimo) < INTERVALO_DIAS * 24 * 60 * 60 * 1000) return;
      await AsyncStorage.setItem(CHAVE_ULTIMO_PROMPT, String(agora));
      checandoRef.current = true;
      setVisivel(true);
    } catch (e) {
      // ignora
    }
  }, [anunciosRemovidos, usuarioId]);

  useEffect(() => {
    const t = setTimeout(verificar, ATRASO_INICIAL_MS);
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') verificar();
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [verificar]);

  return (
    <FeedbackContext.Provider value={{ abrirFeedback: () => verificar() }}>
      {children}
      <Modal visible={visivel} transparent animationType="fade" onRequestClose={fechar}>
        <View style={styles.modalFundo}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={fechar} />
          <MotiView
            from={{ opacity: 0, translateY: 520 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 18, stiffness: 140 }}
            style={[styles.sheet, { backgroundColor: paleta.background, borderColor: paleta.border }]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: paleta.border }]} />
            <Text style={[styles.titulo, { color: paleta.text }]}>{t('Como está usando o app?')}</Text>
            <Text style={[styles.sub, { color: paleta.muted }]}>
              {t('Seu feedback ajuda a melhorar o Simple Notes. Leva menos de um minuto!')}
            </Text>
            <TouchableOpacity
              style={[styles.btnPrimario, { backgroundColor: paleta.primary }]}
              activeOpacity={0.85}
              onPress={avaliar}
            >
              <Text style={[styles.txtPrimario, { color: paleta.onPrimary }]}>{t('Avaliar no Google Play')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSecundario, { borderColor: paleta.border, backgroundColor: paleta.surface }]}
              activeOpacity={0.85}
              onPress={enviarEmail}
            >
              <Text style={[styles.txtSecundario, { color: paleta.text }]}>{t('Enviar feedback por e-mail')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnDepois} activeOpacity={0.7} onPress={fechar}>
              <Text style={[styles.txtDepois, { color: paleta.muted }]}>{t('Agora não')}</Text>
            </TouchableOpacity>
          </MotiView>
        </View>
      </Modal>
    </FeedbackContext.Provider>
  );
}

const styles = StyleSheet.create({
  modalFundo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingBottom: 40,
    paddingTop: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    marginBottom: 16,
  },
  titulo: {
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  sub: {
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 22,
  },
  btnPrimario: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  txtPrimario: {
    fontSize: 15.5,
    fontWeight: '800',
  },
  btnSecundario: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  txtSecundario: {
    fontSize: 15,
    fontWeight: '700',
  },
  btnDepois: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txtDepois: {
    fontSize: 14.5,
    fontWeight: '600',
  },
});