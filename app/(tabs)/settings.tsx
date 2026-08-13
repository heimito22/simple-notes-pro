import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import PreviewSom from '../../components/preview-som';
import { useMonetizacao } from '../../context/monetizacao';
import { useTheme } from '../../context/ThemeContext';
import { infoDoSom, SONS_ALARME } from '../../context/sons-alarme';
import { alarmeNativoDisponivel, obterPrecoRemoverAnuncios, pararSomAlarme, previewSomAlarme } from '../../modules/minhasnotas-alarm';

export default function SettingsScreen() {
  const { isDark, toggleTheme, config, atualizarConfig } = useTheme();
  const { anunciosRemovidos, premiumPorEmail, comprando, comprarRemoverAnuncios } = useMonetizacao();
  const router = useRouter();
  // Preço exibido: lido do Play Console (fallback enquanto o produto não é publicado)
  const [precoAnuncios, setPrecoAnuncios] = useState('R$ 5,99');

  const [somModalAberto, setSomModalAberto] = useState(false);
  const [somEmPreview, setSomEmPreview] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chave da IA (campo de texto local, salva ao digitar)
  const [chaveEditando, setChaveEditando] = useState(config.chaveIA || '');
  const [chaveVisivel, setChaveVisivel] = useState(false);
  const [tutorialIA, setTutorialIA] = useState(false);
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

  const cores = {
    fundo: isDark ? '#000' : '#F2F2F7',
    textoPrincipal: isDark ? '#FFF' : '#000',
    textoSecundario: '#888',
    itemFundo: isDark ? '#1C1C1E' : '#FFF',
    borda: isDark ? '#333' : '#E5E5EA',
    accent: isDark ? '#BB86FC' : '#6200EE',
    // Modal do seletor de som (tema claro/escuro)
    sheetFundo: isDark ? '#0D0D12' : '#FEFEFE',
    sheetBorda: isDark ? '#2A2A33' : '#E5E5EA',
    sheetHandle: isDark ? '#3A3A3C' : '#D1D1D6',
    sheetTitulo: isDark ? '#FFF' : '#1C1C1E',
    sheetSub: isDark ? '#8E8E93' : '#6E6E73',
    botaoFecharFundo: isDark ? '#1C1C1E' : '#F0F0F3',
    botaoFecharIcone: isDark ? '#FFF' : '#1C1C1E',
    somRowFundo: isDark ? '#16161D' : '#F5F5F7',
    somRowBorda: isDark ? '#23232B' : '#E8E8ED',
    somNome: isDark ? '#FFF' : '#1C1C1E',
    somIconeFundo: isDark ? '#241F33' : '#EDE7F6',
    botaoOuvirFundo: isDark ? '#2A2A33' : '#E8E8ED',
    botaoOuvirIcone: isDark ? '#FFF' : '#1C1C1E',
    botaoRemoverFundo: isDark ? '#3A1D1D' : '#FBE9E9',
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
    if (valor) {
      const temHardware = await LocalAuthentication.hasHardwareAsync();
      const temBiometriaSalva = await LocalAuthentication.isEnrolledAsync();

      if (!temHardware) {
        Alert.alert("Erro", "Este dispositivo não possui suporte a biometria.");
        return;
      }

      if (!temBiometriaSalva) {
        Alert.alert("Erro", "Nenhuma biometria (digital ou rosto) cadastrada no sistema.");
        return;
      }

      const autenticou = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirme sua identidade para ativar'
      });

      if (!autenticou.success) return;
    }
    
    atualizarConfig('exigirBiometriaApp', valor);
  };

  const selecionarTempo = () => {
    const tempos = [0, 1, 5, 10, 30];
    Alert.alert(
      "Tempo para Bloqueio",
      "Após quanto tempo fora do app devemos exigir a biometria?",
      tempos.map(t => ({
        text: t === 0 ? "Imediatamente" : `${t} minutos`,
        onPress: () => atualizarConfig('tempoBloqueio', t)
      })),
      { cancelable: true }
    );
  };

  const selecionarSoneca = () => {
    const opcoes = [5, 10, 15, 20, 30, 45, 60];
    Alert.alert(
      "Soneca do alarme",
      "Quanto tempo o alarme adia ao tocar em \"Daqui a X min\"?",
      opcoes.map(t => ({
        text: `${t} minutos`,
        onPress: () => atualizarConfig('tempoSoneca', t)
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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: cores.fundo }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: cores.textoPrincipal }]}>Configurações</Text>
      
      {/* SEÇÃO APARÊNCIA */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Aparência</Text>
        <View style={[styles.item, { backgroundColor: cores.itemFundo, borderRadius: 15 }]}>
          <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Modo Escuro</Text>
          <Switch 
            value={isDark} 
            onValueChange={toggleTheme} 
            trackColor={{ false: '#767577', true: cores.accent }}
          />
        </View>
      </View>

      {/* SEÇÃO INTERFACE - NOVO */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Interface</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo }]}>
          <View style={styles.innerItem}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Ajuda no Menu +</Text>
              <Text style={styles.subText}>Mostrar botão de guia no menu de criação</Text>
            </View>
            <Switch 
              value={config.exibirAjudaFAB ?? true} 
              onValueChange={(valor) => atualizarConfig('exibirAjudaFAB', valor)} 
              trackColor={{ false: '#767577', true: cores.accent }}
            />
          </View>
        </View>
      </View>

      {/* SEÇÃO ALARME */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alarme</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo }]}>
          <TouchableOpacity
            style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: 1 }]}
            onPress={() => setSomModalAberto(true)}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: isDark ? '#241F33' : '#EDE7F6' }]}>
              <Ionicons name="musical-notes" size={20} color={cores.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Som do alarme</Text>
              <Text style={styles.subText}>Toca no volume de alarme, no máximo</Text>
            </View>
            <Text
              style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16, maxWidth: 110 }}
              numberOfLines={1}
            >
              {infoDoSom(config.somAlarme).nome}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#999" style={{ marginLeft: 6 }} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: 1 }]}
            onPress={selecionarSoneca}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: isDark ? '#1E2410' : '#F5F3DC' }]}>
              <Ionicons name="alarm" size={20} color={isDark ? '#FFD60A' : '#B58900'} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Soneca do alarme</Text>
              <Text style={styles.subText}>Tempo ao tocar em “Daqui a X min”</Text>
            </View>
            <Text style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16 }}>
              {config.tempoSoneca} min
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.innerItem, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/permissoes')}
            activeOpacity={0.6}
          >
            <View style={[styles.iconeItem, { backgroundColor: isDark ? '#1F1933' : '#EDE7F6' }]}>
              <Ionicons name="shield-checkmark" size={20} color={cores.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Permissões do alarme</Text>
              <Text style={styles.subText}>Popup em tela cheia · Xiaomi · bateria</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      </View>

      {/* SEÇÃO ANÚNCIOS / REMOVER ANÚNCIOS */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Anúncios</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo }]}>
          {anunciosRemovidos ? (
            <View style={styles.innerItem}>
              <View style={[styles.iconeItem, { backgroundColor: isDark ? '#0E2418' : '#E4F6EC' }]}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Anúncios removidos</Text>
                <Text style={styles.subText}>
                  {premiumPorEmail
                    ? 'Premium liberado por convite do desenvolvedor'
                    : 'Obrigado pelo apoio! Sem anúncios para sempre'}
                </Text>
              </View>
              {premiumPorEmail ? (
                <View style={[styles.seloPremium, { backgroundColor: isDark ? '#3A2E0A' : '#FFF4D6' }]}>
                  <Ionicons name="gift" size={12} color="#FFB300" />
                  <Text style={styles.seloPremiumTexto} numberOfLines={1}>Premium por convite</Text>
                </View>
              ) : (
                <Ionicons name="sparkles" size={20} color="#FFD60A" />
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.innerItem, { borderBottomWidth: 0 }]}
              onPress={comprarRemoverAnuncios}
              activeOpacity={0.6}
              disabled={comprando}
            >
              <View style={[styles.iconeItem, { backgroundColor: isDark ? '#241F33' : '#EDE7F6' }]}>
                <Ionicons name="shield-checkmark" size={20} color={cores.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>
                  Remover anúncios para sempre
                </Text>
                <Text style={styles.subText}>Pagamento único pela Play Store</Text>
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
        <Text style={styles.sectionTitle}>IA</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo }]}>
          <View style={styles.innerItem}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Chave da IA (gratuita)</Text>
              <Text style={styles.subText}>
                Respostas como ChatGPT usando modelos grátis do OpenRouter
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
                  backgroundColor: isDark ? '#000' : '#F8F8FA',
                }}
                placeholder="sk-or-v1-..."
                placeholderTextColor="#888"
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
                <Ionicons name={chaveVisivel ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888" />
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
                  Como criar a chave
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
                  Abrir site
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* SEÇÃO SEGURANÇA */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Segurança</Text>
        <View style={[styles.group, { backgroundColor: cores.itemFundo }]}>
          
          <View style={[styles.innerItem, { borderBottomColor: cores.borda, borderBottomWidth: config.exigirBiometriaApp ? 1 : 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Bloquear App</Text>
              <Text style={styles.subText}>Exigir biometria ao abrir o aplicativo</Text>
            </View>
            <Switch 
              value={config.exigirBiometriaApp} 
              onValueChange={handleToggleBiometriaApp} 
              trackColor={{ false: '#767577', true: cores.accent }}
            />
          </View>

          {config.exigirBiometriaApp && (
            <TouchableOpacity style={[styles.innerItem, { borderBottomWidth: 0 }]} onPress={selecionarTempo}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemText, { color: cores.textoPrincipal }]}>Tempo de Bloqueio</Text>
                <Text style={styles.subText}>Janela de carência antes de bloquear</Text>
              </View>
              <Text style={{ color: cores.accent, fontWeight: 'bold', fontSize: 16 }}>
                {config.tempoBloqueio === 0 ? "Imediato" : `${config.tempoBloqueio} min`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* TUTORIAL DA CHAVE DA IA */}
      <Modal
        visible={tutorialIA}
        transparent
        animationType="slide"
        onRequestClose={() => setTutorialIA(false)}
      >
        <View style={styles.modalFundo}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setTutorialIA(false)} />
          <View style={[styles.sheet, { backgroundColor: cores.sheetFundo, borderColor: cores.sheetBorda }]}>
            <View style={[styles.sheetHandle, { backgroundColor: cores.sheetHandle }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitulo, { color: cores.sheetTitulo }]}>Criar sua chave grátis</Text>
                <Text style={[styles.sheetSub, { color: cores.sheetSub }]}>
                  Leva 1 minuto e não pede cartão
                </Text>
              </View>
              <TouchableOpacity onPress={() => setTutorialIA(false)} style={[styles.botaoFechar, { backgroundColor: cores.botaoFecharFundo }]} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={cores.botaoFecharIcone} />
              </TouchableOpacity>
            </View>

            <View style={[styles.passo, { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda }]}>
              <View style={[styles.passoNumero, { backgroundColor: cores.accent }]}>
                <Text style={styles.passoNumeroTexto}>1</Text>
              </View>
              <Text style={[styles.passoTexto, { color: cores.somNome }]}>
                Toque em <Text style={{ fontWeight: '900', color: cores.accent }}>“Abrir site”</Text> aqui embaixo — vai abrir o navegador no openrouter.ai
              </Text>
            </View>
            <View style={[styles.passo, { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda }]}>
              <View style={[styles.passoNumero, { backgroundColor: cores.accent }]}>
                <Text style={styles.passoNumeroTexto}>2</Text>
              </View>
              <Text style={[styles.passoTexto, { color: cores.somNome }]}>
                Toque em <Text style={{ fontWeight: '900', color: cores.accent }}>“Continue with Google”</Text> e entre com sua conta (a mesma do app)
              </Text>
            </View>
            <View style={[styles.passo, { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda }]}>
              <View style={[styles.passoNumero, { backgroundColor: cores.accent }]}>
                <Text style={styles.passoNumeroTexto}>3</Text>
              </View>
              <Text style={[styles.passoTexto, { color: cores.somNome }]}>
                Na página de chaves, toque em <Text style={{ fontWeight: '900', color: cores.accent }}>“+ Create Key”</Text> (deixe marcado “Free models”) e confirme
              </Text>
            </View>
            <View style={[styles.passo, { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda }]}>
              <View style={[styles.passoNumero, { backgroundColor: cores.accent }]}>
                <Text style={styles.passoNumeroTexto}>4</Text>
              </View>
              <Text style={[styles.passoTexto, { color: cores.somNome }]}>
                O site mostra a chave (começa com <Text style={{ fontWeight: '900', color: cores.accent }}>sk-or-v1-</Text>). Toque e segure nela → <Text style={{ fontWeight: '900', color: cores.accent }}>Copiar</Text>
              </Text>
            </View>
            <View style={[styles.passo, { backgroundColor: cores.somRowFundo, borderColor: cores.somRowBorda }]}>
              <View style={[styles.passoNumero, { backgroundColor: cores.accent }]}>
                <Text style={styles.passoNumeroTexto}>5</Text>
              </View>
              <Text style={[styles.passoTexto, { color: cores.somNome }]}>
                Volte ao app e <Text style={{ fontWeight: '900', color: cores.accent }}>cole no campo</Text> acima — segure o dedo no campo e toque em “Colar”
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.botaoEntendi, { backgroundColor: cores.accent }]}
              onPress={() => setTutorialIA(false)}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>Entendi!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Versão do App: 1.0.8</Text>
      </View>

      {/* SELETOR DE SOM DO ALARME (modal OLED) */}
      <Modal
        visible={somModalAberto}
        transparent
        animationType="slide"
        onRequestClose={fecharSomModal}
      >
        <View style={styles.modalFundo}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={fecharSomModal}
          />
          <View style={[styles.sheet, { backgroundColor: cores.sheetFundo, borderColor: cores.sheetBorda }]}>
            <View style={[styles.sheetHandle, { backgroundColor: cores.sheetHandle }]} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetTitulo, { color: cores.sheetTitulo }]}>Som do alarme</Text>
                <Text style={[styles.sheetSub, { color: cores.sheetSub }]}>
                  Toca no volume de alarme do celular, forçado ao máximo
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
                    <Text style={[styles.somNome, { color: cores.somNome }]}>{som.nome}</Text>
                    <Text style={[styles.somDesc, { color: cores.sheetSub }]}>{som.descricao}</Text>
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
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingTop: 70, paddingHorizontal: 20, paddingBottom: 60 },
  title: { fontSize: 34, fontWeight: '900', marginBottom: 30 },
  section: { marginBottom: 25 },
  sectionTitle: { color: '#888', fontSize: 12, textTransform: 'uppercase', marginBottom: 8, marginLeft: 10, letterSpacing: 1 },
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
  subText: { color: '#888', fontSize: 12, marginTop: 2 },
  footer: { marginTop: 30, marginBottom: 20, alignItems: 'center' },
  footerText: { color: '#888', fontSize: 14 },
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
});
