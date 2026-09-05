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
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListas } from '../../context/ListaContext';
import { useMonetizacao } from '../../context/monetizacao';
import { useNotas } from '../../context/NotasContext';
import { useTheme } from '../../context/ThemeContext';
import RichText from '../../components/rich-text';
import AudioPlayer, { extrairAudios } from '../../components/audio-chip';
import { appColors } from '../../constants/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const limparHTML = (html: string) => {
  if (!html) return "";
  return html
    .replace(/<img[^>]*>/g, ' [Foto] ')
    .replace(/<[^>]*>?/gm, ' ')
    // Decodifica entidades HTML para o preview não mostrar "&#10;" etc.
    .replace(/&#10;|&#xA;|\n/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
};

// expo-file-system não é suportado na web (Directory lança erro no construtor)
const DIR_IMAGENS = Platform.OS === 'web' ? null : new Directory(Paths.document, 'imagens_notas');
const DIR_AUDIOS = Platform.OS === 'web' ? null : new Directory(Paths.document, 'audios_notas');

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
    return { ...vazio, imgUri: n.startsWith('file://') ? n : (DIR_IMAGENS ? `${DIR_IMAGENS.uri}/${n}` : n) };
  }
  if (imgTag) return { ...vazio, imgUri: imgTag[1] };
  if (audMarcador) {
    const n = audMarcador[1].trim();
    return { ...vazio, audioUri: n.startsWith('file://') ? n : (DIR_AUDIOS ? `${DIR_AUDIOS.uri}/${n}` : n), audioNome: n };
  }
  if (audTag) return { ...vazio, audioUri: audTag[1], audioNome: 'Áudio' };
  return vazio;
};

export default function HomeScreen() {
  const router = useRouter();
  const { 
    notas,
    pastas,
    criarPasta,
    moverNotasParaPasta,
    excluirNota, 
    restaurarBackupCloud, 
    fazerBackupCloud, 
    recarregarTudo,
    alternarFixarNota, 
    logout 
  } = useNotas(); 
  
  const { listas, excluirLista, alternarFixarLista, moverListasParaPasta } = useListas(); 
  const { isDark, config, t } = useTheme(); // AJUSTE: config adicionado
  const insets = useSafeAreaInsets();
  const { sincronizarPremiumConvite } = useMonetizacao();
  
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
  // --- Seleção múltipla de notas para mover para pastas ---
  const [selecionando, setSelecionando] = useState(false);
  const [idsSelecionados, setIdsSelecionados] = useState<string[]>([]);
  const [modalPastaAberto, setModalPastaAberto] = useState(false);
  const [modalNovaPastaAberto, setModalNovaPastaAberto] = useState(false);
  const [nomeNovaPasta, setNomeNovaPasta] = useState('');
  // Altura real do teclado (Android) — para o modal nova pasta subir junto
  const [alturaTeclado, setAlturaTeclado] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const ALTURA_MAX = 500;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const h = e.endCoordinates.height;
      if (h > 0 && h <= ALTURA_MAX) setAlturaTeclado(h);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setAlturaTeclado(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const animaMenu = useMemo(() => new Animated.Value(0), []);
  const animaBusca = useMemo(() => new Animated.Value(0), []);
  const abrirEscolherPasta = () => {
    setModalPastaAberto(true);
  };
  const abrirNovaPasta = () => {
    setNomeNovaPasta('');
    setModalNovaPastaAberto(true);
  };
  // Arraste lateral na linha de pastas com o mouse (web): o ScrollView
  // horizontal do react-native-web NÃO rola com arraste do mouse (só com
  // trackpad/roda), enquanto o swipe das notas funciona por usar Gesture
  // Handler. Aqui replicamos o mesmo gesto para as pastas.
  const pastasScrollRef = useRef<any>(null);
  const dragPastas = useRef({ ativo: false, inicioX: 0, inicioScroll: 0, arrastou: false });

  useEffect(() => {
    const checarUsuario = async () => {
      try {
        const currentUser = await GoogleSignin.getCurrentUser();
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
        } catch {
          console.log("Falha silenciosa no backup automático");
        }
      }
    };
    const timer = setTimeout(dispararBackup, 4000);
    return () => clearTimeout(timer);
  }, [user, fazerBackupCloud]);

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

  // Lista principal: notas SEM pasta (as pastas guardam as suas) + listas
  const notasFiltradas = useMemo(() => {
    const termoBusca = busca.toLowerCase();
    const nF = notas.filter((n: any) => {
      if (n.pastaId) return false;
      const titulo = (n.titulo || "").toLowerCase();
      const conteudoLimpo = limparHTML(n.conteudo).toLowerCase();
      return titulo.includes(termoBusca) || conteudoLimpo.includes(termoBusca);
    }).map((n: any) => ({ ...n, tipoItem: 'nota' }));

    const lF = listas.filter((l: any) => !l.pastaId && (l.titulo || "").toLowerCase().includes(termoBusca))
    .map((l: any) => ({ ...l, tipoItem: 'lista' }));

    return [...nF, ...lF].sort((a, b) => {
      if (a.fixada && !b.fixada) return -1;
      if (!a.fixada && b.fixada) return 1;
      return b.id.localeCompare(a.id);
    });
  }, [notas, listas, busca]);

  // Pastas com a contagem de itens (notas + listas) de cada uma
  const pastasComContagem = useMemo(() =>
    pastas.map((p: any) => ({
      ...p,
      contagem:
        notas.filter((n: any) => n.pastaId === p.id).length +
        listas.filter((l: any) => l.pastaId === p.id).length,
    })),
    [pastas, notas, listas]
  );

  // --- Ações de seleção ---
  const entrarSelecao = (id: string) => {
    setSelecionando(true);
    setIdsSelecionados([id]);
  };
  const alternarSelecao = (id: string) => {
    setIdsSelecionados(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };
  const sairSelecao = () => {
    setSelecionando(false);
    setIdsSelecionados([]);
  };
  // Back do celular (Android) sai do modo de seleção — sem sair da tela.
  useEffect(() => {
    if (!selecionando) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sairSelecao();
      return true;
    });
    return () => sub.remove();
  }, [selecionando]);
  // Divide os ids selecionados em notas e listas (têm ids separados)
  const selecionadosSplit = () => {
    const itens = notasFiltradas.filter(i => idsSelecionados.includes(i.id));
    return {
      notas: itens.filter(i => i.tipoItem === 'nota').map(i => i.id),
      listas: itens.filter(i => i.tipoItem === 'lista').map(i => i.id),
    };
  };

  const aplicarPasta = (pastaId: string | null) => {
    const { notas: nIds, listas: lIds } = selecionadosSplit();
    if (nIds.length > 0) moverNotasParaPasta(nIds, pastaId);
    if (lIds.length > 0) moverListasParaPasta(lIds, pastaId);
    setModalPastaAberto(false);
    sairSelecao();
  };
  const confirmarCriarPasta = () => {
    const id = criarPasta(nomeNovaPasta);
    // Se havia itens selecionados, coloca direto na pasta recém-criada
    const { notas: nIds, listas: lIds } = selecionadosSplit();
    if (nIds.length > 0) moverNotasParaPasta(nIds, id);
    if (lIds.length > 0) moverListasParaPasta(lIds, id);
    setNomeNovaPasta('');
    setModalNovaPastaAberto(false);
    sairSelecao();
  };

  const excluirSelecionadas = () => {
    if (idsSelecionados.length === 0) return;
    const qtd = idsSelecionados.length;
    Alert.alert(
      t('Excluir itens'),
      qtd !== 1
        ? t('Apagar {n} itens selecionados?', { n: qtd })
        : t('Apagar {n} item selecionado?', { n: qtd }),
      [
        { text: t('Cancelar'), style: 'cancel' },
        {
          text: t('Excluir'),
          style: 'destructive',
          onPress: () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
            const { notas: nIds, listas: lIds } = selecionadosSplit();
            nIds.forEach(id => excluirNota(id));
            lIds.forEach(id => excluirLista(id));
            sairSelecao();
          },
        },
      ]
    );
  };

  const toggleMenu = () => {
    const toValue = menuAberto ? 0 : 1;
    Animated.spring(animaMenu, { toValue, useNativeDriver: true, friction: 5, tension: 40 }).start();
    setMenuAberto(!menuAberto);
  };

  // --- Arraste das pastas (web): ---
  const pastaMouseDown = (e: any) => {
    const node = pastasScrollRef.current;
    if (!node) return;
    dragPastas.current = { ativo: true, inicioX: e.pageX, inicioScroll: node.scrollLeft, arrastou: false };
  };
  const pastaMouseMove = (e: any) => {
    const d = dragPastas.current;
    const node = pastasScrollRef.current;
    if (!d.ativo || !node) return;
    const dx = e.pageX - d.inicioX;
    if (Math.abs(dx) > 6) d.arrastou = true;
    e.preventDefault?.();
    node.scrollLeft = d.inicioScroll - dx;
  };
  const pastaMouseUp = () => {
    dragPastas.current.ativo = false;
    // Reseta o flag logo após o clique: o onPress dos chips lê `arrastou` no
    // instante do mouseup (para ignorar o clique que segue um arraste) e o
    // flag volta a false pouco depois, para o próximo clique simples funcionar
    // mesmo sem mousedown.
    setTimeout(() => { dragPastas.current.arrastou = false; }, 150);
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
      Alert.alert(t('Offline'), t('Você está offline. Conecte-se à internet para trocar de conta.'));
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
          t('Login'),
          t('O login não foi concluído.') + "\n\nSe isso se repetir: no Google Cloud Console (projeto simple-notes-39893) → APIs e serviços → Tela de consentimento OAuth → configure e adicione sua conta como usuário de teste."
        );
        // Deslogado após o signOut: o convite de premium não vale mais.
        sincronizarPremiumConvite(null).catch(() => {});
        return;
      }
      if (userInfo.type !== 'success') {
        Alert.alert(t('Login'), t('Login não concluído. Tente novamente.'));
        sincronizarPremiumConvite(null).catch(() => {});
        return;
      }
      setUser(userInfo.data.user);
      // O convite de premium só vale na conta logada: reavalia na hora.
      sincronizarPremiumConvite({ user: userInfo.data.user }).catch(() => {});
      if (recarregarTudo) await recarregarTudo();
      await restaurarBackupCloud();
      // Sobe um backup logo após o login: garante que a chave de IA (e as notas)
      // digitadas ANTES de entrar cheguem à conta Google — não precisa repor.
      fazerBackupCloud().catch(() => {});
      Alert.alert(t('Sucesso'), t('Conectado como {nome}', { nome: userInfo.data.user.name || userInfo.data.user.email }));
    } catch (error: any) {
      // Mostra o erro real (ex.: "10: The caller has no permission" = SHA-1 não cadastrado no Firebase)
      console.error("[Google] Falha no login:", error);
      const msg = (error && (error.message || error.toString())) || "Não foi possível entrar com o Google.";
      const msgTexto = String(msg);
      const dica =
        msgTexto.includes('DEVELOPER_ERROR') || msgTexto.includes(': 10') || msgTexto.includes('statusCode')
          ? "\n\nDica: erro 10/DEVELOPER_ERROR = a assinatura do APK não está cadastrada no Firebase. Cadastre o SHA-1 do seu keystore em Configurações do projeto → App Android → Adicionar impressão digital."
          : "";
      Alert.alert(t('Falha no login'), msgTexto + dica);
      try {
        const currentUser = await GoogleSignin.getCurrentUser();
        setUser(currentUser ? currentUser.user : null);
        // Reavalia o convite com o usuário real pós-falha (null se deslogado).
        sincronizarPremiumConvite(currentUser ? { user: currentUser.user } : null).catch(() => {});
      } catch {
        setUser(null);
        sincronizarPremiumConvite(null).catch(() => {});
      }
    }
  };

  const handleLogout = async () => {
    Alert.alert(t('Sair'), t('Deseja realmente desconectar?'), [
      { text: t('Cancelar'), style: "cancel" },
      { text: t('Sair'), style: "destructive", onPress: async () => {
          setModalContaVisible(false);
          await logout();
          setUser(null);
          // Sem conta logada o convite de premium não vale: revoga na hora.
          sincronizarPremiumConvite(null).catch(() => {});
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
    Alert.alert(
      t('Excluir'),
      item.tipoItem === 'lista' ? t('Deseja apagar esta lista?') : t('Deseja apagar esta nota?'),
      [
      { text: t('Cancelar'), style: "cancel", onPress: () => swipeableRefs.current.get(item.id)?.close() },
      { text: t('Excluir'), style: "destructive", onPress: () => {
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
              <Text style={[styles.title, { color: cores.textoPrincipal }]}>{t('Notas')}</Text>
              <Text style={[styles.headerSubtitle, { color: cores.textoSecundario }]}>
                {notasFiltradas.length === 0 ? t('Comece a organizar suas ideias') : t('{n} itens salvos', { n: notasFiltradas.length })}
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
              placeholder={t('Procurar em suas notas...')} 
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

        {/* Pastas: chips horizontais — toque abre a pasta; "+" Nova pasta sempre
        visível no início da linha (não precisa rolar para criar) */}
        <ScrollView
          horizontal
          ref={pastasScrollRef}
          showsHorizontalScrollIndicator={false}
          style={styles.pastasRow}
          contentContainerStyle={styles.pastasRowContent}
          {...(Platform.OS === 'web'
            ? {
                onMouseDown: pastaMouseDown,
                onMouseMove: pastaMouseMove,
                onMouseUp: pastaMouseUp,
                onMouseLeave: pastaMouseUp,
              }
            : {})}
        >
          <TouchableOpacity
            style={[styles.chipPasta, { backgroundColor: paleta.primarySoft, borderColor: cores.botaoAdd }]}
            onPress={() => { if (dragPastas.current.arrastou) { dragPastas.current.arrastou = false; return; } abrirNovaPasta(); }}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={17} color={cores.botaoAdd} />
            <Text style={[styles.chipPastaNome, { color: cores.botaoAdd }]}>{t('Nova pasta')}</Text>
          </TouchableOpacity>
          {pastasComContagem.map((p: any, i: number) => (
            <MotiView
              key={p.id}
              from={{ opacity: 0, scale: 0.8, translateX: -8 }}
              animate={{ opacity: 1, scale: 1, translateX: 0 }}
              transition={{ type: 'spring', damping: 15, stiffness: 170, delay: Math.min((i + 1) * 55, 220) }}
            >
              <TouchableOpacity
                style={[styles.chipPasta, { backgroundColor: cores.card, borderColor: cores.borda }]}
                onPress={() => { if (dragPastas.current.arrastou) { dragPastas.current.arrastou = false; return; } router.push({ pathname: '/pasta/[id]', params: { id: p.id } }); }}
                activeOpacity={0.8}
              >
                <Ionicons name="folder" size={17} color={cores.botaoAdd} />
                <Text style={[styles.chipPastaNome, { color: cores.textoPrincipal }]} numberOfLines={1}>{p.nome}</Text>
                <View style={[styles.chipPastaContagem, { backgroundColor: paleta.primarySoft }]}>
                  <Text style={[styles.chipPastaContagemTexto, { color: cores.botaoAdd }]}>{p.contagem}</Text>
                </View>
              </TouchableOpacity>
            </MotiView>
          ))}
        </ScrollView>

        <ScrollView style={styles.listaScroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} scrollEnabled={!estaAbrindo}>
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
              <Text style={[styles.emptyText, { color: cores.textoPrincipal }]}>{t('Nenhuma nota encontrada')}</Text>
              <Text style={[styles.emptyHint, { color: cores.textoSecundario }]}>{t('Toque no + para criar sua primeira nota')}</Text>
            </MotiView>
          ) : (
            notasFiltradas.map((item: any) => {
              const anexos = extrairAnexos(item.conteudo);
              const audios = extrairAudios(item.conteudo || '', DIR_AUDIOS?.uri);
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
                  enabled={!estaAbrindo && !selecionando}
                >
                  <TouchableOpacity
                    style={[
                      styles.cardNota,
                      { backgroundColor: cores.card },
                      selecionando && {
    borderWidth: idsSelecionados.includes(item.id) ? 2 : 0,
    borderColor: idsSelecionados.includes(item.id) ? cores.botaoAdd : 'transparent',
    borderRadius: 22,
  },
                    ]}
                    onPress={() => {
                      if (selecionando) {
                        alternarSelecao(item.id);
                      } else {
                        navegarParaItem(item);
                      }
                    }}
                    onLongPress={() => { if (!selecionando) entrarSelecao(item.id); }}
                    delayLongPress={260}
                    activeOpacity={0.9}
                  >
                    <View style={[styles.corLateral, { backgroundColor: item.tipoItem === 'lista' ? cores.corLista : cores.botaoAdd }]} />
                    <View style={styles.textosCard}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {item.fixada && <Ionicons name="pin" size={14} color={cores.fixar} style={{ marginRight: 6 }} />}
                        {item.lembrete && <Ionicons name="notifications" size={14} color={cores.botaoAdd} style={{ marginRight: 6 }} />}
                        <Text style={[styles.cardTitulo, { color: cores.textoPrincipal, flex: 1 }]} numberOfLines={1}>
                          {item.titulo || (item.tipoItem === 'lista' ? t('Lista sem título') : t('Nota sem título'))}
                        </Text>
                      </View>
                      {item.tipoItem === 'lista' ? (
                        <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                          {t('{n} itens na lista', { n: item.itens ? item.itens.length : 0 })}
                        </Text>
                      ) : (
                        <View>
                          {anexos.imgUri && (
                            <View style={styles.linhaAnexo}>
                              <Image source={{ uri: anexos.imgUri }} style={styles.thumbAnexo} />
                            </View>
                          )}
                          {audios[0] && (
                            <AudioPlayer
                              compact
                              uri={audios[0].uri}
                              nome={audios[0].nome}
                            />
                          )}
                          <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                            {item.conteudo ? (
                              <RichText html={item.conteudo} />
                            ) : (
                              t('Toque para editar...')
                            )}
                          </Text>
                        </View>
                      )}
                    </View>
                    {selecionando ? (
                      <View
                        style={[
                          styles.checkSelecao,
                          {
                            backgroundColor: idsSelecionados.includes(item.id) ? cores.botaoAdd : 'transparent',
                            borderColor: idsSelecionados.includes(item.id) ? cores.botaoAdd : cores.borda,
                          },
                        ]}
                      >
                        {idsSelecionados.includes(item.id) && <Ionicons name="checkmark" size={15} color={cores.onPrimary} />}
                      </View>
                    ) : (
                      <Ionicons name={item.tipoItem === 'lista' ? "list" : "chevron-forward"} size={20} color={cores.textoSecundario} />
                    )}
                  </TouchableOpacity>
                </Swipeable>
              </MotiView>
              );
            })
          )}
          {notasFiltradas.length > 0 && !selecionando && (
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: cores.textoSecundario }]}>
                {notasFiltradas.length} {notasFiltradas.length !== 1 ? t('itens salvos') : t('item salvo')}
              </Text>
            </View>
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
                   <Text style={[styles.userName, { color: cores.textoPrincipal }]}>{user.name || t('Usuário')}</Text>
                   <Text style={[styles.userEmail, { color: cores.textoSecundario }]}>{user.email}</Text>
                </View>
              ) : (
                <View style={styles.userInfoSection}>
                   <Ionicons name="cloud-offline-outline" size={50} color={cores.textoSecundario} />
                   <Text style={[styles.userName, { color: cores.textoPrincipal, marginTop: 10 }]}>{t('Sem sincronização')}</Text>
                </View>
              )}
              <View style={[styles.separator, { backgroundColor: cores.borda }]} />
              <TouchableOpacity style={[styles.modalOption, { opacity: isOffline ? 0.5 : 1 }]} onPress={handleTrocarConta}>
                <Ionicons name={user ? "swap-horizontal-outline" : "log-in-outline"} size={24} color={cores.botaoAdd} />
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal }]}>{user ? t('Trocar Conta') : t('Entrar com Google')}</Text>
              </TouchableOpacity>
              {user && (
                <TouchableOpacity style={styles.modalOption} onPress={handleLogout}>
                  <Ionicons name="log-out-outline" size={24} color={cores.perigo} />
                  <Text style={[styles.modalOptionText, { color: cores.perigo }]}>{t('Sair')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Modal de Ajuda */}
        <Modal visible={modalAjudaVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: cores.card, width: '90%' }]}>
              <Text style={[styles.userName, { color: cores.textoPrincipal, textAlign: 'center', marginBottom: 20 }]}>{t('Guia Rápido')}</Text>
              
              <View style={styles.helpItem}>
                <View style={[styles.helpIconCircle, { backgroundColor: cores.fixar }]}>
                  <Ionicons name="pin" size={20} color="#000" />
                </View>
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal, flex: 1 }]}>
                  {t('Arraste para a')} <Text style={{fontWeight: '900'}}>{t('Direita')}</Text> {t('para fixar itens no topo')}.
                </Text>
              </View>

              <View style={styles.helpItem}>
                <View style={[styles.helpIconCircle, { backgroundColor: cores.perigo }]}>
                  <Ionicons name="trash" size={20} color={cores.onPrimary} />
                </View>
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal, flex: 1 }]}>
                  {t('Arraste para a')} <Text style={{fontWeight: '900'}}>{t('Esquerda')}</Text> {t('para excluir uma nota')}.
                </Text>
              </View>

              <View style={styles.helpItem}>
                <View style={[styles.helpIconCircle, { backgroundColor: cores.botaoAdd }]}>
                  <Ionicons name="cloud-upload" size={20} color={cores.onPrimary} />
                </View>
                <Text style={[styles.modalOptionText, { color: cores.textoPrincipal, flex: 1 }]}>
                  {t('Suas notas são salvas')} <Text style={{fontWeight: '900'}}>{t('automaticamente')}</Text> {t('na sua conta Google')}.
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.botaoEntendi, { backgroundColor: cores.botaoAdd }]} 
                onPress={() => setModalAjudaVisible(false)}
              >
                <Text style={{color: cores.onPrimary, fontWeight: 'bold', fontSize: 16}}>{t('Entendi!')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Barra de seleção múltipla */}
        {selecionando && (
          <MotiView
            from={{ opacity: 0, translateY: 46 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 190 }}
            style={[styles.barraSelecao, { backgroundColor: cores.card, borderColor: cores.borda }]}
          >
            <View style={styles.barraSelecaoTopo}>
              <Text style={[styles.barraSelecaoContagem, { color: cores.textoPrincipal }]}>
                {idsSelecionados.length !== 1
                  ? t('{n} selecionadas', { n: idsSelecionados.length })
                  : t('{n} selecionada', { n: idsSelecionados.length })}
              </Text>
              <TouchableOpacity onPress={sairSelecao} style={styles.barraSelecaoFechar} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <View style={styles.barraSelecaoBotoes}>
              <TouchableOpacity
                style={[styles.barraSelecaoBotao, { backgroundColor: paleta.primarySoft }]}
                onPress={abrirEscolherPasta}
                activeOpacity={0.8}
              >
                <Ionicons name="folder-open-outline" size={17} color={cores.botaoAdd} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.botaoAdd }]}>{t('Pasta')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.barraSelecaoBotao, { backgroundColor: paleta.primarySoft }]}
                onPress={abrirNovaPasta}
                activeOpacity={0.8}
              >
                <Ionicons name="create-outline" size={17} color={cores.botaoAdd} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.botaoAdd }]}>{t('Criar')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.barraSelecaoBotao, { backgroundColor: paleta.dangerSoft }]}
                onPress={excluirSelecionadas}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={17} color={cores.perigo} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.perigo }]}>{t('Excluir')}</Text>
              </TouchableOpacity>
            </View>
          </MotiView>
        )}

        {/* Modal: escolher pasta (mesma subida/slide da aba da IA nas notas) */}
        <Modal visible={modalPastaAberto} transparent animationType="fade" onRequestClose={() => setModalPastaAberto(false)}>
          <View style={styles.modalFundo}>
            <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setModalPastaAberto(false)} />
            {/* Fundo escuro faz fade (Modal fade); o painel sobe sozinho com mola. */}
            <MotiView
              from={{ opacity: 0, translateY: 520 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 230 }}
            >
            <View style={[styles.sheet, { backgroundColor: cores.fundo, borderColor: cores.borda, paddingBottom: 40 + insets.bottom }]}>
              <View style={[styles.sheetHandle, { backgroundColor: cores.borda }]} />
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitulo, { color: cores.textoPrincipal }]}>{t('Mover para pasta')}</Text>
                  <Text style={[styles.sheetSub, { color: cores.textoSecundario }]}>
                    {idsSelecionados.length} {idsSelecionados.length !== 1 ? t('itens selecionados') : t('item selecionado')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setModalPastaAberto(false)} style={[styles.botaoFechar, { backgroundColor: paleta.surfaceElevated }]} activeOpacity={0.7}>
                  <Ionicons name="close" size={20} color={cores.textoPrincipal} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.pastaRow, { backgroundColor: paleta.surface, borderColor: cores.borda }]}
                onPress={() => { setModalPastaAberto(false); abrirNovaPasta(); }}
                activeOpacity={0.7}
              >
                <View style={[styles.pastaRowIcone, { backgroundColor: paleta.primarySoft }]}>
                  <Ionicons name="add" size={20} color={cores.botaoAdd} />
                </View>
                <Text style={[styles.pastaRowNome, { color: cores.textoPrincipal }]}>{t('Criar nova pasta...')}</Text>
              </TouchableOpacity>
              {pastasComContagem.length === 0 ? (
                <Text style={[styles.sheetSub, { color: cores.textoSecundario, textAlign: 'center', marginVertical: 10 }]}>
                  {t('Nenhuma pasta ainda — crie a primeira!')}
                </Text>
              ) : (
                pastasComContagem.map((p: any) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pastaRow, { backgroundColor: paleta.surface, borderColor: cores.borda }]}
                    onPress={() => aplicarPasta(p.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.pastaRowIcone, { backgroundColor: paleta.primarySoft }]}>
                      <Ionicons name="folder" size={20} color={cores.botaoAdd} />
                    </View>
                    <Text style={[styles.pastaRowNome, { color: cores.textoPrincipal, flex: 1 }]} numberOfLines={1}>
                      {p.nome}
                    </Text>
                    <Text style={{ color: cores.textoSecundario, fontSize: 13, fontWeight: '700' }}>{p.contagem}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
            </MotiView>
          </View>
        </Modal>

        {/* Modal: criar pasta (mesma subida/slide da aba da IA nas notas) */}
        <Modal visible={modalNovaPastaAberto} transparent animationType="fade" onRequestClose={() => setModalNovaPastaAberto(false)}>
          <KeyboardAvoidingView style={styles.modalFundo} behavior="padding" enabled={Platform.OS === 'ios' ? true : alturaTeclado > 0}>
            <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setModalNovaPastaAberto(false)} />
            {/* Fundo escuro faz fade (Modal fade); o painel sobe sozinho com mola. */}
            <MotiView
              from={{ opacity: 0, translateY: 520 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 230 }}
            >
            <View style={[styles.sheet, { backgroundColor: cores.fundo, borderColor: cores.borda, paddingBottom: 40 + insets.bottom }]}>
              <View style={[styles.sheetHandle, { backgroundColor: cores.borda }]} />
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitulo, { color: cores.textoPrincipal }]}>{t('Nova pasta')}</Text>
                  <Text style={[styles.sheetSub, { color: cores.textoSecundario }]}>
                    {idsSelecionados.length > 0
                      ? t('Leva os {n} para dentro', { n: `${idsSelecionados.length} ${idsSelecionados.length !== 1 ? t('itens selecionados') : t('item selecionado')}` })
                      : t('Organize suas notas e listas em pastas')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setModalNovaPastaAberto(false)} style={[styles.botaoFechar, { backgroundColor: paleta.surfaceElevated }]} activeOpacity={0.7}>
                  <Ionicons name="close" size={20} color={cores.textoPrincipal} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[
                  styles.inputNovaPasta,
                  { backgroundColor: paleta.surface, borderColor: cores.borda, color: cores.textoPrincipal },
                ]}
                placeholder={t('Nome da pasta')}
                placeholderTextColor={cores.placeholder}
                value={nomeNovaPasta}
                onChangeText={setNomeNovaPasta}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={confirmarCriarPasta}
              />
              <TouchableOpacity
                style={[styles.botaoEntendi, { backgroundColor: cores.botaoAdd }]}
                onPress={confirmarCriarPasta}
                activeOpacity={0.85}
              >
                <Text style={{ color: cores.onPrimary, fontWeight: 'bold', fontSize: 16 }}>{t('Criar pasta')}</Text>
              </TouchableOpacity>
            </View>
            </MotiView>
          </KeyboardAvoidingView>
        </Modal>

        {/* FAB Menu (escondido no modo de seleção para não sobrepor a barra) */}
        {!selecionando && <Animated.View pointerEvents="none" style={[styles.fabBackdrop, { opacity: animaMenu }]} />}
        {!selecionando && (
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
        )}

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
  footer: { paddingVertical: 22, alignItems: 'center', justifyContent: 'center' },
  footerText: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.7 },
  helpTrigger: { position: 'absolute', top: 20, right: 20, padding: 5 },
  helpItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  helpIconCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  botaoEntendi: { width: '100%', height: 50, marginTop: 20, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  // Pastas — linha própria entre o cabeçalho e a lista. Altura fixa e SEM
  // encolher no flex (flexGrow/flexShrink 0): sem isso o ScrollView das notas
  // encolhia a linha para ~28px e cortava os chips verticalmente.
  pastasRow: { height: 48, marginTop: 2, marginBottom: 12, flexGrow: 0, flexShrink: 0 },
  // Lista de notas: ocupa exatamente o espaço restante (flexBasis 0) para não
  // estourar o flex e nem cortar as notas.
  listaScroll: { flex: 1 },
  pastasRowContent: { paddingHorizontal: 20, gap: 10, alignItems: 'center' },
  chipPasta: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 13,
    gap: 7,
    maxWidth: 190,
  },
  chipPastaNome: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  chipPastaContagem: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  chipPastaContagemTexto: { fontSize: 12, fontWeight: '900' },
  // Seleção múltipla
  checkSelecao: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    marginRight: 2,
  },
  barraSelecao: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    borderRadius: 22,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    zIndex: 8,
  },
  barraSelecaoTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 2 },
  barraSelecaoContagem: { fontSize: 13, fontWeight: '800' },
  barraSelecaoBotoes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barraSelecaoBotao: { flex: 1, height: 40, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  barraSelecaoBotaoTexto: { fontSize: 13, fontWeight: '800' },
  barraSelecaoFechar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inputNovaPasta: {
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 15,
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal bottom sheet — mesmo visual dos modais originais do app (settings)
  modalFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalDismiss: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingBottom: 40,
    paddingTop: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  sheetHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sheetTitulo: { fontSize: 21, fontWeight: '800' },
  sheetSub: { fontSize: 12.5, marginTop: 4 },
  botaoFechar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  pastaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  pastaRowIcone: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pastaRowNome: { fontSize: 16, fontWeight: '700', marginLeft: 12 },
});
