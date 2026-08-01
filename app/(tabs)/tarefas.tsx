import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { AnimatePresence, MotiView, useAnimationState } from 'moti';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Recorrencia, useTarefas } from '../../context/TarefasContext';
import { useTheme } from '../../context/ThemeContext';

const DIAS: Recorrencia[] = ['Uma vez', 'Diária', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// Componente de Card isolado para evitar conflitos de contexto
const TaskCard = ({ t, cores, onToggle, onDelete, isDone }: any) => (
  <MotiView
    from={{ opacity: 0, scale: 0.9, translateY: 15 }}
    animate={{ opacity: isDone ? 0.6 : 1, scale: 1, translateY: 0 }}
    exit={{ opacity: 0, scale: 0.9, translateY: -15 }}
    transition={{ type: 'timing', duration: 250 }}
    style={[styles.card, { backgroundColor: cores.card }]}
  >
    <TouchableOpacity style={styles.checkArea} onPress={() => onToggle(t.id)}>
      <View style={[
        styles.customCheck, 
        { 
          borderColor: isDone ? cores.primaria : cores.subtexto, 
          backgroundColor: isDone ? cores.primaria : 'transparent' 
        }
      ]}>
        {isDone && <Ionicons name="checkmark" size={16} color="#FFF" />}
      </View>
      <View style={{ marginLeft: 15 }}>
        <Text style={[
          styles.taskTxt, 
          { color: cores.texto, textDecorationLine: isDone ? 'line-through' : 'none' }
        ]}>
          {t.titulo}
        </Text>
        <Text style={{ color: cores.subtexto, fontSize: 12 }}>{t.recorrencia} • {t.horario}</Text>
      </View>
    </TouchableOpacity>
    <TouchableOpacity onPress={() => onDelete(t.id)} style={styles.btnDelete}>
      <Ionicons name="trash-outline" size={20} color="#FF453A" />
    </TouchableOpacity>
  </MotiView>
);

export default function TarefasScreen() {
  const { tarefas, adicionarTarefa, alternarTarefa, excluirTarefa } = useTarefas();
  const { isDark } = useTheme();
  
  const [novoTitulo, setNovoTitulo] = useState('');
  const [diaSelecionado, setDiaSelecionado] = useState<Recorrencia>('Diária');
  const [exibirRelogio, setExibirRelogio] = useState(false);
  const [dataTemp, setDataTemp] = useState(new Date());

  const cores = useMemo(() => ({
    fundo: isDark ? '#000000' : '#F2F2F7',
    card: isDark ? '#1C1C1E' : '#FFFFFF',
    texto: isDark ? '#FFFFFF' : '#000000',
    subtexto: '#8E8E93',
    primaria: isDark ? '#BF5AF2' : '#AF52DE',
    borda: isDark ? '#3A3A3C' : '#E5E5EA',
    inputFundo: isDark ? '#2C2C2E' : '#E9E9EB',
  }), [isDark]);

  const btnState = useAnimationState({
    idle: { scale: 1 },
    pressed: { scale: 0.9 },
    success: { scale: [1.1, 1] },
  });

  const horaExibicao = dataTemp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const { pendentes, concluidas } = useMemo(() => {
    return {
      pendentes: tarefas?.filter((t: any) => !t.concluida) || [],
      concluidas: tarefas?.filter((t: any) => t.concluida) || []
    };
  }, [tarefas]);

  const handleAdicionar = useCallback(() => {
    if (novoTitulo.trim()) {
      btnState.transitionTo('success');
      adicionarTarefa(novoTitulo, diaSelecionado, horaExibicao);
      setNovoTitulo('');
      setTimeout(() => btnState.transitionTo('idle'), 400);
    }
  }, [novoTitulo, diaSelecionado, horaExibicao, adicionarTarefa, btnState]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: cores.fundo }]}>
        
        <Text style={[styles.tituloPagina, { color: cores.texto }]}>Tarefas</Text>

        <View style={styles.inputSection}>
          <View style={[styles.inputContainer, { backgroundColor: cores.card, borderColor: cores.borda }]}>
            <TextInput
              style={[styles.input, { color: cores.texto }]}
              placeholder="O que precisa ser feito?"
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
                <Ionicons name="add" size={28} color="#FFF" />
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
                <Text style={{ color: diaSelecionado === d ? '#FFF' : cores.texto, fontWeight: '700' }}>{d}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.scrollList} showsVerticalScrollIndicator={false}>
          <AnimatePresence>
            {pendentes.map((t: any) => (
              <TaskCard 
                key={t.id} 
                t={t} 
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
                <Text style={[styles.secaoTitulo, { color: cores.subtexto }]}>CONCLUÍDAS</Text>
                <View style={[styles.linhaDivisora, { backgroundColor: cores.borda }]} />
              </MotiView>
            )}

            {concluidas.map((t: any) => (
              <TaskCard 
                key={t.id} 
                t={t} 
                cores={cores} 
                onToggle={alternarTarefa} 
                onDelete={excluirTarefa} 
                isDone 
              />
            ))}
          </AnimatePresence>
          
          {tarefas.length === 0 && (
             <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.emptyContainer}>
                <Ionicons name="sparkles-outline" size={60} color={cores.borda} />
                <Text style={[styles.emptyText, { color: cores.subtexto }]}>Tudo limpo por aqui!</Text>
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
  tituloPagina: { fontSize: 34, fontWeight: '900', marginLeft: 20, marginBottom: 20, letterSpacing: -1 },
  inputSection: { paddingHorizontal: 16, marginBottom: 15 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 22, borderWidth: 1.5 },
  input: { flex: 1, fontSize: 17, paddingLeft: 12 },
  relogioBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 40, borderRadius: 12, marginRight: 8 },
  relogioTexto: { marginLeft: 6, fontWeight: '700', fontSize: 13 },
  btnAdd: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  diaBtn: { paddingHorizontal: 16, height: 38, borderRadius: 12, justifyContent: 'center', marginRight: 8, borderWidth: 1.5 },
  scrollList: { paddingHorizontal: 16, paddingBottom: 40 },
  headerConcluidas: { flexDirection: 'row', alignItems: 'center', marginTop: 25, marginBottom: 15 },
  linhaDivisora: { flex: 1, height: 1, marginLeft: 10, opacity: 0.3 },
  secaoTitulo: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, marginBottom: 10, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5 },
  checkArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  customCheck: { width: 28, height: 28, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  taskTxt: { fontSize: 17, fontWeight: '600', marginBottom: 2 },
  btnDelete: { padding: 8, marginLeft: 5 },
  emptyContainer: { alignItems: 'center', marginTop: 60, opacity: 0.5 },
  emptyText: { fontSize: 16, fontWeight: '600', marginTop: 10 }
});