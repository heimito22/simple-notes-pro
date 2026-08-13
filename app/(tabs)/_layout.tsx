import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { Tabs } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { alarmeEstado } from '../../context/alarme-estado';
import { bloqueioEstado } from '../../context/bloqueio-estado';
import { useTheme } from '../../context/ThemeContext';

export default function TabLayout() {
  const { isDark, config } = useTheme();

  // --- LÓGICA DE BLOQUEIO ---
  // "autenticado" = o usuário desbloqueou nesta sessão. A tela de bloqueio é DERIVADA:
  // aparece sempre que a biometria está ativa e o usuário ainda não autenticou.
  const appState = useRef(AppState.currentState);
  const [autenticado, setAutenticado] = useState(false);
  const tempoSaida = useRef<number | null>(null);
  const autenticadoRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    autenticadoRef.current = autenticado;
  }, [autenticado]);

  const cores = {
    fundo: isDark ? '#000' : '#F2F2F7',
    texto: isDark ? '#FFF' : '#000',
    accent: isDark ? '#BB86FC' : '#6200EE',
    itemFundo: isDark ? '#1C1C1E' : '#FFF',
  };

  const autenticar = async () => {
    const compativel = await LocalAuthentication.hasHardwareAsync();
    const cadastrado = await LocalAuthentication.isEnrolledAsync();

    if (!compativel || !cadastrado) {
      setAutenticado(true);
      return;
    }

    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Acesse suas informações',
      fallbackLabel: 'Usar senha do dispositivo',
      disableDeviceFallback: false,
    });

    if (res.success) {
      setAutenticado(true);
      tempoSaida.current = null;
    }
  };

  useEffect(() => {
    // Com biometria ativa o app abre BLOQUEADO (autenticado=false → tela de bloqueio
    // derivada). Só pede biometria se NENHUM alarme estiver na frente — o alarme é
    // visível sem desbloquear; ao fechar, o subscribe abaixo pede a biometria.
    if (config?.exigirBiometriaApp) {
      timeoutRef.current = setTimeout(() => {
        if (!alarmeEstado.ativo && !autenticadoRef.current) autenticar();
      }, 600);
    }

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (!config?.exigirBiometriaApp) return;

      if (appState.current.match(/active/) && nextState.match(/inactive|background/)) {
        // Sair para UIs do SISTEMA (seletor de fotos, diálogo de permissão de áudio)
        // também derruba o app para background — não deve contar como saída do usuário.
        tempoSaida.current = bloqueioEstado.suspender ? null : Date.now();
      }

      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        // Alarme na frente OU voltando de seletor de fotos/permissão → não bloqueia
        if (alarmeEstado.ativo || bloqueioEstado.suspender) {
          tempoSaida.current = null;
          appState.current = nextState;
          return;
        }
        if (tempoSaida.current) {
          const agora = Date.now();
          const diferencaMinutos = (agora - tempoSaida.current) / 1000 / 60;

          if (diferencaMinutos >= (config.tempoBloqueio || 0)) {
            setAutenticado(false);
            autenticar();
          }
        } else {
          setAutenticado(false);
          autenticar();
        }
      }
      appState.current = nextState;
    });

    // Quando um alarme ativo encerra e o usuário ainda não desbloqueou NESTA sessão
    // (ex.: app abriu pelo alarme), pede biometria — as anotações só abrem desbloqueando.
    // Se o usuário já estava usando o app desbloqueado quando o alarme tocou, não incomoda.
    const unsubAlarme = alarmeEstado.ouvir(ativo => {
      if (!config?.exigirBiometriaApp) return;
      if (ativo) return;
      if (!autenticadoRef.current && AppState.currentState === 'active') {
        autenticar();
      }
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      subscription.remove();
      unsubAlarme();
    };
  }, [config?.exigirBiometriaApp, config?.tempoBloqueio]);

  // --- TELA DE BLOQUEIO PERSONALIZADA ---
  // Derivada: com biometria ativa, o conteúdo só aparece depois de autenticar.
  if (!autenticado && config?.exigirBiometriaApp) {
    return (
      <View style={[styles.lockContainer, { backgroundColor: cores.fundo }]}>
        <View style={[styles.iconCircle, { backgroundColor: cores.itemFundo }]}>
          <Ionicons name="lock-closed" size={60} color={cores.accent} />
        </View>
        
        <Text style={[styles.lockTitle, { color: cores.texto }]}>App Bloqueado</Text>
        <Text style={styles.lockSubTitle}>Toque no botão abaixo para acessar suas notas e tarefas.</Text>

        <TouchableOpacity 
          style={[styles.btnAutenticar, { backgroundColor: cores.accent }]} 
          onPress={autenticar}
          activeOpacity={0.8}
        >
          <Ionicons name="finger-print" size={24} color="#FFF" style={{ marginRight: 10 }} />
          <Text style={styles.btnText}>Desbloquear</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: isDark ? '#000' : '#FFF',
        borderTopWidth: 1,
        borderTopColor: isDark ? '#1C1C1E' : '#EEE',
        height: 75,
        paddingBottom: 15,
        paddingTop: 10,
      },
      tabBarActiveTintColor: isDark ? '#BB86FC' : '#6200EE',
      tabBarInactiveTintColor: isDark ? '#666' : '#999',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Notas', tabBarIcon: ({ color, size }) => <Ionicons name="document-text" size={size} color={color} /> }} />
      <Tabs.Screen name="tarefas" options={{ title: 'Tarefas', tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" size={size} color={color} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  lockContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    // Sombra leve para destacar o círculo
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  lockTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  lockSubTitle: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  btnAutenticar: {
    flexDirection: 'row',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    alignItems: 'center',
  },
  btnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});