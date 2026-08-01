import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
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
  View
} from 'react-native';
import { ItemLista, useListas } from '../context/ListaContext';
import { useTheme } from '../context/ThemeContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const layoutAnimConfig = {
  duration: 300,
  update: { type: LayoutAnimation.Types.spring, springDamping: 0.7 },
  delete: { type: LayoutAnimation.Types.linear, property: LayoutAnimation.Properties.opacity },
};

export default function EditorL() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { isDark } = useTheme();
  const { listas, salvarLista } = useListas();

  const [titulo, setTitulo] = useState('');
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [novoItem, setNovoItem] = useState('');

  const animacaoBotao = useRef(new Animated.Value(1)).current;
  const animacaoRotacao = useRef(new Animated.Value(0)).current;

  const cores = {
    fundo: isDark ? '#000' : '#F8F9FB',
    texto: isDark ? '#FFF' : '#1C1C1E',
    card: isDark ? '#1C1C1E' : '#FFF',
    borda: isDark ? '#333' : '#E5E5EA',
    primaria: isDark ? "#BB86FC" : "#5856D6",
    sucesso: "#34C759",
    erro: "#FF3B30"
  };

  useEffect(() => {
    if (id) {
      const listaExistente = listas.find(l => l.id === id);
      if (listaExistente) {
        setTitulo(listaExistente.titulo);
        setItens(listaExistente.itens);
      }
    }
  }, [id]);

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

    const item: ItemLista = { id: Date.now().toString(), texto: novoItem, concluido: false };
    setItens([item, ...itens]);
    setNovoItem('');
  };

  const toggleItem = (itemId: string) => {
    Haptics.selectionAsync();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItens(itens.map(i => i.id === itemId ? { ...i, concluido: !i.concluido } : i));
  };

  const removerItem = (itemId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    LayoutAnimation.configureNext(layoutAnimConfig);
    setItens(itens.filter(i => i.id !== itemId));
  };

  const salvarETotalizar = () => {
    salvarLista({
      id: (id as string) || Date.now().toString(),
      titulo: titulo || "Nova Lista",
      itens
      // O campo 'fixada' não é passado aqui, então ele morre.
    });
    router.back();
};

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
            style={[styles.backBtn, {backgroundColor: cores.card}]}
          >
            <Ionicons name="chevron-back" size={24} color={cores.primaria} />
          </TouchableOpacity>
          <TextInput 
            style={[styles.inputTitulo, { color: cores.texto }]}
            placeholder="Título da Lista"
            placeholderTextColor="#8E8E93"
            value={titulo}
            onChangeText={setTitulo}
          />
        </View>

        <View style={styles.inputArea}>
          <View style={[styles.inputContainer, { backgroundColor: cores.card, borderColor: cores.borda }]}>
            <TextInput 
                style={[styles.inputNovo, { color: cores.texto }]}
                placeholder="Adicionar à lista..."
                placeholderTextColor="#8E8E93"
                value={novoItem}
                onChangeText={setNovoItem}
                onSubmitEditing={adicionarItem}
            />
            <Animated.View style={{ transform: [{ scale: animacaoBotao }] }}>
                <TouchableOpacity 
                    style={[styles.btnAdd, { backgroundColor: cores.primaria }]} 
                    onPress={adicionarItem}
                >
                    <Animated.View style={{ transform: [{ rotate: rotaçãoIcone }] }}>
                        <Ionicons name="add" size={30} color="#FFF" />
                    </Animated.View>
                </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        <ScrollView 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        >
          {itens.length === 0 && (
              <View style={styles.emptyState}>
                  <Ionicons name="cart-outline" size={80} color={cores.borda} />
                  <Text style={{color: '#888', marginTop: 10}}>Sua lista está vazia</Text>
              </View>
          )}

          {itens.map((item) => (
            <View 
                key={item.id} 
                style={[styles.itemRow, { 
                  backgroundColor: cores.card, 
                  borderLeftWidth: 5, 
                  borderLeftColor: item.concluido ? cores.sucesso : cores.primaria 
                }]}
            >
              <TouchableOpacity onPress={() => toggleItem(item.id)} style={styles.checkArea}>
                <View style={[styles.customCheck, { 
                  borderColor: item.concluido ? cores.sucesso : cores.borda, 
                  backgroundColor: item.concluido ? cores.sucesso : 'transparent' 
                }]}>
                   {item.concluido && <Ionicons name="checkmark" size={16} color="#FFF" />}
                </View>
                <Text style={[
                  styles.itemTexto, 
                  { 
                    color: cores.texto, 
                    textDecorationLine: item.concluido ? 'line-through' : 'none', 
                    opacity: item.concluido ? 0.4 : 1 
                  }
                ]}>
                  {item.texto}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => removerItem(item.id)} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={20} color={cores.erro} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 50 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 25 },
  backBtn: { width: 45, height: 45, borderRadius: 15, justifyContent: 'center', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5 },
  inputTitulo: { fontSize: 26, fontWeight: '800', marginLeft: 15, flex: 1, letterSpacing: -0.5 },
  inputArea: { paddingHorizontal: 20, marginBottom: 15 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, paddingLeft: 15, paddingRight: 6, height: 65, elevation: 3, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  inputNovo: { flex: 1, fontSize: 16, fontWeight: '500' },
  btnAdd: { width: 52, height: 52, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 20, marginBottom: 15, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  checkArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  customCheck: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  itemTexto: { fontSize: 17, marginLeft: 15, fontWeight: '600' },
  deleteBtn: { padding: 5 },
  emptyState: { alignItems: 'center', marginTop: 100, opacity: 0.5 }
});