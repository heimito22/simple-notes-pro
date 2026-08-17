import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { useNotas } from '../../context/NotasContext';
import { useListas } from '../../context/ListaContext';
import { useTheme } from '../../context/ThemeContext';
import { appColors } from '../../constants/theme';

const limparHTML = (html: string) => {
  if (!html) return '';
  return html
    .replace(/<img[^>]*>/g, ' [Foto] ')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export default function PastaScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const pastaId = String(id || '');
  const { notas, pastas, renomearPasta, excluirPasta, moverNotasParaPasta, excluirNota, alternarFixarNota } = useNotas();
  const { listas, excluirLista, moverListasParaPasta, alternarFixarLista } = useListas();
  const { isDark } = useTheme();

  const [renomeando, setRenomeando] = useState(false);
  const [nomeEditado, setNomeEditado] = useState('');
  const [selecionando, setSelecionando] = useState(false);
  const [idsSelecionados, setIdsSelecionados] = useState<string[]>([]);
  // FAB menu (Nova nota / Nova lista)
  const [fabAberto, setFabAberto] = useState(false);

  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const [idAberto, setIdAberto] = useState<string | null>(null);
  const animaFab = useMemo(() => new Animated.Value(0), []);


  const paleta = appColors(isDark);
  const cores = {
    fundo: paleta.background,
    textoPrincipal: paleta.text,
    textoSecundario: paleta.muted,
    card: paleta.surface,
    borda: paleta.border,
    botaoAdd: paleta.primary,
    onPrimary: paleta.onPrimary,
    perigo: paleta.danger,
    placeholder: paleta.placeholder,
    corLista: paleta.primary,
  };

  const pasta = pastas.find((p: any) => p.id === pastaId);

  const notasDaPasta = useMemo(
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

  const listasDaPasta = useMemo(
    () => listas.filter((l: any) => l.pastaId === pastaId),
    [listas, pastaId]
  );

  const totalItens = notasDaPasta.length + listasDaPasta.length;

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
    Alert.alert('Excluir pasta', `Excluir a pasta "${pasta?.nome}"? As notas e listas dela voltam para a lista principal.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          // Listas da pasta voltam para a lista principal (as notas já voltam
          // automaticamente no excluirPasta)
          if (listasDaPasta.length > 0) moverListasParaPasta(listasDaPasta.map((l: any) => l.id), null);
          excluirPasta(pastaId);
          router.back();
        },
      },
    ]);
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
      'Excluir itens',
      `Apagar ${qtd} ${qtd !== 1 ? 'itens' : 'item'} selecionado${qtd !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
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
        Alert.alert('Excluir', `Apagar a nota "${nota.titulo || 'sem título'}"?`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => swipeableRefs.current.get(nota.id)?.close() },
          { text: 'Excluir', style: 'destructive', onPress: () => excluirNota(nota.id) },
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
        Alert.alert('Excluir', `Apagar a lista "${l.titulo || 'sem título'}"?`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => swipeableRefs.current.get(l.id)?.close() },
          { text: 'Excluir', style: 'destructive', onPress: () => excluirLista(l.id) },
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: cores.fundo }]}>
        {/* Cabeçalho */}
        <View style={styles.header}>
          <View style={styles.topRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconeVoltar} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={28} color={cores.textoPrincipal} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginHorizontal: 10 }}>
              <Text style={[styles.titulo, { color: cores.textoPrincipal }]} numberOfLines={1}>
                {pasta?.nome || 'Pasta'}
              </Text>
              <Text style={[styles.subtitulo, { color: cores.textoSecundario }]}>
                {totalItens === 0
                  ? 'Pasta vazia'
                  : `${notasDaPasta.length} nota${notasDaPasta.length !== 1 ? 's' : ''} · ${listasDaPasta.length} lista${listasDaPasta.length !== 1 ? 's' : ''}`}
              </Text>
            </View>
            <TouchableOpacity onPress={abrirRename} style={styles.iconeAcao} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="pencil" size={21} color={cores.botaoAdd} />
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmarExcluir} style={styles.iconeAcao} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={21} color={cores.perigo} />
            </TouchableOpacity>
          </View>
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
              <Text style={[styles.emptyText, { color: cores.textoPrincipal }]}>Pasta vazia</Text>
              <Text style={[styles.emptyHint, { color: cores.textoSecundario }]}>
                Toque no + para criar uma nota ou lista aqui dentro
              </Text>
            </MotiView>
          ) : (
            <>
              {notasDaPasta.length > 0 && (
                <>
                  <Text style={[styles.secaoTitulo, { color: cores.textoSecundario }]}>NOTAS</Text>
                  {notasDaPasta.map((nota: any, i: number) => {
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
                              selecionada && { borderWidth: 2, borderColor: cores.botaoAdd },
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
                                  {nota.titulo || 'Nota sem título'}
                                </Text>
                              </View>
                              <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                                {nota.conteudo ? limparHTML(nota.conteudo) : 'Toque para editar...'}
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

              {listasDaPasta.length > 0 && (
                <>
                  <Text style={[styles.secaoTitulo, { color: cores.textoSecundario, marginTop: notasDaPasta.length > 0 ? 22 : 0 }]}>
                    LISTAS
                  </Text>
                  {listasDaPasta.map((l: any, i: number) => {
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
                              selecionada && { borderWidth: 2, borderColor: cores.botaoAdd },
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
                              <Text style={[styles.cardTitulo, { color: cores.textoPrincipal }]} numberOfLines={1}>
                                {l.titulo || 'Lista sem título'}
                              </Text>
                              <Text style={[styles.cardConteudo, { color: cores.textoSecundario }]} numberOfLines={2}>
                                {`${l.itens?.length || 0} itens na lista`}
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
                {idsSelecionados.length} selecionada{idsSelecionados.length !== 1 ? 's' : ''}
              </Text>
              <TouchableOpacity onPress={sairSelecao} style={styles.barraSelecaoFechar} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={cores.textoSecundario} />
              </TouchableOpacity>
            </View>
            <View style={styles.barraSelecaoBotoes}>
              <TouchableOpacity style={[styles.barraSelecaoBotao, { backgroundColor: paleta.primarySoft }]} onPress={fixarSelecionadas} activeOpacity={0.8}>
                <Ionicons name="pin-outline" size={17} color={paleta.warning} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: paleta.warning }]}>Fixar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.barraSelecaoBotao, { backgroundColor: paleta.primarySoft }]} onPress={removerDaPasta} activeOpacity={0.8}>
                <Ionicons name="folder-open-outline" size={17} color={cores.botaoAdd} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.botaoAdd }]}>Pasta</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.barraSelecaoBotao, { backgroundColor: paleta.dangerSoft }]} onPress={excluirSelecionadas} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={17} color={cores.perigo} />
                <Text style={[styles.barraSelecaoBotaoTexto, { color: cores.perigo }]}>Excluir</Text>
              </TouchableOpacity>
            </View>
          </MotiView>
        )}

        {/* FAB menu: Nova nota / Nova lista — só ícones, igual ao principal,
        com o backdrop escuro deslizando junto (fade suave) */}
        {!selecionando && <Animated.View pointerEvents="none" style={[styles.fabBackdrop, { opacity: animaFab }]} />}
        {!selecionando && (
          <View style={styles.fabWrapper}>
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
        <Modal visible={renomeando} transparent animationType="slide" onRequestClose={() => setRenomeando(false)}>
          <View style={styles.modalFundo}>
            <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setRenomeando(false)} />
            <View style={[styles.sheet, { backgroundColor: cores.fundo, borderColor: cores.borda }]}>
              <View style={[styles.sheetHandle, { backgroundColor: cores.borda }]} />
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitulo, { color: cores.textoPrincipal }]}>Renomear pasta</Text>
                  <Text style={[styles.sheetSub, { color: cores.textoSecundario }]}>Dê um novo nome para esta pasta</Text>
                </View>
                <TouchableOpacity onPress={() => setRenomeando(false)} style={[styles.botaoFechar, { backgroundColor: paleta.surfaceElevated }]} activeOpacity={0.7}>
                  <Ionicons name="close" size={20} color={cores.textoPrincipal} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, { backgroundColor: paleta.surface, borderColor: cores.borda, color: cores.textoPrincipal }]}
                placeholder="Nome da pasta"
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
                <Text style={{ color: cores.onPrimary, fontWeight: 'bold', fontSize: 16 }}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 150 },
  secaoTitulo: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 10, marginLeft: 4 },
  emptyState: { alignItems: 'center', marginTop: 100, paddingHorizontal: 24 },
  emptyIconCircle: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyText: { fontSize: 19, fontWeight: '800' },
  emptyHint: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  // Cards de nota — MESMOS estilos da aba Notas (o recorte do swipe vem do
  // container com overflow hidden; o card NÃO tem borda arredondada própria)
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
  // Barra de seleção
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
  // FAB — menu só com ícones, igual ao principal
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
  input: { height: 50, borderRadius: 15, borderWidth: 1, paddingHorizontal: 15, fontSize: 16, fontWeight: '600' },
  botaoEntendi: { width: '100%', height: 50, marginTop: 14, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
});
