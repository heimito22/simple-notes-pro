import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appColors } from '../constants/theme';
import { ItemLista, useListas } from '../context/ListaContext';
import { useTheme } from '../context/ThemeContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const criarIdItem = () => Date.now().toString();

const layoutAnimConfig = {
  duration: 300,
  update: { type: LayoutAnimation.Types.spring, springDamping: 0.7 },
  delete: { type: LayoutAnimation.Types.linear, property: LayoutAnimation.Properties.opacity },
};

export default function EditorL() {
  const { id, pastaId } = useLocalSearchParams();
  const router = useRouter();
  const { isDark, t } = useTheme();
  const insets = useSafeAreaInsets();
  const { listas, salvarLista } = useListas();

  const [titulo, setTitulo] = useState('');
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [novoItem, setNovoItem] = useState('');

  const [animacaoBotao] = useState(() => new Animated.Value(1));
  const [animacaoRotacao] = useState(() => new Animated.Value(0));

  const paleta = appColors(isDark);
  const cores = {
    fundo: paleta.background,
    texto: paleta.text,
    subtexto: paleta.muted,
    card: paleta.surface,
    cardElevated: paleta.surfaceElevated,
    borda: paleta.border,
    primaria: paleta.primary,
    primariaForte: paleta.primaryStrong,
    primariaSoft: paleta.primarySoft,
    sucesso: paleta.success,
    erro: paleta.danger,
  };

  const listaExistente = useMemo(
    () => (id ? listas.find(l => l.id === id) : undefined),
    [id, listas]
  );
  const concluidos = itens.filter(item => item.concluido).length;
  const progresso = itens.length > 0 ? concluidos / itens.length : 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (listaExistente) {
        setTitulo(listaExistente.titulo);
        setItens(listaExistente.itens);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [listaExistente]);

  const adicionarItem = () => {
    if (!novoItem.trim()) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(animacaoBotao, { toValue: 1.2, duration: 100, useNativeDriver: true }),
        Animated.timing(animacaoRotacao, { toValue: 1, duration: 200, useNativeDriver: true })
      ]),
      Animated.parallel([
        Animated.spring(animacaoBotao, { toValue: 1, friction: 4, useNativeDriver: true }),
        Animated.timing(animacaoRotacao, { toValue: 0, duration: 200, useNativeDriver: true })
      ])
    ]).start();

    LayoutAnimation.configureNext(layoutAnimConfig);

    const item: ItemLista = { id: criarIdItem(), texto: novoItem.trim(), concluido: false };
    setItens(prev => [item, ...prev]);
    setNovoItem('');
  };

  const toggleItem = (itemId: string) => {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItens(prev => prev.map(item => item.id === itemId ? { ...item, concluido: !item.concluido } : item));
  };

  const removerItem = (itemId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    LayoutAnimation.configureNext(layoutAnimConfig);
    setItens(prev => prev.filter(item => item.id !== itemId));
  };

  const salvarETotalizar = useCallback(() => {
    salvarLista({
      id: (id as string) || Date.now().toString(),
      titulo: titulo.trim() || t('Nova Lista'),
      itens,
      fixada: listaExistente?.fixada,
      protegida: listaExistente?.protegida,
      // Lista criada dentro de uma pasta nasce com a pasta definida
      pastaId: pastaId ? String(pastaId) : listaExistente?.pastaId,
    });
    router.back();
  }, [id, titulo, itens, listaExistente, pastaId, salvarLista, router, t]);

  // Salvar ao apertar o botão voltar do celular
  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        salvarETotalizar();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [salvarETotalizar])
  );

  const rotaçãoIcone = animacaoRotacao.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg']
  });

  return (
    <View style={[styles.container, { backgroundColor: cores.fundo }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex: 1}}>
        
        <View style={styles.header}>
          <TouchableOpacity
            onPress={salvarETotalizar}
            style={[styles.roundButton, { backgroundColor: cores.card, borderColor: cores.borda }]}
            activeOpacity={0.75}
          >
            <Ionicons name="chevron-back" size={23} color={cores.primariaForte} />
          </TouchableOpacity>
          <View style={styles.headerTitleArea}>
            <Text style={[styles.eyebrow, { color: cores.primaria }]}>{t('LISTA')}</Text>
            <TextInput
              style={[styles.inputTitulo, { color: cores.texto }]}
              placeholder={t('Título da lista')}
              placeholderTextColor={cores.subtexto}
              value={titulo}
              onChangeText={setTitulo}
              returnKeyType="done"
            />
          </View>
          <TouchableOpacity
            onPress={salvarETotalizar}
            style={[styles.saveButton, { backgroundColor: cores.primaria }]}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark" size={22} color={paleta.onPrimary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: cores.card, borderColor: cores.borda }]}>
          <View style={[styles.summaryIcon, { backgroundColor: cores.primariaSoft }]}>
            <Ionicons name="checkmark-done" size={22} color={cores.primaria} />
          </View>
          <View style={styles.summaryContent}>
            <View style={styles.summaryTopLine}>
              <Text style={[styles.summaryTitle, { color: cores.texto }]}>{t('Progresso da lista')}</Text>
              <Text style={[styles.summaryCount, { color: cores.primaria }]}>{concluidos}/{itens.length}</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: cores.cardElevated }]}>
              <MotiView
                animate={{ width: `${Math.max(progresso * 100, itens.length > 0 ? 4 : 0)}%` }}
                transition={{ type: 'timing', duration: 400 }}
                style={[styles.progressFill, { backgroundColor: cores.primaria }]}
              />
            </View>
            <Text style={[styles.summarySubtext, { color: cores.subtexto }]}>{t('Toque em um item para marcar como feito')}</Text>
          </View>
        </View>

        <View style={styles.inputArea}>
          <View style={[styles.inputContainer, { backgroundColor: cores.card, borderColor: cores.borda }]}>
            <View style={[styles.inputIcon, { backgroundColor: cores.primariaSoft }]}>
              <Ionicons name="add" size={21} color={cores.primaria} />
            </View>
            <TextInput
              style={[styles.inputNovo, { color: cores.texto }]}
              placeholder={t('Adicionar item...')}
              placeholderTextColor={cores.subtexto}
              value={novoItem}
              onChangeText={setNovoItem}
              onSubmitEditing={adicionarItem}
              returnKeyType="done"
            />
            <Animated.View style={{ transform: [{ scale: animacaoBotao }] }}>
              <TouchableOpacity
                style={[styles.btnAdd, { backgroundColor: cores.primaria }]}
                onPress={adicionarItem}
                activeOpacity={0.8}
              >
                <Animated.View style={{ transform: [{ rotate: rotaçãoIcone }] }}>
                  <Ionicons name="add" size={28} color={paleta.onPrimary} />
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: 45 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {itens.length === 0 ? (
            <MotiView
              from={{ opacity: 0, scale: 0.9, translateY: 15 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 16, stiffness: 120 }}
              style={styles.emptyState}
            >
              <View style={[styles.emptyIcon, { backgroundColor: cores.primariaSoft }]}>
                <Ionicons name="list-outline" size={42} color={cores.primaria} />
              </View>
              <Text style={[styles.emptyTitle, { color: cores.texto }]}>{t('Sua lista está vazia')}</Text>
              <Text style={[styles.emptyText, { color: cores.subtexto }]}>{t('Adicione o primeiro item acima para começar.')}</Text>
            </MotiView>
          ) : (
            itens.map((item, index) => (
              <MotiView
                key={item.id}
                from={{ opacity: 0, translateX: 20, scale: 0.97 }}
                animate={{ opacity: 1, translateX: 0, scale: 1 }}
                transition={{ type: 'spring', damping: 17, stiffness: 150, delay: Math.min(index * 45, 220) }}
                style={[
                  styles.itemRow,
                  {
                    backgroundColor: cores.card,
                    borderColor: cores.borda,
                    borderLeftColor: item.concluido ? cores.sucesso : cores.primaria,
                  },
                ]}
              >
                <TouchableOpacity onPress={() => toggleItem(item.id)} style={styles.checkArea} activeOpacity={0.75}>
                  <MotiView
                    animate={{ scale: item.concluido ? [0.85, 1.12, 1] : 1 }}
                    transition={{ type: 'spring', damping: 10, stiffness: 220 }}
                  >
                    <View style={[
                      styles.customCheck,
                      {
                        borderColor: item.concluido ? cores.sucesso : cores.borda,
                        backgroundColor: item.concluido ? cores.sucesso : 'transparent',
                      },
                    ]}>
                      {item.concluido && <Ionicons name="checkmark" size={17} color={paleta.onPrimary} />}
                    </View>
                  </MotiView>
                  <View style={styles.itemTextArea}>
                    <Text style={[
                      styles.itemTexto,
                      {
                        color: cores.texto,
                        opacity: item.concluido ? 0.55 : 1,
                        textDecorationLine: item.concluido ? 'line-through' : 'none',
                      },
                    ]}>
                      {item.texto}
                    </Text>
                    <Text style={[styles.itemStatus, { color: item.concluido ? cores.sucesso : cores.subtexto }]}>
                      {item.concluido ? t('Concluído') : t('Pendente')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removerItem(item.id)} style={styles.deleteBtn} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={20} color={cores.erro} />
                </TouchableOpacity>
              </MotiView>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 52 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 18 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  headerTitleArea: { flex: 1, marginHorizontal: 14 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginBottom: 2 },
  inputTitulo: { fontSize: 25, fontWeight: '800', padding: 0, letterSpacing: -0.5 },
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
  },
  summaryIcon: { width: 46, height: 46, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginRight: 13 },
  summaryContent: { flex: 1 },
  summaryTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  summaryTitle: { fontSize: 15, fontWeight: '800' },
  summaryCount: { fontSize: 16, fontWeight: '900' },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  summarySubtext: { fontSize: 11.5, marginTop: 8 },
  inputArea: { paddingHorizontal: 20, marginBottom: 8 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, paddingLeft: 10, paddingRight: 6, height: 64, elevation: 3, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  inputIcon: { width: 40, height: 40, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  inputNovo: { flex: 1, fontSize: 16, fontWeight: '500', paddingVertical: 0 },
  btnAdd: { width: 50, height: 50, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 45 },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, marginBottom: 12, borderWidth: 1, borderLeftWidth: 4, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  checkArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  customCheck: { width: 28, height: 28, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  itemTextArea: { flex: 1, marginLeft: 14 },
  itemTexto: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  itemStatus: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  deleteBtn: { padding: 8, marginLeft: 5 },
  emptyState: { alignItems: 'center', marginTop: 74, paddingHorizontal: 25 },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 19, fontWeight: '800' },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
