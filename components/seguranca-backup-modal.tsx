import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNotas } from '../context/NotasContext';

/**
 * Modal global da chave de segurança do backup v2.
 *
 * - codigoNovo: mostra o código recém-criado (copiar/compartilhar).
 * - codigoPendente: pede o código de um backup criado em outro aparelho.
 * - erroCripto: explica por que o backup não foi aplicado (adulterado/downgrade).
 */
export default function SegurancaBackupModal() {
  const { isDark } = useTheme();
  const {
    codigoPendente, codigoNovo, erroCripto, resolverCodigo, fecharCodigoNovo,
    ignorarCodigoPendente, limparErroCripto,
  } = useNotas();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const visivel = !!codigoNovo || !!codigoPendente || !!erroCripto;
  if (!visivel) return null;

  const tema = {
    fundo: isDark ? '#0B0B10' : '#F2F2F7',
    cartao: isDark ? '#16161D' : '#FFFFFF',
    borda: isDark ? '#2A2A33' : '#E2E2E7',
    titulo: isDark ? '#FFFFFF' : '#1C1C1E',
    texto: isDark ? '#AEAEB2' : '#6E6E73',
    campo: isDark ? '#0B0B10' : '#F2F2F7',
    primario: '#0A84FF',
    erro: '#FF453A',
    codigo: isDark ? '#FFD60A' : '#B25000',
  };

  const confirmar = async () => {
    if (ocupado || !codigo.trim()) return;
    setOcupado(true);
    setErro('');
    try {
      const ok = await resolverCodigo(codigo);
      if (!ok) setErro('Código incorreto. Confira os 32 caracteres e tente de novo.');
      else setCodigo('');
    } catch {
      setErro('Não consegui validar agora. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const compartilhar = async () => {
    try {
      await Share.share({
        message: 'Minha chave de segurança do Simple Notes (guarde com cuidado):\n' + codigoNovo,
      });
    } catch {}
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[s.fundo, { backgroundColor: isDark ? '#000000AA' : '#00000066' }]}
      >
        <View style={[s.cartao, { backgroundColor: tema.cartao, borderColor: tema.borda }]}>
          {!!codigoNovo && (
            <>
              <Text style={[s.titulo, { color: tema.titulo }]}>Sua chave de segurança</Text>
              <Text style={[s.texto, { color: tema.texto }]}>
                Guarde este código fora do celular. Ele é o único jeito de abrir seu backup
                em um aparelho novo ou depois de reinstalar. Sem ele, ninguém — nem o Google —
                consegue ler o backup.
              </Text>
              <Text selectable style={[s.codigo, { color: tema.codigo, backgroundColor: tema.campo, borderColor: tema.borda }]}>
                {codigoNovo}
              </Text>
              <View style={s.linha}>
                <Pressable onPress={compartilhar} style={[s.botao, { backgroundColor: tema.campo, borderColor: tema.borda }]}>
                  <Text style={{ color: tema.titulo, fontWeight: '600' }}>Compartilhar</Text>
                </Pressable>
                <Pressable onPress={fecharCodigoNovo} style={[s.botao, { backgroundColor: tema.primario, borderColor: tema.primario }]}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Já guardei</Text>
                </Pressable>
              </View>
            </>
          )}

          {!codigoNovo && !!codigoPendente && (
            <>
              <Text style={[s.titulo, { color: tema.titulo }]}>Digite a chave de segurança</Text>
              <Text style={[s.texto, { color: tema.texto }]}>
                Este backup já está protegido por uma chave criada em outro aparelho.
                Digite o código de 32 caracteres que o app mostrou lá (em Ajustes →
                Chave de segurança).
              </Text>
              <TextInput
                value={codigo}
                onChangeText={(v) => { setCodigo(v.toUpperCase()); setErro(''); }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                placeholderTextColor={isDark ? '#5A5A66' : '#A1A1A6'}
                style={[s.campo, { color: tema.titulo, backgroundColor: tema.campo, borderColor: tema.borda }]}
                editable={!ocupado}
                onSubmitEditing={confirmar}
                returnKeyType="done"
              />
              {!!erro && <Text style={[s.erro, { color: tema.erro }]}>{erro}</Text>}
              <View style={s.linha}>
                <Pressable
                  onPress={ignorarCodigoPendente}
                  disabled={ocupado}
                  style={[s.botao, { backgroundColor: tema.campo, borderColor: tema.borda }]}
                >
                  <Text style={{ color: tema.titulo, fontWeight: '600' }}>Agora não</Text>
                </Pressable>
                <Pressable
                  onPress={confirmar}
                  disabled={ocupado}
                  style={[s.botao, { backgroundColor: tema.primario, opacity: ocupado ? 0.6 : 1 }]}
                >
                  {ocupado
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Desbloquear</Text>}
                </Pressable>
              </View>
              <Text style={[s.dica, { color: tema.texto }]}>
                Sem o código, este aparelho continua funcionando, mas não sincroniza com o backup.
              </Text>
            </>
          )}

          {!codigoNovo && !codigoPendente && !!erroCripto && (
            <>
              <Text style={[s.titulo, { color: tema.titulo }]}>Backup não aplicado</Text>
              <Text style={[s.texto, { color: tema.texto }]}>{erroCripto}</Text>
              <Pressable onPress={limparErroCripto} style={[s.botao, s.botaoLargo, { backgroundColor: tema.primario }]}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Entendi</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  cartao: { width: '100%', maxWidth: 460, borderRadius: 20, borderWidth: 1, padding: 20 },
  titulo: { fontSize: 19, fontWeight: '700', marginBottom: 8 },
  texto: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  codigo: {
    fontSize: 16, lineHeight: 24, letterSpacing: 0.6, fontWeight: '700',
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16,
  },
  campo: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15, letterSpacing: 0.5, marginBottom: 10,
  },
  erro: { fontSize: 13, marginBottom: 10 },
  dica: { fontSize: 12, marginTop: 10, textAlign: 'center', opacity: 0.8 },
  linha: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  botao: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  botaoLargo: { marginTop: 6 },
});
