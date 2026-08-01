import * as LocalAuthentication from 'expo-local-authentication';
import React from 'react';
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

export default function SettingsScreen() {
  const { isDark, toggleTheme, config, atualizarConfig } = useTheme();

  const cores = {
    fundo: isDark ? '#000' : '#F2F2F7',
    textoPrincipal: isDark ? '#FFF' : '#000',
    textoSecundario: '#888',
    itemFundo: isDark ? '#1C1C1E' : '#FFF',
    borda: isDark ? '#333' : '#E5E5EA',
    accent: isDark ? '#BB86FC' : '#6200EE'
  };

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

  return (
    <View style={[styles.container, { backgroundColor: cores.fundo }]}>
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

      <View style={styles.footer}>
        <Text style={styles.footerText}>Versão do App: 1.0.0</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 70, paddingHorizontal: 20 },
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
  footer: { marginTop: 'auto', marginBottom: 40, alignItems: 'center' },
  footerText: { color: '#888', fontSize: 14 }
});