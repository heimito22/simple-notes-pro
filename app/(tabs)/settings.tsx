import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PreviewSom from '../../components/preview-som';
import { useMonetizacao } from '../../context/monetizacao';
import { useTheme } from '../../context/ThemeContext';
import { appColors } from '../../constants/theme';
import { infoDoSom, SONS_ALARME } from '../../context/sons-alarme';
import { IDIOMAS } from '../../context/idiomas';
import { alarmeNativoDisponivel, obterPrecoRemoverAnuncios, pararSomAlarme, previewSomAlarme } from '../../modules/minhasnotas-alarm';

export default function SettingsScreen() {
  const { isDark, toggleTheme, config, atualizarConfig, t } = useTheme();
  const insets = useSafeAreaInsets();
  const { anunciosRemovidos, premiumPorEmail, comprando, comprarRemoverAnuncios, emailLogado, emailDonoCompra, solicitarLoginParaCompra, cancelarCompraPendente } = useMonetizacao();
  const router = useRouter();
  // Preço exibido: lido do Play Console (fallback enquanto o produto não é publicado)
  const [precoAnuncios, setPrecoAnuncios] = useState('R$ 5,99');

  const [somModalAberto, setSomModalAberto] = useState(false);
  const [idiomaModalAberto, setIdiomaModalAberto] = useState(false);
  const [somEmPreview, setSomEmPreview] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chave da IA (campo de texto local, salva ao digitar)
  const [chaveEditando, setChaveEditando] = useState(config.chaveIA || '');
  const [chaveVisivel, setChaveVisivel] = useState(false);
  const [tutorialIA, setTutorialIA] = useState(false);
  // DESKTOP: modal de definir/trocar o PIN de 4 dígitos (bloqueio do app)
  const [modalPinVisivel, setModalPinVisivel] = useState(false);
  const [pinNovo, setPinNovo] = useState('');
  const [pinConfirma, setPinConfirma] = useState('');
  const [pinEtapa, setPinEtapa] = useState<'criar' | 'confirmar'>('criar');
  const timerChave = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Salva a chave automaticamente (com debounce de 600ms)
  const salvarChaveIA = (valor: string) => {
    setChaveEditando(valor);
    if (timerChave.current) clearTimeout(timerChave.current);
    timerChave.current = setTimeout(() => {
      atualizarConfig('chaveIA', valor.trim());
    }, 600);
  };

  // Mantém o campo sincronizado com a config — a chave pode ser restaurada do
  // backup do Drive após o login (sem isso o campo ficaria vazio no app). O
  // setState fica em timer para não rodar no corpo do efeito (lint).
  useEffect(() => {
    const t = setTimeout(() => setChaveEditando(config.chaveIA || ''), 0);
    return () => clearTimeout(t);
  }, [config.chaveIA]);

  // Limpa o timer ao desmontar
  useEffect(() => {
    return () => {
      if (timerChave.current) clearTimeout(timerChave.current);
    };
  }, []);

  const paleta = appColors(isDark);
  const cores = {
    fundo: paleta.background,
    textoPrincipal: paleta.text,
    textoSecundario: paleta.muted,
    itemFundo: paleta.surface,
    borda: paleta.border,
    accent: paleta.primary,
    // Modal do seletor de som (tema claro/escuro)
    sheetFundo: paleta.background,
    sheetBorda: paleta.border,
    sheetHandle: paleta.border,
    sheetTitulo: paleta.text,
    sheetSub: paleta.muted,
    botaoFecharFundo: paleta.surfaceElevated,
    botaoFecharIcone: paleta.text,
    somRowFundo: paleta.surface,
    somRowBorda: paleta.border,
    somNome: paleta.text,
    somIconeFundo: paleta.primarySoft,
    botaoOuvirFundo: paleta.surfaceElevated,
    botaoOuvirIcone: paleta.text,
    botaoRemoverFundo: paleta.dangerSoft,
    onPrimary: paleta.onPrimary,
  };

  // Preço real do produto "remover_anuncios" no Play Console (se publicado)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    obterPrecoRemoverAnuncios().then(p => {
      if (p) setPrecoAnuncios(p);
    }).catch(() => {});
  }, []);

  // Para a prévia/volume caso a tela desmonte (ex.: navegação para /permissoes)
  useEffect(() => {
    return () => {
      if (Platform.OS === 'android' && alarmeNativoDisponivel()) pararSomAlarme();
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);

  const handleToggleBiometriaApp = async (valor: boolean) => {
    if (Platform.OS === 'web') {
      // DESKTOP: bloqueio por PIN do próprio app. Ligar exige cadastrar o PIN
      // (modal); desligar limpa o PIN guardado.
      if (valor) {
        setModalPinVisivel(true);
      } else {
        atualizarConfig('pinDesbloqueio', '');
        atualizarConfig('exigirBiometriaApp', false);
      }
      return;
    }
    if (valor) {
      const temHardware = await LocalAuthentication.hasHardwareAsync();
      const temBiometriaSalva = await LocalAuthentication.isEnrolledAsync();

      if (!temHardware) {
        Alert.alert(t('Erro'), t('Este dispositivo não possui suporte a biometria.'));
        return;
      }

      if (!temBiometriaSalva) {
        Alert.alert(t('Erro'), t('Nenhuma biometria (digital ou rosto) cadastrada no sistema.'));
        return;
      }

      const autenticou = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Confirme sua identidade para ativar')
      });

      if (!autenticou.success) return;
    }
    
    atualizarConfig('exigirBiometriaApp', valor);
  };

  const fecharModalPin = () => {
    setModalPinVisivel(false);
    setPinNovo('');
    setPinConfirma('');
    setPinEtapa('criar');
  };

  const selecionarTempo = () => {
    const tempos = [0, 1, 5, 10, 30];
    Alert.alert(
      t('Tempo para Bloqueio'),
      t('Após quanto tempo fora do app devemos exigir a biometria?'),
      tempos.map(m => ({
        text: m === 0 ? t('Imediatamente') : t('{n} minutos', { n: m }),
        onPress: () => atualizarConfig('tempoBloqueio', m)
      })),
      { cancelable: true }
    );
  };

  const selecionarSoneca = () => {
    const opcoes = [5, 10, 15, 20, 30, 45, 60];
    Alert.alert(
      t('Soneca do alarme'),
      t('Quanto tempo o alarme adia ao tocar em "Daqui a X min"?'),
      opcoes.map(m => ({
        text: t('{n} minutos', { n: m }),
        onPress: () => atualizarConfig('tempoSoneca', m)
      })),
      { cancelable: true }
    );
  };

  const ouvirSom = (chave: string) => {
    setSomEmPreview(chave);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    // Android com módulo nativo: prévia via MediaPlayer (stream de alarme).
    // iOS/Expo Go: prévia via expo-audio (componente PreviewSom).
    const nativo = Platform.OS === 'android' && alarmeNativoDisponivel();
    if (nativo) previewSomAlarme(chave);
    previewTimer.current = setTimeout(() => {
      if (nativo) pararSomAlarme();
      setSomEmPreview(null);
    }, 2600);
  };

  const fecharSomModal = () => {
    setSomModalAberto(false);
    setSomEmPreview(null);
    if (Platform.OS === 'android' && alarmeNativoDisponivel()) pararSomAlarme();
    if (previewTimer.current) clearTimeout(previewTimer.current);
  };

  // Compra de premium: o pagamento só abre com conta Google logada (o premium
  // fica vinculado ao email da conta). Sem conta → orienta a entrar; com conta
  // de outro dono → avisa qual email tem o premium comprado.
  const tentarComprarPremium = async () => {
    if (anunciosRemovidos || comprando) return;
    const res = await comprarRemoverAnuncios();
    if (res === 'aberta') return; // janela de pagamento abriu (ou já liberado)
    if (res === 'indisponivel') {
      Alert.alert(t('Erro'), t('Pagamento indisponível neste aparelho.'));
      return;
    }
    if (res === 'outraConta') {
      Alert.alert(
        t('Premium'),
        emailDonoCompra
          ? t('Este aparelho já tem Premium comprado pelo email {email}. Entre com essa conta para usar sem anúncios.', { email: emailDonoCompra })
          : t('Este aparelho já tem Premium comprado. Entre com a conta que fez a compra para usar sem anúncios.')
      );
      return;
    }
    // precisaLogin: pede a conta ANTES de abrir o pagamento.
    Alert.alert(
      t('Premium'),
      t('Para comprar o Premium, primeiro entre na sua conta Google. O Premium fica vinculado ao email da conta que fez a compra.'),
      [
        { text: t('Cancelar'), style: 'cancel', onPress: () => cancelarCompraPendente() },
        { text: t('Entrar'), onPress: () => solicitarLoginParaCompra() },
      ]
    );
  };

  return (
    <ScrollView
      testID="sn-screen-ajustes"
      style={[styles.container, { backgroundColor: cores.fundo }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: cores.textoPrincipal }]}>{t('Configurações')}</Text>
      
      {/* SEÇÃO APARÊNCIA */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: cores.textoSecundario } ]}>{t('Aparência')}</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo, borderColor: cores.borda, borderWidth: 1 }]}>
          <View style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: 1 }]}>
            <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Modo Escuro')}</Text>
            <Switch 
              value={isDark} 
              onValueChange={toggleTheme} 
              trackColor={{ false: '#767577', true: cores.accent }}
            />
          </View>
          <TouchableOpacity
            style={[styles.innerItem, { borderBottomWidth: 0 }]}
            onPress={() => setIdiomaModalAberto(true)}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: paleta.primarySoft }]}>
              <Ionicons name="language" size={20} color={cores.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Idioma')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>{t('Idioma do aplicativo e do assistente de IA')}</Text>
            </View>
            <Text style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16 }}>
              {IDIOMAS.find(i => i.cod === config.idioma)?.rotulo ?? 'Português'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      </View>

      {/* SEÇÃO INTERFACE - NOVO */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: cores.textoSecundario } ]}>{t('Interface')}</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo, borderColor: cores.borda, borderWidth: 1 }]}>
          <View style={styles.innerItem}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Ajuda no Menu +')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>{t('Mostrar botão de guia no menu de criação')}</Text>
            </View>
            <Switch 
              value={config.exibirAjudaFAB ?? true} 
              onValueChange={(valor) => atualizarConfig('exibirAjudaFAB', valor)} 
              trackColor={{ false: '#767577', true: cores.accent }}
            />
          </View>
        </View>
      </View>

      {/* SEÇÃO ALARME — só no celular (alarme nativo não existe no PC) */}
      {Platform.OS !== 'web' && (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: cores.textoSecundario } ]}>{t('Alarme')}</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo, borderColor: cores.borda, borderWidth: 1 }]}>
          <TouchableOpacity
            style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: 1 }]}
            onPress={() => setSomModalAberto(true)}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: paleta.primarySoft }]}>
              <Ionicons name="musical-notes" size={20} color={cores.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Som do alarme')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>{t('Toca no volume de alarme, no máximo')}</Text>
            </View>
            <Text
              style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16, maxWidth: 110 }}
              numberOfLines={1}
            >
              {t(infoDoSom(config.somAlarme).nome)}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#999" style={{ marginLeft: 6 }} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: 1 }]}
            onPress={selecionarSoneca}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: paleta.primarySoft }]}>
              <Ionicons name="alarm" size={20} color={paleta.warning} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Soneca do alarme')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>{t('Tempo ao tocar em “Daqui a X min”')}</Text>
            </View>
            <Text style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16 }}>
              {t('{n} min', { n: config.tempoSoneca })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.innerItem, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/permissoes')}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: paleta.primarySoft }]}>
              <Ionicons name="shield-checkmark" size={20} color={cores.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Permissões do alarme')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>{t('Popup em tela cheia · Xiaomi · bateria')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* SEÇÃO ANÚNCIOS / REMOVER ANÚNCIOS */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: cores.textoSecundario } ]}>{t('Anúncios')}</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo, borderColor: cores.borda, borderWidth: 1 }]}>
          {anunciosRemovidos ? (
            <View style={styles.innerItem}>
              <View style={[styles.iconeItem, { backgroundColor: paleta.primarySoft }]}>
                <Ionicons name="checkmark-circle" size={20} color={paleta.success} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Anúncios removidos')}</Text>
                <Text style={[styles.subText, { color: cores.textoSecundario } ]}>
                  {premiumPorEmail
                    ? t('Premium liberado por convite do desenvolvedor')
                    : emailDonoCompra
                      ? t('Premium comprado · vinculado a {email}', { email: emailDonoCompra })
                      : t('Obrigado pelo apoio! Sem anúncios para sempre')}
                </Text>
              </View>
              {premiumPorEmail ? (
                <View style={[styles.seloPremium, { backgroundColor: paleta.primarySoft }]}>
                  <Ionicons name="gift" size={12} color={paleta.warning} />
                  <Text style={styles.seloPremiumTexto} numberOfLines={1}>{t('Premium por convite')}</Text>
                </View>
              ) : (
                <Ionicons name="sparkles" size={20} color={paleta.warning} />
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.innerItem, { borderBottomWidth: 0 }]}
              onPress={tentarComprarPremium}
              activeOpacity={0.6}
              disabled={comprando}
            >
              <View style={[styles.iconeItem, { backgroundColor: paleta.primarySoft }]}>
                <Ionicons name="shield-checkmark" size={20} color={cores.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>
                  {t('Remover anúncios para sempre')}
                </Text>
                <Text style={[styles.subText, { color: cores.textoSecundario } ]}>
                  {emailLogado
                    ? t('Pagamento único pela Play Store')
                    : t('Entre na sua conta para comprar — o Premium fica vinculado ao seu email')}
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: cores.accent,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                }}
              >
                <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>
                  {comprando ? '...' : precoAnuncios}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* SEÇÃO IA */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: cores.textoSecundario } ]}>{t('IA')}</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo, borderColor: cores.borda, borderWidth: 1 }]}>
          <View style={styles.innerItem}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Chave da IA (gratuita)')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>
                {t('Respostas como ChatGPT usando modelos grátis do OpenRouter')}
              </Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 15, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: cores.borda,
                  paddingHorizontal: 12,
                  fontSize: 14,
                  color: cores.textoPrincipal,
                  backgroundColor: paleta.background,
                }}
                placeholder="sk-or-v1-..."
                placeholderTextColor={cores.textoSecundario}
                value={chaveEditando}
                onChangeText={salvarChaveIA}
                secureTextEntry={!chaveVisivel}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setChaveVisivel(v => !v)}
                style={{ marginLeft: 8, padding: 6 }}
                hitSlop={8}
              >
                <Ionicons name={chaveVisivel ? 'eye-off-outline' : 'eye-outline'} size={20} color={cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: cores.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={() => setTutorialIA(true)}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '800' }}>
                  {t('Como criar a chave')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: cores.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={() => Linking.openURL('https://openrouter.ai/settings/keys')}
                activeOpacity={0.8}
              >
                <Text style={{ color: cores.accent, fontSize: 13, fontWeight: '800' }}>
                  {t('Abrir site')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* SEÇÃO SEGURANÇA */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: cores.textoSecundario } ]}>{t('Segurança')}</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo, borderColor: cores.borda, borderWidth: 1 }]}>
          
          <View style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: config.exigirBiometriaApp ? 1 : 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Bloquear App')}</Text>
              <Text style={[styles.subText, { color: cores.textoSecundario } ]}>
                {Platform.OS === 'web' ? t('Exigir PIN de 4 dígitos ao abrir o aplicativo') : t('Exigir biometria ao abrir o aplicativo')}
              </Text>
            </View>
            <Switch 
              value={config.exigirBiometriaApp} 
              onValueChange={handleToggleBiometriaApp} 
              trackColor={{ false: '#767577', true: cores.accent }}
            />
          </View>

          {config.exigirBiometriaApp && Platform.OS === 'web' && (
            /* DESKTOP: definir/trocar o PIN de 4 dígitos do próprio app */
            <TouchableOpacity
              style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: 1 }]}
              onPress={() => setModalPinVisivel(true)}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('PIN de Desbloqueio')}</Text>
                <Text style={[styles.subText, { color: cores.textoSecundario } ]}>
                  {config.pinDesbloqueio ? t('PIN configurado — toque para alterar') : t('Defina um PIN de 4 dígitos')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={cores.textoSecundario} />
            </TouchableOpacity>
          )}

          {config.exigirBiometriaApp && (
            <TouchableOpacity style={[styles.innerItem, { borderBottomWidth: 0 }]} onPress={selecionarTempo}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>{t('Tempo de Bloqueio')}</Text>
                <Text style={[styles.subText, { color: cores.textoSecundario } ]}>{t('Janela de carência antes de bloquear')}</Text>
              </View>
              <Text style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16 }}>
                {config.tempoBloqueio === 0 ? t('Imediato') : t('{n} min', { n: config.tempoBloqueio })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* DESKTOP: modal do PIN de desbloqueio (definir/trocar) */}
      <Modal visible={modalPinVisivel} transparent animationType="fade" onRequestClose={() => fecharModalPin()}>
        <KeyboardAvoidingView behavior="padding" style={styles.modalFundoPin}>
          <TouchableOpacity style={styles.modalDismissPin} activeOpacity={1} onPress={() => fecharModalPin()} />
          <View style={[styles.pinCard, { backgroundColor: cores.itemFundo, borderColor: cores.borda }]}>
            <Ionicons name="lock-closed-outline" size={30} color={cores.accent} style={{ marginBottom: 12 }} />
            <Text style={[styles.pinTitulo, { color: cores.textoPrincipal }]}>
              {pinEtapa === 'criar' ? t('Defina o PIN') : t('Confirme o PIN')}
            </Text>
            <Text style={[styles.pinSub, { color: cores.textoSecundario }]}>{t('4 dígitos numéricos')}</Text>
            <TextInput
              style={[styles.pinInput, { borderColor: cores.borda, color: cores.textoPrincipal }]}
              value={pinEtapa === 'criar' ? pinNovo : pinConfirma}
              onChangeText={(txt) => {
                const apenas = txt.replace(/[^0-9]/g, '').slice(0, 4);
                if (pinEtapa === 'criar') setPinNovo(apenas); else setPinConfirma(apenas);
              }}
              placeholder="••••"
              placeholderTextColor={cores.textoSecundario}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
              textAlign="center"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.pinBotao, { backgroundColor: cores.itemFundo, borderColor: cores.borda }]}
                onPress={() => fecharModalPin()}
                activeOpacity={0.8}
              >
                <Text style={[styles.pinBotaoTexto, { color: cores.textoPrincipal }]}>{t('Cancelar')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pinBotao, { backgroundColor: cores.accent, borderColor: cores.accent }]}
                onPress={() => {
                  if (pinEtapa === 'criar') {
                    if (pinNovo.length !== 4) return;
                    setPinEtapa('confirmar');
                  } else {
                    if (pinConfirma.length !== 4) return;
                    if (pinConfirma !== pinNovo) {
                      Alert.alert(t('Erro'), t('Os PINs não conferem. Tente novamente.'));
                      setPinConfirma('');
                      return;
                    }
                    atualizarConfig('pinDesbloqueio', pinNovo);
                    atualizarConfig('exigirBiometriaApp', true);
                    fecharModalPin();
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.pinBotaoTexto, { color: '#FFFFFF' }]}>{pinEtapa === 'criar' ? t('Continuar') : t('Salvar')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* TUTORIAL DA CHAVE DA IA */}
      <Modal
        visible={tutorialIA}
        transparent
        animationType="fade"
        onRequestClose={() => setTutorialIA(false)}
      >
        <View style={styles.modalFundo}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setTutorialIA(false)} />
          {/* Fundo escuro faz fade (Modal fade); o painel sobe sozinho com mola. */}
          <MotiView
            from={{ opacity: 0, translateY: 520 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 230 }}
          >
          <View style={[styles.sheet, { backgroundColor: cores.sheetFundo, borderColor: cores.sheetBorda, paddingBottom: 40 + insets.bottom }]}>
            <View style={[styles.sheetHandle, { backgroundColor: cores.sheetHandle }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitulo, { color: cores.sheetTitulo }]}>{t('Criar sua chave grátis')}</Text>
                <Text style={[styles.sheetSub, { color: cores.sheetSub }]}>
                  {t('Leva 1 minuto e não pede cartão')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setTutorialIA(false)} style={[styles.botaoFechar, { backgroundColor: cores.botaoFecharFundo }]} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={cores.botaoFecharIcone} />
              </TouchableOpacity>
            </View>

            {[1, 2, 3, 4, 5].map(n => (
              <View key={n} style={[styles.passo, { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda }]}>
                <View style={[styles.passoNumero, { backgroundColor: cores.accent }]}>
                  <Text style={styles.passoNumeroTexto}>{n}</Text>
                </View>
                <Text style={[styles.passoTexto, { color: cores.somNome }]}>
                  {t(`tutorial.chave.passo${n}`)}
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={[styles.botaoEntendi, { backgroundColor: cores.accent }]}
              onPress={() => setTutorialIA(false)}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>{t('Entendi!')}</Text>
            </TouchableOpacity>
          </View>
          </MotiView>
        </View>
      </Modal>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: cores.textoSecundario }]}>{t('Versão do App')}: {Constants.expoConfig?.version ?? '1.2.1'}</Text>
      </View>

      {/* SELETOR DE SOM DO ALARME (modal OLED) */}
      <Modal
        visible={somModalAberto}
        transparent
        animationType="fade"
        onRequestClose={fecharSomModal}
      >
        <View style={styles.modalFundo}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={fecharSomModal}
          />
          {/* Fundo escuro faz fade (Modal fade); o painel sobe sozinho com mola. */}
          <MotiView
            from={{ opacity: 0, translateY: 520 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 230 }}
          >
          <View style={[styles.sheet, { backgroundColor: cores.sheetFundo, borderColor: cores.sheetBorda, paddingBottom: 40 + insets.bottom }]}>
            <View style={[styles.sheetHandle, { backgroundColor: cores.sheetHandle }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitulo, { color: cores.sheetTitulo }]}>{t('Som do alarme')}</Text>
                <Text style={[styles.sheetSub, { color: cores.sheetSub }]}>
                  {t('Toca no volume de alarme do celular, forçado ao máximo')}
                </Text>
              </View>
              <TouchableOpacity onPress={fecharSomModal} style={[styles.botaoFechar, { backgroundColor: cores.botaoFecharFundo }]} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={cores.botaoFecharIcone} />
              </TouchableOpacity>
            </View>

            {SONS_ALARME.map(som => {
              const selecionado = config.somAlarme === som.chave;
              return (
                <TouchableOpacity
                  key={som.chave}
                  style={[
                    styles.somRow,
                    { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda },
                    selecionado && { borderColor: cores.accent },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => atualizarConfig('somAlarme', som.chave)}
                >
                  <View style={[styles.somIcone, { backgroundColor: cores.somIconeFundo }]}>
                    <Ionicons name={som.icone} size={20} color={cores.accent} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.somNome, { color: cores.somNome }]}>{t(som.nome)}</Text>
                    <Text style={[styles.somDesc, { color: cores.sheetSub }]}>{t(som.descricao)}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.botaoOuvir, { backgroundColor: cores.botaoOuvirFundo }]}
                    onPress={() => ouvirSom(som.chave)}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={somEmPreview === som.chave ? 'stop' : 'play'}
                      size={16}
                      color={cores.botaoOuvirIcone}
                    />
                  </TouchableOpacity>
                  {selecionado && (
                    <Ionicons name="checkmark-circle" size={24} color={cores.accent} style={{ marginLeft: 12 }} />
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Prévia via expo-audio (iOS / Expo Go — sem módulo nativo) */}
            {!alarmeNativoDisponivel() && somEmPreview && <PreviewSom chave={somEmPreview} />}
          </View>
          </MotiView>
        </View>
      </Modal>

      {/* SELETOR DE IDIOMA */}
      <Modal
        visible={idiomaModalAberto}
        transparent
        animationType="fade"
        onRequestClose={() => setIdiomaModalAberto(false)}
      >
        <View style={styles.modalFundo}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={() => setIdiomaModalAberto(false)}
          />
          <MotiView
            from={{ opacity: 0, translateY: 520 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 230 }}
          >
          <View style={[styles.sheet, { backgroundColor: cores.sheetFundo, borderColor: cores.sheetBorda, paddingBottom: 40 + insets.bottom }]}>
            <View style={[styles.sheetHandle, { backgroundColor: cores.sheetHandle }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitulo, { color: cores.sheetTitulo }]}>{t('Idioma')}</Text>
                <Text style={[styles.sheetSub, { color: cores.sheetSub }]}>
                  {t('Escolha o idioma do aplicativo e do assistente de IA')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIdiomaModalAberto(false)} style={[styles.botaoFechar, { backgroundColor: cores.botaoFecharFundo }]} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={cores.botaoFecharIcone} />
              </TouchableOpacity>
            </View>

            {IDIOMAS.map(idioma => {
              const selecionado = config.idioma === idioma.cod;
              return (
                <TouchableOpacity
                  key={idioma.cod}
                  style={[
                    styles.somRow,
                    { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda },
                    selecionado && { borderColor: cores.accent },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => {
                    atualizarConfig('idioma', idioma.cod);
                    setIdiomaModalAberto(false);
                  }}
                >
                  <View style={[styles.somIcone, { backgroundColor: cores.somIconeFundo }]}>
                    <Ionicons name="language" size={20} color={cores.accent} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.somNome, { color: cores.somNome }]}>{idioma.rotulo}</Text>
                    <Text style={[styles.somDesc, { color: cores.sheetSub }]}>
                      {idioma.cod === 'pt' && t('Português (padrão)')}
                      {idioma.cod === 'en' && t('Inglês')}
                      {idioma.cod === 'es' && t('Espanhol')}
                    </Text>
                  </View>
                  {selecionado && (
                    <Ionicons name="checkmark-circle" size={24} color={cores.accent} style={{ marginLeft: 12 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          </MotiView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingTop: 60, paddingHorizontal: 25, paddingBottom: 60 },
  title: { fontSize: 34, fontWeight: '900', marginBottom: 30 },
  section: { marginBottom: 25 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', marginBottom: 8, marginLeft: 10, letterSpacing: 1 },
  group: { borderRadius: 15, overflow: 'hidden' },
  item: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 15, 
    paddingHorizontal: 15,
  },
  innerItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 18, 
    paddingHorizontal: 15,
  },
  itemText: { fontSize: 17, fontWeight: '500' },
  subText: { fontSize: 12, marginTop: 2 },
  footer: { marginTop: 30, marginBottom: 20, alignItems: 'center' },
  footerText: { fontSize: 14 },
  seloPremium: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    gap: 4,
  },
  seloPremiumTexto: { color: '#FFB300', fontSize: 11, fontWeight: '800' },
  iconeItem: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Passos do tutorial da chave de IA
  passo: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    gap: 12,
  },
  passoNumero: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passoNumeroTexto: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  passoTexto: { flex: 1, fontSize: 14, lineHeight: 19 },
  botaoEntendi: {
    width: '100%',
    height: 50,
    marginTop: 14,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Modal do seletor de sons
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitulo: {
    fontSize: 21,
    fontWeight: '800',
  },
  sheetSub: {
    fontSize: 12.5,
    marginTop: 4,
  },
  botaoFechar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  somRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  somIcone: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  somNome: {
    fontSize: 16,
    fontWeight: '700',
  },
  somDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  botaoOuvir: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ---- Modal do PIN (desktop) ----
  modalFundoPin: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDismissPin: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  pinCard: {
    width: 360,
    maxWidth: '90%',
    borderRadius: 22,
    borderWidth: 1,
    padding: 26,
    alignItems: 'center',
  },
  pinTitulo: { fontSize: 20, fontWeight: '800' },
  pinSub: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  pinInput: {
    width: 160,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 8,
  },
  pinBotao: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBotaoTexto: { fontSize: 15, fontWeight: '700' },
});
