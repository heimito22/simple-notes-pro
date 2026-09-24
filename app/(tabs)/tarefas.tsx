import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { AnimatePresence, MotiView, useAnimationState } from 'moti';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Recorrencia, useTarefas } from '../../context/TarefasContext';
import { useTheme } from '../../context/ThemeContext';
import { appColors } from '../../constants/theme';

const DIAS: Recorrencia[] = ['Uma vez', 'Diária', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// Componente de Card isolado para evitar conflitos de contexto
// `tr` = função de tradução; `task` = objeto da tarefa (antes chamado de t).
const TaskCard = ({ task, cores, onToggle, onDelete, isDone, tr }: any) => (
  <MotiView
    from={{ opacity: 0, scale: 0.9, translateY: 15 }}
    animate={{ opacity: 1, scale: 1, translateY: 0 }}
    exit={{ opacity: 0, scale: 0.9, translateY: -15 }}
    transition={{ type: 'timing', duration: 250 }}
    style={[styles.card, { backgroundColor: cores.card, borderColor: cores.borda, borderLeftColor: cores.primaria }]}
  >        <TouchableOpacity style={styles.checkArea} onPress={() => onToggle(task.id)} activeOpacity={0.75}>
      <MotiView
        animate={{ scale: isDone ? [0.86, 1.12, 1] : 1 }}
        transition={{ type: 'spring', damping: 10, stiffness: 220 }}
      >
        <View style={[
          styles.customCheck,
          {
            borderColor: isDone ? cores.primaria : cores.subtexto,
            backgroundColor: isDone ? cores.primaria : 'transparent'
          }
        ]}>
          {isDone && <Ionicons name="checkmark" size={16} color={cores.onPrimary} />}
        </View>
      </MotiView>
      <View style={{ marginLeft: 15 }}>
        <Text style={[
          styles.taskTxt,
          { color: cores.texto, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.58 : 1 }
        ]}>
          {task.titulo}
        </Text>
        <Text style={{ color: cores.subtexto, fontSize: 12, opacity: isDone ? 0.75 : 1 }}>{tr(task.recorrencia)} • {task.horario}</Text>
      </View>
    </TouchableOpacity>
    <TouchableOpacity onPress={() => onDelete(task.id)} style={styles.btnDelete} activeOpacity={0.7}>
      <Ionicons name="trash-outline" size={20} color={cores.perigo} />
    </TouchableOpacity>
  </MotiView>
);

export default function TarefasScreen() {
  const { tarefas, adicionarTarefa, alternarTarefa, excluirTarefa } = useTarefas();
  const { isDark, t } = useTheme();
  
  const [novoTitulo, setNovoTitulo] = useState('');
  const [diaSelecionado, setDiaSelecionado] = useState<Recorrencia>('Diária');
  const [exibirRelogio, setExibirRelogio] = useState(false);
  const [dataTemp, setDataTemp] = useState(new Date());

  const cores = useMemo(() => {
    const paleta = appColors(isDark);
    return {
      fundo: paleta.background,
      card: paleta.surface,
      texto: paleta.text,
      subtexto: paleta.muted,
      primaria: paleta.primary,
      primariaSoft: paleta.primarySoft,
      borda: paleta.border,
      inputFundo: paleta.surfaceElevated,
      onPrimary: paleta.onPrimary,
      perigo: paleta.danger,
    };
  }, [isDark]);

  const btnState = useAnimationState({
    idle: { scale: 1 },
    pressed: { scale: 0.9 },
    success: { scale: [1.1, 1] },
  });

  // Rotação do ícone "+" ao adicionar tarefa
  const [rotacaoAdd] = useState(() => new Animated.Value(0));
  const rotacaoIcone = rotacaoAdd.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  const horaExibicao = dataTemp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const { pendentes, concluidas } = useMemo(() => {
    return {
      pendentes: tarefas?.filter((t: any) => !t.concluida) || [],
      concluidas: tarefas?.filter((t: any) => t.concluida) || []
    };
  }, [tarefas]);

  const totalTarefas = tarefas?.length || 0;
  const progresso = totalTarefas > 0 ? concluidas.length / totalTarefas : 0;

  const handleAdicionar = useCallback(() => {
    if (novoTitulo.trim()) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.sequence([
        Animated.timing(rotacaoAdd, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(rotacaoAdd, { toValue: 0, friction: 4, tension: 100, useNativeDriver: true }),
      ]).start();
      btnState.transitionTo('success');
      adicionarTarefa(novoTitulo, diaSelecionado, horaExibicao);
      setNovoTitulo('');
      setTimeout(() => btnState.transitionTo('idle'), 400);
    }
  }, [novoTitulo, diaSelecionado, horaExibicao, adicionarTarefa, btnState, rotacaoAdd]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View testID="sn-screen-tarefas" style={[styles.container, { backgroundColor: cores.fundo }]}>
        
        <View style={styles.tituloArea}>
          <View>
            <Text style={[styles.tituloPagina, { color: cores.texto }]}>{t('Tarefas')}</Text>
            <Text style={[styles.subtituloPagina, { color: cores.subtexto }]}>{t('Um passo de cada vez')}</Text>
          </View>
          <MotiView
            from={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 14, stiffness: 150 }}
            style={[styles.progressoBadge, { backgroundColor: cores.card, borderColor: cores.borda }]}
          >
            <Text style={[styles.progressoNumero, { color: cores.primaria }]}>{concluidas.length}</Text>
            <Text style={[styles.progressoLabel, { color: cores.subtexto }]}>/{totalTarefas || 0}</Text>
          </MotiView>
        </View>

        <View style={[styles.progressoTrack, { backgroundColor: cores.borda }]}>
          <MotiView
            animate={{ width: `${Math.max(progresso * 100, totalTarefas === 0 ? 0 : 4)}%` }}
            transition={{ type: 'timing', duration: 450 }}
            style={[styles.progressoFill, { backgroundColor: cores.primaria }]}
          />
        </View>

        <View style={styles.inputSection}>
          <View style={[styles.inputContainer, { backgroundColor: cores.card, borderColor: cores.borda }]}>
            <TextInput
              style={[styles.input, { color: cores.texto }]}
              placeholder={t('O que precisa ser feito?')}
              placeholderTextColor={cores.subtexto}
              value={novoTitulo}
              onChangeText={setNovoTitulo}
            />
            
            <TouchableOpacity 
              onPress={() => setExibirRelogio(true)} 
              style={[styles.relogioBtn, { backgroundColor: cores.inputFundo }]}
            >
              <Ionicons name="time" size={18} color={cores.primaria} />
              <Text style={[styles.relogioTexto, { color: cores.texto }]}>{horaExibicao}</Text>
            </TouchableOpacity>

            <Pressable onPress={handleAdicionar}>
              <MotiView 
                state={btnState}
                style={[styles.btnAdd, { backgroundColor: cores.primaria }]}
              >
                <Animated.View style={{ transform: [{ rotate: rotacaoIcone }] }}>
                  <Ionicons name="add" size={28} color={cores.onPrimary} />
                </Animated.View>
              </MotiView>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 15 }}>
            {DIAS.map((d) => (
              <TouchableOpacity 
                key={d} 
                onPress={() => setDiaSelecionado(d)}
                style={[
                  styles.diaBtn, 
                  diaSelecionado === d 
                    ? { backgroundColor: cores.primaria, borderColor: cores.primaria } 
                    : { backgroundColor: cores.card, borderColor: cores.borda }
                ]}
              >
                <Text style={{ color: diaSelecionado === d ? cores.onPrimary : cores.texto, fontWeight: '700' }}>{t(d)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.scrollList} showsVerticalScrollIndicator={false}>
          <AnimatePresence>
            {pendentes.map((tarefaItem: any) => (
              <TaskCard 
                key={tarefaItem.id} 
                task={tarefaItem} 
                tr={t} 
                cores={cores} 
                onToggle={alternarTarefa} 
                onDelete={excluirTarefa} 
              />
            ))}

            {concluidas.length > 0 && (
              <MotiView
                key="separador-concluidas"
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={styles.headerConcluidas}
              >
                <Text style={[styles.secaoTitulo, { color: cores.subtexto }]}>{t('CONCLUÍDAS')}</Text>
                <View style={[styles.linhaDivisora, { backgroundColor: cores.borda }]} />
              </MotiView>
            )}

            {concluidas.map((tarefaItem: any) => (
              <TaskCard 
                key={tarefaItem.id} 
                task={tarefaItem} 
                tr={t} 
                cores={cores} 
                onToggle={alternarTarefa} 
                onDelete={excluirTarefa} 
                isDone 
              />
            ))}
          </AnimatePresence>
          
          {tarefas.length === 0 && (
             <MotiView
               from={{ opacity: 0, scale: 0.9, translateY: 15 }}
               animate={{ opacity: 1, scale: 1, translateY: 0 }}
               transition={{ type: 'spring', damping: 16, stiffness: 120 }}
               style={styles.emptyContainer}
             >
                <View style={[styles.emptyIconCircle, { backgroundColor: cores.primariaSoft }]}>
                  <Ionicons name="sparkles-outline" size={38} color={cores.primaria} />
                </View>
                <Text style={[styles.emptyTitle, { color: cores.texto }]}>{t('Tudo limpo por aqui!')}</Text>
                <Text style={[styles.emptySub, { color: cores.subtexto }]}>{t('Adicione sua primeira tarefa acima.')}</Text>
             </MotiView>
          )}
        </ScrollView>

        {exibirRelogio && (
          <DateTimePicker 
            value={dataTemp} 
            mode="time" 
            is24Hour={true} 
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(e, d) => { setExibirRelogio(false); if(d) setDataTemp(d); }} 
          />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  tituloArea: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 4 },
  tituloPagina: { fontSize: 34, fontWeight: '900', letterSpacing: -1.2 },
  subtituloPagina: { fontSize: 14, fontWeight: '600', marginTop: -4 },
  progressoBadge: { flexDirection: 'row', alignItems: 'baseline', borderRadius: 18, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 },
  progressoNumero: { fontSize: 22, fontWeight: '900' },
  progressoLabel: { fontSize: 14, fontWeight: '700' },
  progressoTrack: { height: 5, borderRadius: 3, marginHorizontal: 20, marginBottom: 18, overflow: 'hidden' },
  progressoFill: { height: '100%', borderRadius: 3, minWidth: 0 },
  inputSection: { paddingHorizontal: 20, marginBottom: 15 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 22, borderWidth: 1.5 },
  input: { flex: 1, fontSize: 17, paddingLeft: 12 },
  relogioBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 40, borderRadius: 12, marginRight: 8 },
  relogioTexto: { marginLeft: 6, fontWeight: '700', fontSize: 13 },
  btnAdd: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  diaBtn: { paddingHorizontal: 16, height: 38, borderRadius: 12, justifyContent: 'center', marginRight: 8, borderWidth: 1.5 },
  scrollList: { paddingHorizontal: 20, paddingBottom: 40 },
  headerConcluidas: { flexDirection: 'row', alignItems: 'center', marginTop: 25, marginBottom: 15 },
  linhaDivisora: { flex: 1, height: 1, marginLeft: 10, opacity: 0.3 },
  secaoTitulo: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, marginBottom: 10, borderWidth: 1, borderLeftWidth: 3, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 7 },
  checkArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  customCheck: { width: 28, height: 28, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  taskTxt: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  btnDelete: { padding: 8, marginLeft: 5 },
  emptyContainer: { alignItems: 'center', marginTop: 70, paddingHorizontal: 24 },
  emptyIconCircle: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 19, fontWeight: '800' },
  emptySub: { fontSize: 14, marginTop: 8, textAlign: 'center' }
});
