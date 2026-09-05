import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { appColors } from '../constants/theme';
import {
  abrirConfigAlarmeExato,
  abrirConfigAutostart,
  abrirConfigBateria,
  abrirConfigNotificacoes,
  abrirConfigSobreposicao,
  abrirConfigTelaCheia,
  abrirPermissoesMiui,
  ehDispositivoXiaomi,
  estaIgnorandoOtimizacaoBateria,
  podeAgendarAlarmeExato,
  podeExibirSobreposicao,
  podeUsarTelaCheia,
} from '../modules/minhasnotas-alarm';

type Status = 'ok' | 'falta' | 'desconhecido';

interface ItemPermissao {
  chave: string;
  titulo: string;
  descricao: string;
  guia?: string;
  status: Status;
  abrir: () => void;
}

const ICONES_STATUS: Record<Status, { icone: any; cor: string }> = {
  ok: { icone: 'checkmark-circle', cor: '#34C759' },
  falta: { icone: 'alert-circle', cor: '#FF9F0A' },
  desconhecido: { icone: 'help-circle', cor: '#8E8E93' },
};

export default function PermissoesScreen() {
  const { isDark, t } = useTheme();
  const insets = useSafeAreaInsets();
  const [itens, setItens] = useState<ItemPermissao[] | null>(null);
  const [ehXiaomi, setEhXiaomi] = useState(false);
  const [verificando, setVerificando] = useState(true);

  const paleta = appColors(isDark);
  const cores = {
    fundo: paleta.background,
    card: paleta.surface,
    cardBorda: paleta.border,
    texto: paleta.text,
    subtexto: paleta.muted,
    accent: paleta.primary,
    accentForte: paleta.primaryStrong,
    avisoFundo: paleta.surfaceElevated,
  };

  const verificar = useCallback(async () => {
    setVerificando(true);
    let xiaomi = false;
    try {
      xiaomi = await ehDispositivoXiaomi();
    } catch {
      xiaomi = false;
    }
    setEhXiaomi(xiaomi);

    const lista: ItemPermissao[] = [];
    const apiLevel = Number(Platform.Version) || 0;

    try {
      // 1. Notificações
      let notif = false;
      try {
        const permissao = await Notifications.getPermissionsAsync();
        notif = !!permissao.granted;
      } catch {
        notif = true; // sem expo-notifications (web/dev)
      }
      lista.push({
        chave: 'notificacoes',
        titulo: t('Notificações ativadas'),
        descricao: notif ? t('O app pode tocar o som do alarme') : t('O app precisa da permissão para tocar o alarme'),
        status: notif ? 'ok' : 'falta',
        abrir: abrirConfigNotificacoes,
      });

      // 2. Alarme exato (Android 12+)
      if (apiLevel >= 31) {
        const exato = await podeAgendarAlarmeExato();
        lista.push({
          chave: 'alarmeExato',
          titulo: t('Alarme exato'),
          descricao: exato ? t('O alarme dispara na hora certa') : t('Sem isso, o alarme pode atrasar alguns minutos'),
          status: exato ? 'ok' : 'falta',
          abrir: abrirConfigAlarmeExato,
        });
      }

      // 3. Popup do alarme (sobreposição) — no Xiaomi é o "Exibir pop-ups em segundo plano"
      if (xiaomi) {
        const popup = await podeExibirSobreposicao();
        lista.push({
          chave: 'popupMiui',
          titulo: t('Exibir pop-ups em segundo plano (MIUI)'),
          descricao: popup
            ? t('Popup liberado para abrir fora do app')
            : t('Essencial no Xiaomi para o alarme abrir como popup (não só notificação)'),
          status: popup ? 'ok' : 'falta',
          abrir: abrirPermissoesMiui,
        });
      } else {
        const popup = await podeExibirSobreposicao();
        lista.push({
          chave: 'popup',
          titulo: t('Popup sobre outros apps'),
          descricao: popup
            ? t('O alarme abre por cima de tudo, mesmo com a tela ligada')
            : t('Permite o alarme abrir por cima de outros apps'),
          status: popup ? 'ok' : 'falta',
          abrir: abrirConfigSobreposicao,
        });
      }

      // 3b. Tela cheia do Android 14+ (pode coexistir com o item MIUI acima)
      if (apiLevel >= 34) {
        const telaCheia = await podeUsarTelaCheia();
        lista.push({
          chave: 'telaCheia',
          titulo: t('Tela cheia (Android 14+)'),
          descricao: telaCheia
            ? t('Pode abrir por cima de tudo, mesmo bloqueado')
            : t('Ative em Ajustes → Acesso especial → Tela cheia'),
          status: telaCheia ? 'ok' : 'falta',
          abrir: abrirConfigTelaCheia,
        });
      }

      // 4. Otimização de bateria
      const bateria = await estaIgnorandoOtimizacaoBateria();
      lista.push({
        chave: 'bateria',
        titulo: t('Otimização de bateria'),
        descricao: bateria
          ? t('Sem restrições — alarme toca com o app fechado')
          : t('Defina "Sem restrições" para o alarme tocar com o app fechado'),
        status: bateria ? 'ok' : 'falta',
        abrir: abrirConfigBateria,
      });

      // 5. Extras do Xiaomi (não verificáveis programaticamente — guia manual)
      if (xiaomi) {
        lista.push({
          chave: 'autostart',
          titulo: t('Iniciar automaticamente (Autostart)'),
          descricao: t('Garante que o alarme dispare com o app fechado'),
          guia: t('Ajustes → Apps → Gerenciar apps → Simple Notes → Iniciar automaticamente'),
          status: 'desconhecido',
          abrir: abrirConfigAutostart,
        });
        lista.push({
          chave: 'telaBloqueio',
          titulo: t('Notificações na tela de bloqueio'),
          descricao: t('Mostra o alarme com o celular bloqueado'),
          guia: t('Ajustes → Notificações → Na tela de bloqueio → Mostrar tudo'),
          status: 'desconhecido',
          abrir: abrirConfigNotificacoes,
        });
      }
    } catch {
      // mantém a lista parcial
    }

    setItens(lista);
    setVerificando(false);
  }, []);

  // Re-verifica ao abrir a tela e ao voltar das configurações do sistema
  useFocusEffect(
    useCallback(() => {
      verificar();
    }, [verificar])
  );

  const appStateRef = useRef(AppState.currentState);
  useFocusEffect(
    useCallback(() => {
      const sub = AppState.addEventListener('change', estado => {
        const veioDeFora = appStateRef.current.match(/inactive|background/) && estado === 'active';
        appStateRef.current = estado;
        if (veioDeFora) verificar();
      });
      return () => sub.remove();
    }, [verificar])
  );

  return (
    <View style={[styles.container, { backgroundColor: cores.fundo }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {/* CABEÇALHO: voltar + título + atualizar */}
        <MotiView
          from={{ opacity: 0, translateY: -12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 350 }}
          style={styles.headerRow}
        >
          <TouchableOpacity
            style={[styles.roundBtn, { backgroundColor: cores.card, borderColor: cores.cardBorda }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={cores.accentForte} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: cores.texto }]}>{t('Permissões do alarme')}</Text>
          <TouchableOpacity
            style={[styles.roundBtn, { backgroundColor: cores.card, borderColor: cores.cardBorda }]}
            onPress={verificar}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={20} color={cores.accentForte} />
          </TouchableOpacity>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 80 }}
        >
          <Text style={[styles.subtitle, { color: cores.subtexto } ]}>
            {t('No Android, o alarme só abre em POPUP (por cima de outros apps) se o app tiver as permissões abaixo. Em aparelhos Xiaomi (MIUI/HyperOS) são necessários alguns passos extras.')}
          </Text>

          <View style={[styles.avisoBox, { backgroundColor: cores.avisoFundo, borderColor: cores.cardBorda }]}>
            <Ionicons name="bulb" size={18} color={cores.accentForte} />
            <Text style={[styles.avisoBoxTexto, { color: cores.subtexto }]}>
              {t('Com a permissão de popup (sobreposição) ativada, o alarme abre por cima de tudo — mesmo com a tela ligada. Sem ela: com a tela bloqueada/desligada abre em tela cheia; com a tela ligada mostra apenas um aviso no topo (toque nele para abrir o alarme).')}
            </Text>
          </View>

          {ehXiaomi && (
            <MotiView
              from={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 400, delay: 120 }}
              style={[styles.chip, { backgroundColor: isDark ? '#1A1606' : '#FFF6DE', borderColor: isDark ? '#3A2F0A' : '#F0D68A' }]}
            >
              <Ionicons name="phone-portrait" size={18} color="#FFB300" />
              <Text style={[styles.chipText, { color: isDark ? '#FFD60A' : '#9A6B00' }]}>
                {t('Dispositivo Xiaomi / MIUI detectado — ative os itens abaixo para o popup funcionar')}
              </Text>
            </MotiView>
          )}
        </MotiView>

        {/* CHECKLIST */}
        {itens === null || verificando ? (
          <View style={styles.carregando}>
            <ActivityIndicator color={cores.accent} size="large" />
            <Text style={[styles.carregandoTexto, { color: cores.subtexto } ]}>{t('Verificando permissões...')}</Text>
          </View>
        ) : (
          <View style={styles.lista}>
            {itens.map((item, i) => {
              const s = ICONES_STATUS[item.status];
              return (
                <MotiView
                  key={item.chave}
                  from={{ opacity: 0, translateY: 18, scale: 0.98 }}
                  animate={{ opacity: 1, translateY: 0, scale: 1 }}
                  transition={{ type: 'timing', duration: 320, delay: 60 + i * 70 }}
                  style={[styles.card, { backgroundColor: cores.card, borderColor: cores.cardBorda }]}
                >
                  <View style={styles.cardLinha}>
                    <Ionicons name={s.icone} size={26} color={s.cor} style={styles.cardIcone} />
                    <View style={styles.cardTexto}>
                      <Text style={[styles.cardTitulo, { color: cores.texto }]}>{item.titulo}</Text>
                      <Text style={[styles.cardDescricao, { color: cores.subtexto }]}>{item.descricao}</Text>
                      {!!item.guia && (
                        <View style={styles.guiaBox}>
                          <Ionicons name="information-circle" size={14} color={cores.subtexto} />
                          <Text style={[styles.guiaTexto, { color: cores.subtexto }]}>{item.guia}</Text>
                        </View>
                      )}
                    </View>
                    {item.status === 'ok' ? (
                      <View style={styles.okPill}>
                        <Text style={styles.okPillTexto}>OK</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.acionarBtn, { backgroundColor: cores.accent }]}
                        onPress={item.abrir}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.acionarBtnTexto}>{t('Abrir')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </MotiView>
              );
            })}
          </View>
        )}

        <Text style={[styles.nota, { color: cores.subtexto } ]}>
          {t('Dica: se ainda assim o popup não abrir, verifique também em Ajustes → Bateria → Gerenciar bateria do aparelho se o app está como “Sem restrições” (o nome varia por fabricante: Samsung, Xiaomi, Motorola, etc.).')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  roundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '900', flex: 1, marginHorizontal: 12, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  avisoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  avisoBoxTexto: { fontSize: 13, lineHeight: 19, marginLeft: 10, flex: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  chipText: { fontSize: 13, fontWeight: '600', marginLeft: 10, flex: 1, lineHeight: 18 },
  carregando: { alignItems: 'center', paddingVertical: 60 },
  carregandoTexto: { fontSize: 14, marginTop: 14 },
  lista: { marginTop: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardLinha: { flexDirection: 'row', alignItems: 'center' },
  cardIcone: { marginRight: 12 },
  cardTexto: { flex: 1 },
  cardTitulo: { fontSize: 15, fontWeight: '700' },
  cardDescricao: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  guiaBox: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  guiaTexto: { fontSize: 12, marginLeft: 5, flex: 1, lineHeight: 16 },
  okPill: {
    backgroundColor: '#34C75922',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  okPillTexto: { color: '#34C759', fontSize: 12, fontWeight: '800' },
  acionarBtn: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginLeft: 8 },
  acionarBtnTexto: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  nota: { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10, marginTop: 12 },
});
