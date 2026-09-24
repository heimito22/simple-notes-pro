import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotas } from '../../context/NotasContext';
import { useListas } from '../../context/ListaContext';
import { useTheme } from '../../context/ThemeContext';
import { appColors } from '../../constants/theme';

const limparHTML = (html: string) => {
  if (!html) return '';
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

export default function PastaScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const pastaId = String(id || '');
  const { notas, pastas, renomearPasta, excluirPasta, moverNotasParaPasta, excluirNota, alternarFixarNota } = useNotas();
  const { listas, excluirLista, moverListasParaPasta, alternarFixarLista } = useListas();
  const { isDark, t } = useTheme();
  const insets = useSafeAreaInsets();

  const [renomeando, setRenomeando] = useState(false);
  const [nomeEditado, setNomeEditado] = useState('');
  const [selecionando, setSelecionando] = useState(false);
  const [idsSelecionados, setIdsSelecionados] = useState<string[]>([]);
  // FAB menu (Nova nota / Nova lista)
  const [fabAberto, setFabAberto] = useState(false);
  // Busca
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState(false);
  const animaBusca = useMemo(() => new Animated.Value(0), []);
  // Altura real do teclado (Android) — para o modal subir junto
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

  useEffect(() => {
    Animated.spring(animaBusca, {
      toValue: buscaAtiva ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 80,
    }).start();
  }, [buscaAtiva, animaBusca]);

  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const [idAberto, setIdAberto] = useState<string | null>(null);
  const animaFab = useMemo(() => new Animated.Value(0), []);


  const paleta = appColors(isDark);
  const cores = {
    fundo: paleta.background,
    textoPrincipal: paleta.text,
    textoSecundario: paleta.muted,
    card: paleta.surface,
    searchBar: paleta.surface,
    borda: paleta.border,
    botaoAdd: paleta.primary,
    onPrimary: paleta.onPrimary,
    perigo: paleta.danger,
    placeholder: paleta.placeholder,
    corLista: paleta.primary,
  };

  const pasta = pastas.find((p: any) => p.id === pastaId);

  const notasDaPastaAll = useMemo(
    () =>
      notas
        .filter((n: any) => n.pastaId === pastaId)
        .sort((a: any, b: any) => {
          if (a.fixada && !b.fixada) return -1;
          if (!a.fixada && b.fixada) return 1;
          return b.id.localeCompare(a.id);
        }),
    [notas, pastaId]
  );

  const listasDaPastaAll = useMemo(
    () => listas.filter((l: any) => l.pastaId === pastaId)
      .sort((a: any, b: any) => {
        if (a.fixada && !b.fixada) return -1;
        if (!a.fixada && b.fixada) return 1;
        return b.id.localeCompare(a.id);
      }),
    [listas, pastaId]
  );

  const termoBusca = busca.toLowerCase();
  const notasDaPasta = useMemo(
    () =>
      termoBusca
        ? notasDaPastaAll.filter((n: any) => {
            const titulo = (n.titulo || '').toLowerCase();
            const conteudoLimpo = limparHTML(n.conteudo || '').toLowerCase();
            return titulo.includes(termoBusca) || conteudoLimpo.includes(termoBusca);
          })
        : notasDaPastaAll,
    [notasDaPastaAll, termoBusca]
  );
  const listasDaPasta = useMemo(
    () =>
      termoBusca
        ? listasDaPastaAll.filter((l: any) => (l.titulo || '').toLowerCase().includes(termoBusca))
        : listasDaPastaAll,
    [listasDaPastaAll, termoBusca]
  );

  const totalItens = notasDaPastaAll.length + listasDaPastaAll.length;

  // --- Pasta: renomear / excluir ---
  const abrirRename = () => {
    setNomeEditado(pasta?.nome || '');
    setRenomeando(true);
  };

  const confirmarRename = () => {
    renomearPasta(pastaId, nomeEditado);
    setRenomeando(false);
  };

  const confirmarExcluir = () => {
    Alert.alert(
      t('Excluir pasta'),
      t('Excluir a pasta &quot;{nome}&quot;? As notas e listas dela voltam para a lista principal.', { nome: pasta?.nome }),
      [
        { text: t('Cancelar'), style: 'cancel' },
        {
          text: t('Excluir'),
          style: 'destructive',
          onPress: () => {
            if (listasDaPasta.length > 0) moverListasParaPasta(listasDaPasta.map((l: any) => l.id), null);
            excluirPasta(pastaId);
            router.back();
          },
        },
      ]
    );
  };

  // --- Seleção múltipla (entra apenas segurando numa nota ou lista) ---
  const entrarSelecao = (itemId: string) => {
    setSelecionando(true);
    setIdsSelecionados([itemId]);
  };
  const alternarSelecao = (itemId: string) => {
    setIdsSelecionados(prev => (prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]));
  };
  const sairSelecao = () => {
    setSelecionando(false);
    setIdsSelecionados([]);
  };
  // Back do celular (Android) sai do modo de seleção — em vez de voltar de tela.
  useEffect(() => {
    if (!selecionando) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sairSelecao();
      return true;
    });
    return () => sub.remove();
  }, [selecionando]);
  // Separa os ids selecionados em notas e listas (têm ids separados)
  const selecionadosSplit = () => {
    const notasSel = idsSelecionados.filter(id => notasDaPasta.some((n: any) => n.id === id));
    const listasSel = idsSelecionados.filter(id => listasDaPasta.some((l: any) => l.id === id));
    return { notas: notasSel, listas: listasSel };
  };
  const removerDaPasta = () => {
    const { notas: nIds, listas: lIds } = selecionadosSplit();
    if (nIds.length > 0) moverNotasParaPasta(nIds, null);
    if (lIds.length > 0) moverListasParaPasta(lIds, null);
    sairSelecao();
  };
  const fixarSelecionadas = () => {
    if (idsSelecionados.length === 0) return;
    const { notas: nIds, listas: lIds } = selecionadosSplit();
    nIds.forEach(id => alternarFixarNota(id));
    lIds.forEach(id => alternarFixarLista(id));
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
            const { notas: nIds, listas: lIds } = selecionadosSplit();
            nIds.forEach(id => excluirNota(id));
            lIds.forEach(id => excluirLista(id));
            sairSelecao();
          },
        },
      ]
    );
  };

  // --- Swipe das notas (MESMO comportamento da aba Notas: sem recorte) ---
  const aoAbrirSwipe = (notaId: string) => {
    if (idAberto && idAberto !== notaId) swipeableRefs.current.get(idAberto)?.close();
    setIdAberto(notaId);
  };
  const renderLeftActions = (nota: any) => (
    <TouchableOpacity
      style={[styles.botaoSwipe, { backgroundColor: paleta.warning }]}
      onPress={() => { alternarFixarNota(nota.id); swipeableRefs.current.get(nota.id)?.close(); }}
      activeOpacity={0.8}
    >
      <Ionicons name={nota.fixada ? 'pin-outline' : 'pin'} size={28} color="#000" />
    </TouchableOpacity>
  );
  const renderRightActions = (nota: any) => (
    <TouchableOpacity
      style={[styles.botaoSwipe, { backgroundColor: cores.perigo }]}
      onPress={() => {
        Alert.alert(t('Excluir'), t('Apagar a nota &quot;{titulo}&quot;?', { titulo: nota.titulo || t('sem título') }), [
          { text: t('Cancelar'), style: 'cancel', onPress: () => swipeableRefs.current.get(nota.id)?.close() },
          { text: t('Excluir'), style: 'destructive', onPress: () => excluirNota(nota.id) },
        ]);
      }}
      activeOpacity={0.8}
    >
      <Ionicons name="trash-sharp" size={28} color={cores.onPrimary} />
    </TouchableOpacity>
  );
  // Swipe das listas — MESMO comportamento da aba Notas (fixar/excluir)
  const renderLeftActionsLista = (l: any) => (
    <TouchableOpacity
      style={[styles.botaoSwipe, { backgroundColor: paleta.warning }]}
      onPress={() => { alternarFixarLista(l.id); swipeableRefs.current.get(l.id)?.close(); }}
      activeOpacity={0.8}
    >
      <Ionicons name={l.fixada ? 'pin-outline' : 'pin'} size={28} color="#000" />
    </TouchableOpacity>
  );
  const renderRightActionsLista = (l: any) => (
    <TouchableOpacity
      style={[styles.botaoSwipe, { backgroundColor: cores.perigo }]}
      onPress={() => {
        Alert.alert(t('Excluir'), t('Apagar a lista &quot;{titulo}&quot;?', { titulo: l.titulo || t('sem título') }), [
          { text: t('Cancelar'), style: 'cancel', onPress: () => swipeableRefs.current.get(l.id)?.close() },
          { text: t('Excluir'), style: 'destructive', onPress: () => excluirLista(l.id) },
        ]);
      }}
      activeOpacity={0.8}
    >
      <Ionicons name="trash-sharp" size={28} color={cores.onPrimary} />
    </TouchableOpacity>
  );

  // --- FAB menu ---
  const toggleFab = () => {
    const toValue = fabAberto ? 0 : 1;
    Animated.spring(animaFab, { toValue, useNativeDriver: true, friction: 6, tension: 60 }).start();
    setFabAberto(!fabAberto);
  };

  const exibirNotas = busca ? notasDaPasta : notasDaPasta;
  const exibirListas = busca ? listasDaPasta : listasDaPasta;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View testID="sn-screen-pasta" style={[styles.container, { backgroundColor: cores.fundo }]}>
        {/* Cabeçalho */}
        <View style={styles.header}>
          <View style={styles.topRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconeVoltar} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={28} color={cores.textoPrincipal} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginHorizontal: 10 }}>
              <Text style={[styles.titulo, { color: cores.textoPrincipal }]} numberOfLines={1}>
                {pasta?.nome || t('Pasta')}
              </Text>
              <Text style={[styles.subtitulo, { color: cores.textoSecundario }]}>
                {totalItens === 0
                  ? t('Pasta vazia')
                  : totalItens !== 1
                    ? t('{n} itens na pasta', { n: totalItens })
                    : t('{n} item na pasta', { n: totalItens })}
              </Text>
            </View>
            <TouchableOpacity onPress={abrirRename} style={styles.iconeAcao} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="pencil" size={21} color={cores.botaoAdd} />
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmarExcluir} style={styles.iconeAcao} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={21} color={cores.perigo} />
            </TouchableOpacity>
          </View>

          {/* Barra de busca — idêntica à aba principal */}
          {totalItens > 0 && (
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
                placeholder={t('Procurar nesta pasta...')}
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
          )}
        </View>

        {/* Conteúdo */}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {totalItens === 0 ? (
            <MotiView
              from={{ opacity: 0, scale: 0.9, translateY: 12 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 16, stiffness: 120 }}
              style={styles.emptyState}
            >
              <View style={[styles.emptyIconCircle, { backgroundColor: paleta.primarySoft }]}>
                <Ionicons name="folder-open-outline" size={40} color={cores.botaoAdd} />
              </View>
              <Text style={[styles.emptyText, { color: cores.textoPrincipal }]}>{t('Pasta vazia')}</Text>
              <Text style={[styles.emptyHint, { color: cores.textoSecundario }]}>
                {t('Toque no + para criar uma nota ou lista aqui dentro')}
              </Text>
            </MotiView>
          ) : (
            <>
              {exibirNotas.length > 0 && (
                <>
                  <Text style={[styles.secaoTitulo, { color: cores.textoSecundario }]}>{t('NOTAS')}</Text>
                  {exibirNotas.map((nota: any, i: number) => {
                    const selecionada = selecionando && idsSelecionados.includes(nota.id);
                    return (
                      <MotiView
                        key={nota.id}
                        from={{ opacity: 0, translateY: 16, scale: 0.97 }}
                        animate={{ opacity: 1, translateY: 0, scale: 1 }}
                        transition={{ type: 'spring', damping: 18, stiffness: 150, delay: Math.min(i * 45, 240) }}
                        style={[styles.cardContainer, { borderColor: cores.borda, borderWidth: 1 }]}
                      >
                        <Swipeable
                          ref={(ref) => { if (ref) swipeableRefs.current.set(nota.id, ref); }}
                          onSwipeableWillOpen={() => aoAbrirSwipe(nota.id)}
                          renderRightActions={() => renderRightActions(nota)}
                          renderLeftActions={() => renderLeftActions(nota)}
                          enabled={!selecionando}
                        >
                          <TouchableOpacity
                            style={[
                              styles.cardNota,
                              { backgroundColor: cores.card },
                              selecionando && {
    borderWidth: selecionada ? 2 : 0,
    borderColor: selecionada ? cores.botaoAdd : 'transparent',
    borderRadius: 22,
  },
                            ]}
                            onPress={() =>
                              selecionando
                                ? alternarSelecao(nota.id)
                                : router.push({ pathname: '/editor', params: { id: nota.id } })
                            }
                            onLongPress={() => { if (!selecionando) entrarSelecao(nota.id); }}
                            delayLongPress={260}
                            activeOpacity={0.9}
                          >
                            <View style={[styles.corLateral, { backgroundColor: cores.botaoAdd }]} />
                            <View style={styles.textosCard}>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {nota.fixada && <Ionicons name="pin" size={14} color={paleta.warning} style={{ marginRight: 6 }} />}
                                {nota.lembrete && <Ionicons name="notifications" size={14} color={cores.botaoAdd} style={{ marginRight: 6 }} />}
                                <Text style={[styles.cardTitulo, { color: cores.textoPrincipal, flex: 1 }]} numberOfLines={1}>
                                  {nota.titulo || t('Nota sem título')}
                                </Text>
                              </View>
                              <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                                {nota.conteudo ? limparHTML(nota.conteudo) : t('Toque para editar...')}
                              </Text>
                            </View>
                            {selecionando ? (
                              <View
                                style={[
                                  styles.checkSelecao,
                                  {
                                    backgroundColor: selecionada ? cores.botaoAdd : 'transparent',
                                    borderColor: selecionada ? cores.botaoAdd : cores.borda,
                                  },
                                ]}
                              >
                                {selecionada && <Ionicons name="checkmark" size={15} color={cores.onPrimary} />}
                              </View>
                            ) : (
                              <Ionicons name="chevron-forward" size={20} color={cores.textoSecundario} />
                            )}
                          </TouchableOpacity>
                        </Swipeable>
                      </MotiView>
                    );
                  })}
                </>
              )}

              {exibirListas.length > 0 && (
                <>
                  <Text style={[styles.secaoTitulo, { color: cores.textoSecundario, marginTop: exibirNotas.length > 0 ? 22 : 0 }]}>
                    {t('LISTAS')}
                  </Text>
                  {exibirListas.map((l: any, i: number) => {
                    const selecionada = selecionando && idsSelecionados.includes(l.id);
                    return (
                      <MotiView
                        key={l.id}
                        from={{ opacity: 0, translateY: 16, scale: 0.97 }}
                        animate={{ opacity: 1, translateY: 0, scale: 1 }}
                        transition={{ type: 'spring', damping: 18, stiffness: 150, delay: Math.min(i * 45, 240) }}
                        style={[styles.cardContainer, { borderColor: cores.borda, borderWidth: 1 }]}
                      >
                        <Swipeable
                          ref={(ref) => { if (ref) swipeableRefs.current.set(l.id, ref); }}
                          onSwipeableWillOpen={() => aoAbrirSwipe(l.id)}
                          renderRightActions={() => renderRightActionsLista(l)}
                          renderLeftActions={() => renderLeftActionsLista(l)}
                          enabled={!selecionando}
                        >
                          <TouchableOpacity
                            style={[
                              styles.cardNota,
                              { backgroundColor: cores.card },
                              selecionando && {
    borderWidth: selecionada ? 2 : 0,
    borderColor: selecionada ? cores.botaoAdd : 'transparent',
    borderRadius: 22,
  },
                            ]}
                            onPress={() =>
                              selecionando
                                ? alternarSelecao(l.id)
                                : router.push({ pathname: '/editorL', params: { id: l.id } })
                            }
                            onLongPress={() => { if (!selecionando) entrarSelecao(l.id); }}
                            delayLongPress={260}
                            activeOpacity={0.9}
                          >
                            <View style={[styles.corLateral, { backgroundColor: cores.corLista }]} />
                            <View style={styles.textosCard}>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {l.fixada && <Ionicons name="pin" size={14} color={paleta.warning} style={{ marginRight: 6 }} />}
                                <Text style={[styles.cardTitulo, { color: cores.textoPrincipal, flex: 1 }]} numberOfLines={1}>
                                  {l.titulo || t('Lista sem título')}
                                </Text>
                              </View>
                              <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                                {t('{n} itens na lista', { n: l.itens?.length || 0 })}
                              </Text>
                            </View>
                            {selecionando ? (
                              <View
                                style={[
                                  styles.checkSelecao,
                                  {
                                    backgroundColor: selecionada ? cores.botaoAdd : 'transparent',
                                    borderColor: selecionada ? cores.botaoAdd : cores.borda,
                                  },
                                ]}
                              >
                                {selecionada && <Ionicons name="checkmark" size={15} color={cores.onPrimary} />}
                              </View>
                            ) : (
                              <Ionicons name="list" size={20} color={cores.textoSecundario} />
                            )}
                          </TouchableOpacity>
                        </Swipeable>
                      </MotiView>
                    );
                  })}
                </>
              )}

              {/* Nenhum resultado para a busca */}
              {busca && exibirNotas.length === 0 && exibirListas.length === 0 && (
                <MotiView
                  from={{ opacity: 0, scale: 0.9, translateY: 12 }}
                  animate={{ opacity: 1, scale: 1, translateY: 0 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 120 }}
                  style={styles.emptyState}
                >
                  <View style={[styles.emptyIconCircle, { backgroundColor: paleta.primarySoft }]}>
                    <Ionicons name="search-outline" size={36} color={cores.botaoAdd} />
                  </View>
                  <Text style={[styles.emptyText, { color: cores.textoPrincipal }]}>{t('Nenhum resultado')}</Text>
                  <Text style={[styles.emptyHint, { color: cores.textoSecundario }]}>
                    {t('Nenhum item encontrado para &quot;{busca}&quot;', { busca })}
                  </Text>
                </MotiView>
              )}
            </>
          )}
        </ScrollView>

        {/* Barra de seleção: fixar / excluir / remover da pasta */}
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
              <TouchableOpacity style={[styles.barraSelecaoBotao, { backgroundColor: paleta.primarySoft }]} onPress={fixarSelecionadas} activeOpacity={0.8}>
                <Ionicons name="pin-outline" size={17} color={paleta.warning} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: paleta.warning }]}>{t('Fixar')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.barraSelecaoBotao, { backgroundColor: paleta.primarySoft }]} onPress={removerDaPasta} activeOpacity={0.8}>
                <Ionicons name="folder-open-outline" size={17} color={cores.botaoAdd} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.botaoAdd }]}>{t('Pasta')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.barraSelecaoBotao, { backgroundColor: paleta.dangerSoft }]} onPress={excluirSelecionadas} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={17} color={cores.perigo} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.perigo }]}>{t('Excluir')}</Text>
              </TouchableOpacity>
            </View>
          </MotiView>
        )}

        {/* FAB menu: Nova nota / Nova lista — só ícones, igual ao principal,
        com o backdrop escuro deslizando junto (fade suave) */}
        {!selecionando && <Animated.View pointerEvents="none" style={[styles.fabBackdrop, { opacity: animaFab }]} />}
        {!selecionando && (
          <View style={[styles.fabWrapper, { bottom: 30 + insets.bottom }]}>
            <Animated.View style={[styles.fabMiniWrap, { opacity: animaFab, transform: [{ scale: animaFab }, { translateY: animaFab.interpolate({ inputRange: [0, 1], outputRange: [0, -150] }) }] }]}>
              <TouchableOpacity
                style={[styles.fabMini, { backgroundColor: paleta.primarySoft }]}
                onPress={() => { toggleFab(); router.push({ pathname: '/editorL', params: { pastaId } }); }}
                activeOpacity={0.85}
              >
                <Ionicons name="list" size={26} color={cores.botaoAdd} />
              </TouchableOpacity>
            </Animated.View>
            <Animated.View style={[styles.fabMiniWrap, { opacity: animaFab, transform: [{ scale: animaFab }, { translateY: animaFab.interpolate({ inputRange: [0, 1], outputRange: [0, -75] }) }] }]}>
              <TouchableOpacity
                style={[styles.fabMini, { backgroundColor: cores.botaoAdd }]}
                onPress={() => { toggleFab(); router.push({ pathname: '/editor', params: { pastaId } }); }}
                activeOpacity={0.85}
              >
                <Ionicons name="document-text" size={26} color={cores.onPrimary} />
              </TouchableOpacity>
            </Animated.View>
            <TouchableOpacity onPress={toggleFab} style={[styles.fab, { backgroundColor: cores.botaoAdd, shadowColor: paleta.primary }]} activeOpacity={0.9}>
              <Animated.View style={{ transform: [{ rotate: animaFab.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '135deg'] }) }] }}>
                <Ionicons name="add" size={34} color={cores.onPrimary} />
              </Animated.View>
            </TouchableOpacity>
          </View>
        )}

        {/* Modal: renomear pasta (mesma subida/slide da aba da IA nas notas) */}
        <Modal visible={renomeando} transparent animationType="fade" onRequestClose={() => setRenomeando(false)}>
          <KeyboardAvoidingView style={styles.modalFundo} behavior="padding" enabled={Platform.OS === 'ios' ? true : alturaTeclado > 0}>
            <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setRenomeando(false)} />
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
                  <Text style={[styles.sheetTitulo, { color: cores.textoPrincipal }]}>{t('Renomear pasta')}</Text>
                  <Text style={[styles.sheetSub, { color: cores.textoSecundario }]}>{t('Dê um novo nome para esta pasta')}</Text>
                </View>
                <TouchableOpacity onPress={() => setRenomeando(false)} style={[styles.botaoFechar, { backgroundColor: paleta.surfaceElevated }]} activeOpacity={0.7}>
                  <Ionicons name="close" size={20} color={cores.textoPrincipal} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, { backgroundColor: paleta.surface, borderColor: cores.borda, color: cores.textoPrincipal }]}
                placeholder={t('Nome da pasta')}
                placeholderTextColor={cores.placeholder}
                value={nomeEditado}
                onChangeText={setNomeEditado}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={confirmarRename}
              />
              <TouchableOpacity
                style={[styles.botaoEntendi, { backgroundColor: cores.botaoAdd }]}
                onPress={confirmarRename}
                activeOpacity={0.85}
              >
                <Text style={{ color: cores.onPrimary, fontWeight: 'bold', fontSize: 16 }}>{t('Salvar')}</Text>
              </TouchableOpacity>
            </View>
            </MotiView>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 62, paddingHorizontal: 20, paddingBottom: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  iconeVoltar: { padding: 4 },
  iconeAcao: { padding: 6, marginLeft: 6 },
  titulo: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
  subtitulo: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  searchBar: { height: 55, borderRadius: 18, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent', marginTop: 12 },
  searchInput: { flex: 1, fontSize: 17, paddingHorizontal: 15 },
  clearSearchButton: { paddingRight: 14 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 150 },
  secaoTitulo: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 10, marginLeft: 4 },
  emptyState: { alignItems: 'center', marginTop: 100, paddingHorizontal: 24 },
  emptyIconCircle: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyText: { fontSize: 19, fontWeight: '800' },
  emptyHint: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  cardContainer: { marginBottom: 15, borderRadius: 22, overflow: 'hidden' },
  cardNota: { padding: 20, flexDirection: 'row', alignItems: 'center', minHeight: 100 },
  corLateral: { width: 6, height: '100%', borderRadius: 10, marginRight: 15 },
  textosCard: { flex: 1 },
  cardTitulo: { fontSize: 20, fontWeight: 'bold', marginBottom: 5 },
  cardConteudo: { fontSize: 15, lineHeight: 20 },
  botaoSwipe: { width: 90, justifyContent: 'center', alignItems: 'center' },
  checkSelecao: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
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
  fabBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.42)', zIndex: 6 },
  fabWrapper: { position: 'absolute', bottom: 30, right: 28, alignItems: 'center', zIndex: 7 },
  fab: {
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  fabMiniWrap: { position: 'absolute' },
  fabMini: {
    width: 55,
    height: 55,
    borderRadius: 27.5,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 7,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
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
  input: { height: 50, borderRadius: 15, borderWidth: 1, paddingHorizontal: 15, fontSize: 16, fontWeight: '600' },
  botaoEntendi: { width: '100%', height: 50, marginTop: 14, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
});
