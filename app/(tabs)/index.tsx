import { Ionicons } from '@expo/vector-icons';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Directory, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { useListas } from '../../context/ListaContext';
import { useNotas } from '../../context/NotasContext';
import { useTheme } from '../../context/ThemeContext';
import RichText from '../../components/rich-text';
import AudioChip from '../../components/audio-chip';
import { appColors } from '../../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const limparHTML = (html: string) => {
  if (!html) return "";
  return html
    .replace(/<img[^>]*>/g, ' [Foto] ')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const DIR_IMAGENS = new Directory(Paths.document, 'imagens_notas');
const DIR_AUDIOS = new Directory(Paths.document, 'audios_notas');

// Extrai a primeira foto/áudio do conteúdo (marcador antigo ou tag <img>/<audio>)
const extrairAnexos = (conteudo?: string) => {
  const vazio = { imgUri: null as string | null, audioUri: null as string | null, audioNome: null as string | null };
  if (!conteudo) return vazio;
  const imgMarcador = conteudo.match(/\[Imagem anexada:\s*([^\]]+?)\s*\]/);
  const imgTag = conteudo.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/);
  const audMarcador = conteudo.match(/\[Áudio anexado:\s*([^\]]+?)\s*\]/);
  const audTag = conteudo.match(/<audio[^>]*src=["']([^"']+)["'][^>]*>/);
  if (imgMarcador) {
    const n = imgMarcador[1].trim();
    return { ...vazio, imgUri: n.startsWith('file://') ? n : `${DIR_IMAGENS.uri}/${n}` };
  }
  if (imgTag) return { ...vazio, imgUri: imgTag[1] };
  if (audMarcador) {
    const n = audMarcador[1].trim();
    return { ...vazio, audioUri: n.startsWith('file://') ? n : `${DIR_AUDIOS.uri}/${n}`, audioNome: n };
  }
  if (audTag) return { ...vazio, audioUri: audTag[1], audioNome: 'Áudio' };
  return vazio;
};

export default function HomeScreen() {
  const router = useRouter();
  const { 
    notas, 
    excluirNota, 
    restaurarBackupCloud, 
    fazerBackupCloud, 
    recarregarTudo,
    alternarFixarNota, 
    logout 
  } = useNotas(); 
  
  const { listas, excluirLista, alternarFixarLista } = useListas(); 
  const { isDark, config } = useTheme(); // AJUSTE: config adicionado
  
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [modalContaVisible, setModalContaVisible] = useState(false);
  const [modalAjudaVisible, setModalAjudaVisible] = useState(false);
  const [estaAbrindo, setEstaAbrindo] = useState(false);
  const [idAberto, setIdAberto] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  // Se a foto do Google falhar ao carregar, mostra a inicial do nome no avatar
  const [fotoFalhou, setFotoFalhou] = useState<string | null>(null);
  
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const animaMenu = useMemo(() => new Animated.Value(0), []);
  const animaBusca = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const checarUsuario = async () => {
      try {
        const currentUser = GoogleSignin.getCurrentUser();
        if (currentUser) setUser(currentUser.user);
      } catch (e) {
        console.warn("[Google] Falha ao verificar usuário atual", e);
      }
    };
    checarUsuario();
  }, []);

  useEffect(() => {
    if (user) {
      console.log("[Google] usuário conectado:", JSON.stringify({ name: user.name, email: user.email, photo: user.photo }));
    }
  }, [user]);

  useEffect(() => {
    const checarConexao = async () => {
      const status = await Network.getNetworkStateAsync();
      setIsOffline(!status.isConnected || !status.isInternetReachable);
    };
    checarConexao();
  }, [modalContaVisible]);

  useEffect(() => {
    const dispararBackup = async () => {
      if (user) {
        try {
          await GoogleSignin.signInSilently();
          await fazerBackupCloud();
        } catch (e) {
          console.log("Falha silenciosa no backup automático");
        }
      }
    };
    const timer = setTimeout(dispararBackup, 4000);
    return () => clearTimeout(timer);
  }, [user]);

  const paleta = appColors(isDark);
  const cores = {
    fundo: paleta.background,
    textoPrincipal: paleta.text,
    textoSecundario: paleta.muted,
    card: paleta.surface,
    searchBar: paleta.surface,
    placeholder: paleta.placeholder,
    borda: paleta.border,
    botaoAdd: paleta.primary,
    corIconeAdd: paleta.onPrimary,
    onPrimary: paleta.onPrimary,
    corLista: paleta.primary,
    fixar: paleta.warning,
    perigo: paleta.danger,
  };

  const notasFiltradas = useMemo(() => {
    const termoBusca = busca.toLowerCase();
    const nF = notas.filter((n: any) => {
      const titulo = (n.titulo || "").toLowerCase();
      const conteudoLimpo = limparHTML(n.conteudo).toLowerCase();
      return titulo.includes(termoBusca) || conteudoLimpo.includes(termoBusca);
    }).map((n: any) => ({ ...n, tipoItem: 'nota' }));

    const lF = listas.filter((l: any) => (l.titulo || "").toLowerCase().includes(termoBusca))
    .map((l: any) => ({ ...l, tipoItem: 'lista' }));

    return [...nF, ...lF].sort((a, b) => {
      if (a.fixada && !b.fixada) return -1;
      if (!a.fixada && b.fixada) return 1;
      return b.id.localeCompare(a.id);
    });
  }, [notas, listas, busca]);

  const toggleMenu = () => {
    const toValue = menuAberto ? 0 : 1;
    Animated.spring(animaMenu, { toValue, useNativeDriver: true, friction: 5, tension: 40 }).start();
    setMenuAberto(!menuAberto);
  };

  useEffect(() => {
    Animated.spring(animaBusca, {
      toValue: buscaAtiva ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 80,
    }).start();
  }, [buscaAtiva, animaBusca]);

  const handleTrocarConta = async () => {
    if (isOffline) {
      Alert.alert("Offline", "Você está offline. Conecte-se à internet para trocar de conta.");
      return;
    }
    try {
      setModalContaVisible(false);
      await GoogleSignin.signOut();
      setUser(null);
      const userInfo = await GoogleSignin.signIn();
      if (userInfo.type === 'cancelled') {
        // 'cancelled' DEPOIS de escolher a conta = falha silenciosa do servidor
        // (ex.: Tela de Consentimento OAuth não configurada no projeto, ou a
        // conta escolhida não está como usuário de teste). Não engolir o silêncio.
        console.warn("[Google] Sign-in cancelado após escolher a conta:", userInfo);
        Alert.alert(
          "Login",
          "O login não foi concluído.\n\nSe isso se repetir: no Google Cloud Console (projeto simple-notes-39893) → APIs e serviços → Tela de consentimento OAuth → configure e adicione sua conta como usuário de teste."
        );
        return;
      }
      if (userInfo.type !== 'success') {
        Alert.alert("Login", "Login não concluído. Tente novamente.");
        return;
      }
      setUser(userInfo.data.user);
      if (recarregarTudo) await recarregarTudo();
      await restaurarBackupCloud();
      // Sobe um backup logo após o login: garante que a chave de IA (e as notas)
      // digitadas ANTES de entrar cheguem à conta Google — não precisa repor.
      fazerBackupCloud().catch(() => {});
      Alert.alert("Sucesso", `Conectado como ${userInfo.data.user.name || userInfo.data.user.email}`);
    } catch (error: any) {
      // Mostra o erro real (ex.: "10: The caller has no permission" = SHA-1 não cadastrado no Firebase)
      console.error("[Google] Falha no login:", error);
      const msg = (error && (error.message || error.toString())) || "Não foi possível entrar com o Google.";
      const msgTexto = String(msg);
      const dica =
        msgTexto.includes('DEVELOPER_ERROR') || msgTexto.includes(': 10') || msgTexto.includes('statusCode')
          ? "\n\nDica: erro 10/DEVELOPER_ERROR = a assinatura do APK não está cadastrada no Firebase. Cadastre o SHA-1 do seu keystore em Configurações do projeto → App Android → Adicionar impressão digital."
          : "";
      Alert.alert("Falha no login", msgTexto + dica);
      try {
        const currentUser = await GoogleSignin.getCurrentUser();
        setUser(currentUser ? currentUser.user : null);
      } catch {
        setUser(null);
      }
    }
  };

  const handleLogout = async () => {
    Alert.alert("Sair", "Deseja realmente desconectar?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: async () => {
          setModalContaVisible(false);
          await logout();
          setUser(null);
      }}
    ]);
  };

  const navegarParaItem = async (item?: any) => {
    if (estaAbrindo) return;
    setEstaAbrindo(true);
    if (!item) {
        router.push('/editor'); 
    } else if (item.tipoItem === 'lista') {
        router.push({ pathname: '/editorL', params: { id: item.id } });
    } else {
        router.push({ pathname: '/editor', params: { id: item.id } });
    }
    setTimeout(() => setEstaAbrindo(false), 1000);
  };

  const handleExcluir = async (item: any) => {
    Alert.alert("Excluir", `Deseja apagar esta ${item.tipoItem === 'lista' ? 'lista' : 'nota'}?`, [
      { text: "Cancelar", style: "cancel", onPress: () => swipeableRefs.current.get(item.id)?.close() },
      { text: "Excluir", style: "destructive", onPress: () => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
          if (item.tipoItem === 'lista') excluirLista(item.id);
          else excluirNota(item.id);
      }}
    ]);
  };

  const handleFixar = (item: any) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    if (item.tipoItem === 'lista') alternarFixarLista(item.id);
    else alternarFixarNota(item.id);
    swipeableRefs.current.get(item.id)?.close();
  };

  const aoAbrirSwipe = (id: string) => {
    if (idAberto && idAberto !== id) swipeableRefs.current.get(idAberto)?.close();
    setIdAberto(id);
  };

  const renderLeftActions = (item: any) => (
    <TouchableOpacity style={[styles.botaoSwipe, { backgroundColor: cores.fixar }]} onPress={() => handleFixar(item)} activeOpacity={0.8}>
      <Ionicons name={item.fixada ? "pin-outline" : "pin"} size={28} color="#000" />
    </TouchableOpacity>
  );

  const renderRightActions = (item: any) => (
    <TouchableOpacity style={[styles.botaoSwipe, { backgroundColor: cores.perigo }]} onPress={() => handleExcluir(item)} activeOpacity={0.8}>
      <Ionicons name="trash-sharp" size={28} color={cores.onPrimary} />
    </TouchableOpacity>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: cores.fundo }]}>
        
        <View style={styles.header}>
          <View style={styles.topRow}>
            <View style={styles.headerTitleBlock}>
              <Text style={[styles.title, { color: cores.textoPrincipal }]}>Notas</Text>
              <Text style={[styles.headerSubtitle, { color: cores.textoSecundario }]}>
                {notasFiltradas.length === 0 ? 'Comece a organizar suas ideias' : `${notasFiltradas.length} itens salvos`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setModalContaVisible(true)} style={[styles.avatarBtn, { backgroundColor: user ? cores.botaoAdd : cores.searchBar, overflow: 'hidden' }]}>
              {user ? (
                user.photo && fotoFalhou !== user.photo ? (
                    <Image key={user.photo} source={{ uri: user.photo }} style={styles.avatarImg} onError={() => setFotoFalhou(user.photo)} />
                ) : (
                  <View style={styles.avatarInicial}>
                    <Text style={styles.avatarInicialText}>{(user.name || user.email || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                )
              ) : (
                <Ionicons name="person-circle-outline" size={42} color={cores.textoSecundario} />
              )}
            </TouchableOpacity>
          </View>

          <Animated.View
            style={[
              styles.searchBar,
              { backgroundColor: cores.searchBar },
              buscaAtiva && { borderColor: cores.botaoAdd, borderWidth: 1.5 },
              { transform: [{ scale: animaBusca.interpolate({ inputRange: [0, 1], outputRange: [1, 1.008] }) }] },
            ]}
          >
            <Ionicons name="search" size={20} color={buscaAtiva ? cores.botaoAdd : cores.placeholder} style={{ marginLeft: 15 }} />
            <TextInput 
              placeholder="Procurar em suas notas..." 
              placeholderTextColor={cores.placeholder}
              style={[styles.searchInput, { color: cores.textoPrincipal }]}
              value={busca}
              onFocus={() => setBuscaAtiva(true)}
              onBlur={() => setBuscaAtiva(false)}
              onChangeText={setBusca}
            />
            {busca.length > 0 && (
              <TouchableOpacity onPress={() => setBusca('')} style={styles.clearSearchButton} hitSlop={8}>
                <Ionicons name="close-circle" size={19} color={cores.placeholder} />
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} scrollEnabled={!estaAbrindo}>
          {notasFiltradas.length === 0 ? (
            <MotiView
              from={{ opacity: 0, scale: 0.9, translateY: 12 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 16, stiffness: 120 }}
              style={styles.emptyState}
            >
              <View style={[styles.emptyIconCircle, { backgroundColor: paleta.primarySoft }]}>
                <Ionicons name="pencil-outline" size={42} color={cores.botaoAdd} />
              </View>
              <Text style={[styles.emptyText, { color: cores.textoPrincipal }]}>Nenhuma nota encontrada</Text>
              <Text style={[styles.emptyHint, { color: cores.textoSecundario }]}>Toque no + para criar sua primeira nota</Text>
            </MotiView>
          ) : (
            notasFiltradas.map((item: any) => {
              const anexos = extrairAnexos(item.conteudo);
              return (
              <MotiView
                key={item.id}
                from={{ opacity: 0, translateY: 16, scale: 0.97 }}
                animate={{ opacity: estaAbrindo ? 0.7 : 1, translateY: 0, scale: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 150, delay: Math.min(notasFiltradas.indexOf(item) * 45, 240) }}
                style={[styles.cardContainer, { borderColor: cores.borda, borderWidth: 1 }]}
              >
                <Swipeable
                  ref={(ref) => { if (ref) swipeableRefs.current.set(item.id, ref); }}
                  onSwipeableWillOpen={() => aoAbrirSwipe(item.id)}
                  renderRightActions={() => renderRightActions(item)}
                  renderLeftActions={() => renderLeftActions(item)}
                  enabled={!estaAbrindo}
                >
                  <TouchableOpacity style={[styles.cardNota, { backgroundColor: cores.card }]} activeOpacity={0.9} onPress={() => navegarParaItem(item)}>
                    <View style={[styles.corLateral, { backgroundColor: item.tipoItem === 'lista' ? cores.corLista : cores.botaoAdd }]} />
                    <View style={styles.textosCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {item.fixada && <Ionicons name="pin" size={14} color={cores.fixar} style={{ marginRight: 6 }} />}
                        {item.lembrete && <Ionicons name="notifications" size={14} color={cores.botaoAdd} style={{ marginRight: 6 }} />}
                        <Text style={[styles.cardTitulo, { color: cores.textoPrincipal, flex: 1 }]} numberOfLines={1}>
                          {item.titulo || (item.tipoItem === 'lista' ? "Lista sem título" : "Nota sem título")}
                        </Text>
                      </View>
                      {item.tipoItem === 'lista' ? (
                        <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                          {`${item.itens ? item.itens.length : 0} itens na lista`}
                        </Text>
                      ) : (
                        <View>
                          {(anexos.imgUri || anexos.audioUri) && (
                            <View style={styles.linhaAnexo}>
                              {anexos.imgUri && (
                                <Image source={{ uri: anexos.imgUri }} style={styles.thumbAnexo} />
                              )}
                              {anexos.audioUri && (
                                <AudioChip uri={anexos.audioUri} nome={anexos.audioNome ?? undefined} />
                              )}
                            </View>
                          )}
                          <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                            {item.conteudo ? (
                              <RichText html={item.conteudo} />
                            ) : (
                              "Toque para editar..."
                            )}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name={item.tipoItem === 'lista' ? "list" : "chevron-forward"} size={20} color={cores.textoSecundario} />
                  </TouchableOpacity>
                </Swipeable>
              </MotiView>
              );
            })
          )}
        </ScrollView>

        {/* Modal de Conta */}
        <Modal visible={modalContaVisible} transparent animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalContaVisible(false)}>
            <View style={[styles.modalContent, { backgroundColor: cores.card }]}>
              <TouchableOpacity style={styles.helpTrigger} onPress={() => { setModalContaVisible(false); setModalAjudaVisible(true); }}>
                <Ionicons name="help-circle-outline" size={26} color={cores.botaoAdd} />
              </TouchableOpacity>

              {user ? (
                <View style={styles.userInfoSection}>
                   {user.photo && <Image source={{ uri: user.photo }} style={styles.modalAvatar} />}
                   <Text style={[styles.userName, { color: cores.textoPrincipal }]}>{user.name || "Usuário"}</Text>
                   <Text style={[styles.userEmail, { color: cores.textoSecundario }]}>{user.email}</Text>
                </View>
              ) : (
                <View style={styles.userInfoSection}>
                   <Ionicons name="cloud-offline-outline" size={50} color={cores.textoSecundario} />
                   <Text style={[styles.userName, { color: cores.textoPrincipal, marginTop: 10 }]}>Sem sincronização</Text>
                </View>
              )}
              <View style={[styles.separator, { backgroundColor: cores.borda }]} />
              <TouchableOpacity style={[styles.modalOption, { opacity: isOffline ? 0.5 : 1 }]} onPress={handleTrocarConta}>
                <Ionicons name={user ? "swap-horizontal-outline" : "log-in-outline"} size={24} color={cores.botaoAdd} />
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal }]}>{user ? "Trocar Conta" : "Entrar com Google"}</Text>
              </TouchableOpacity>
              {user && (
                <TouchableOpacity style={styles.modalOption} onPress={handleLogout}>
                  <Ionicons name="log-out-outline" size={24} color={cores.perigo} />
                  <Text style={[styles.modalOptionText, { color: cores.perigo }]}>Sair</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Modal de Ajuda */}
        <Modal visible={modalAjudaVisible} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: cores.card, width: '90%' }]}>
              <Text style={[styles.userName, { color: cores.textoPrincipal, textAlign: 'center', marginBottom: 20 }]}>Guia Rápido</Text>
              
              <View style={styles.helpItem}>
                <View style={[styles.helpIconCircle, { backgroundColor: cores.fixar }]}>
                  <Ionicons name="pin" size={20} color="#000" />
                </View>
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal, flex: 1 }]}>
                  Arraste para a <Text style={{fontWeight: '900'}}>Direita</Text> para fixar itens no topo.
                </Text>
              </View>

              <View style={styles.helpItem}>
                <View style={[styles.helpIconCircle, { backgroundColor: cores.perigo }]}>
                  <Ionicons name="trash" size={20} color={cores.onPrimary} />
                </View>
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal, flex: 1 }]}>
                  Arraste para a <Text style={{fontWeight: '900'}}>Esquerda</Text> para excluir uma nota.
                </Text>
              </View>

              <View style={styles.helpItem}>
                <View style={[styles.helpIconCircle, { backgroundColor: cores.botaoAdd }]}>
                  <Ionicons name="cloud-upload" size={20} color={cores.onPrimary} />
                </View>
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal, flex: 1 }]}>
                  Suas notas são salvas <Text style={{fontWeight: '900'}}>automaticamente</Text> na sua conta Google.
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.botaoEntendi, { backgroundColor: cores.botaoAdd }]} 
                onPress={() => setModalAjudaVisible(false)}
              >
                <Text style={{color: cores.onPrimary, fontWeight: 'bold', fontSize: 16}}>Entendi!</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* FAB Menu */}
        <Animated.View pointerEvents="none" style={[styles.fabBackdrop, { opacity: animaMenu }]} />
        <View style={styles.fabWrapper}>
          {/* AJUSTE: Botão de ajuda condicional à configuração */}
          {(config.exibirAjudaFAB !== false) && (
            <Animated.View style={[styles.miniBotaoWrap, { opacity: animaMenu, transform: [{ scale: animaMenu }, { translateY: animaMenu.interpolate({ inputRange: [0, 1], outputRange: [0, -215] }) }] }]}>
              <TouchableOpacity style={[styles.miniBotao, { backgroundColor: paleta.primarySoft }]} onPress={() => { toggleMenu(); setModalAjudaVisible(true); }}>
                <Ionicons name="help" size={26} color={paleta.primary} />
              </TouchableOpacity>
            </Animated.View>
          )}
          
          <Animated.View style={[styles.miniBotaoWrap, { opacity: animaMenu, transform: [{ scale: animaMenu }, { translateY: animaMenu.interpolate({ inputRange: [0, 1], outputRange: [0, -145] }) }] }]}>
            <TouchableOpacity style={[styles.miniBotao, { backgroundColor: cores.corLista }]} onPress={() => { toggleMenu(); router.push('/editorL'); }}>
              <Ionicons name="list" size={26} color={cores.onPrimary} />
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={[styles.miniBotaoWrap, { opacity: animaMenu, transform: [{ scale: animaMenu }, { translateY: animaMenu.interpolate({ inputRange: [0, 1], outputRange: [0, -75] }) }] }]}>
            <TouchableOpacity style={[styles.miniBotao, { backgroundColor: isDark ? paleta.onPrimary : cores.card, borderWidth: isDark ? 0 : 1, borderColor: cores.borda }]} onPress={() => { toggleMenu(); navegarParaItem(); }}>
              <Ionicons name="document-text" size={26} color={isDark ? paleta.background : cores.botaoAdd} />
            </TouchableOpacity>
          </Animated.View>
          <TouchableOpacity onPress={toggleMenu} style={[styles.botaoPrincipal, { backgroundColor: cores.botaoAdd, shadowColor: paleta.primary }]} activeOpacity={0.9}>
            <Animated.View style={{ transform: [{ rotate: animaMenu.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] }) }] }}>
              <Ionicons name="add" size={40} color={cores.corIconeAdd} />
            </Animated.View>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: cores.textoSecundario }]}>{notasFiltradas.length} itens salvos</Text>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 60, paddingHorizontal: 25, marginBottom: 10 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerTitleBlock: { flex: 1 },
  title: { fontSize: 38, fontWeight: '900', letterSpacing: -1.2 },
  headerSubtitle: { fontSize: 13, marginTop: 3, fontWeight: '600' },
  avatarBtn: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  avatarImg: { width: 46, height: 46, borderRadius: 23 },
  avatarInicial: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  avatarInicialText: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  searchBar: { height: 55, borderRadius: 18, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  searchInput: { flex: 1, fontSize: 17, paddingHorizontal: 15 },
  clearSearchButton: { paddingRight: 14 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 150 },
  cardContainer: { marginBottom: 15, borderRadius: 22, overflow: 'hidden' },
  cardNota: { padding: 20, flexDirection: 'row', alignItems: 'center', minHeight: 100 },
  corLateral: { width: 6, height: '100%', borderRadius: 10, marginRight: 15 },
  textosCard: { flex: 1 },
  cardTitulo: { fontSize: 20, fontWeight: 'bold', marginBottom: 5 },
  cardConteudo: { fontSize: 15, lineHeight: 20 },
  linhaAnexo: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  thumbAnexo: { width: 52, height: 52, borderRadius: 14, backgroundColor: '#E5E5EA' },
  botaoSwipe: { width: 90, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', marginTop: 92, paddingHorizontal: 24 },
  emptyIconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyText: { fontSize: 19, marginTop: 2, fontWeight: '800' },
  emptyHint: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  fabBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.42)', zIndex: 4 },
  fabWrapper: { position: 'absolute', bottom: 40, right: 30, alignItems: 'center', zIndex: 5 },
  botaoPrincipal: { 
    width: 70, height: 70, borderRadius: 35, 
    justifyContent: 'center', alignItems: 'center', elevation: 10,
    shadowOpacity: 0.42, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }
  },
  miniBotaoWrap: { position: 'absolute' },
  miniBotao: { width: 55, height: 55, borderRadius: 27.5, justifyContent: 'center', alignItems: 'center', elevation: 7, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', borderRadius: 30, padding: 25, elevation: 20 },
  userInfoSection: { alignItems: 'center', marginBottom: 10 },
  modalAvatar: { width: 70, height: 70, borderRadius: 35, marginBottom: 10 },
  userName: { fontSize: 20, fontWeight: 'bold' },
  userEmail: { fontSize: 14, marginTop: 2 },
  separator: { height: 1, width: '100%', marginVertical: 15 },
  modalOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15 },
  modalOptionText: { fontSize: 16, marginLeft: 15, fontWeight: '600' },
  footer: { position: 'absolute', bottom: 15, width: '100%', height: 30, justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.7 },
  helpTrigger: { position: 'absolute', top: 20, right: 20, padding: 5 },
  helpItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  helpIconCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  botaoEntendi: { width: '100%', height: 50, marginTop: 20, borderRadius: 15, justifyContent: 'center', alignItems: 'center' }
});