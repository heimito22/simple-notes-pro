import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNotas } from '../context/NotasContext';
import { bloqueioEstado } from '../context/bloqueio-estado';

/** Mostra o código em grupos de 4 (aceita colar com ou sem traços). */
function formatarCodigo(v: string): string {
  const s = String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32);
  return s.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

/**
 * Modal global da chave de segurança do backup v2.
 *
 * - codigoPendente: pede o código do backup que já existe (prioridade).
 * - codigoNovo: mostra o código da chave recém-criada (só depois de um envio ok).
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

  const mostrarPedido = !!codigoPendente;
  const mostrarNovo = !mostrarPedido && !!codigoNovo;
  const mostrarErro = !mostrarPedido && !mostrarNovo && !!erroCripto;
  if (!mostrarPedido && !mostrarNovo && !mostrarErro) return null;

  const tema = {
    cartao: isDark ? '#16161D' : '#FFFFFF',
    borda: isDark ? '#2A2A33' : '#E2E2E7',
    titulo: isDark ? '#FFFFFF' : '#1C1C1E',
    texto: isDark ? '#AEAEB2' : '#6E6E73',
    campo: isDark ? '#0B0B10' : '#F2F2F7',
    primario: '#0A84FF',
    erro: '#FF453A',
    codigo: isDark ? '#FFD60A' : '#B25000',
  };

  const fechar = () => {
    if (mostrarPedido) ignorarCodigoPendente();
    else if (mostrarNovo) fecharCodigoNovo();
    else limparErroCripto();
  };

  const digitos = codigo.replace(/[^0-9A-Z]/g, '').length;
  const pronto = digitos === 32;

  const confirmar = async () => {
    if (ocupado || !pronto) return;
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
    bloqueioEstado.ativar(); // o share sheet do sistema não conta como saída
    try {
      await Share.share({
        message: 'Minha chave de segurança do Simple Notes (guarde com cuidado):\n' + codigoNovo,
      });
    } catch {}
    finally { bloqueioEstado.liberar(); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={fechar}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[s.fundo, { backgroundColor: isDark ? '#000000AA' : '#00000066' }]}
      >
        <View style={[s.cartao, { backgroundColor: tema.cartao, borderColor: tema.borda }]}>
          <Pressable onPress={fechar} hitSlop={12} style={s.fechar} accessibilityLabel="Fechar">
            <Text style={{ color: tema.texto, fontSize: 22, lineHeight: 22 }}>✕</Text>
          </Pressable>

          {mostrarPedido && (
            <>
              <Text style={[s.titulo, { color: tema.titulo }]}>Digite a chave de segurança</Text>
              <Text style={[s.texto, { color: tema.texto }]}>
                Este backup já está protegido por uma chave criada em outro aparelho.
                Use o código que o outro aparelho mostra em Ajustes → Chave de segurança.
                Se este aparelho acabou de criar uma chave, use o código que ele mostrou —
                nunca os dois.
              </Text>
              <TextInput
                value={codigo}
                onChangeText={(v) => { setCodigo(formatarCodigo(v)); setErro(''); }}
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
              <Text style={[s.contador, { color: tema.texto }]}>
                {digitos}/32 caracteres · pode colar com ou sem traços
              </Text>
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
                  disabled={ocupado || !pronto}
                  style={[s.botao, { backgroundColor: tema.primario, opacity: (ocupado || !pronto) ? 0.45 : 1 }]}
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

          {mostrarNovo && (
            <>
              <Text style={[s.titulo, { color: tema.titulo }]}>Sua chave de segurança</Text>
              <Text style={[s.texto, { color: tema.texto }]}>
                Este é o código da chave que protege o backup. Guarde fora do celular: ele é
                o único jeito de abrir o backup em um aparelho novo. Um outro aparelho que já
                tinha uma chave vai pedir este código uma vez.
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
              <Text style={[s.dica, { color: tema.texto }]}>
                Toque em “Já guardei” para fechar. Sem este código não há recuperação.
              </Text>
            </>
          )}

          {mostrarErro && (
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
  fechar: { position: 'absolute', top: 12, right: 14, zIndex: 2, padding: 4 },
  titulo: { fontSize: 19, fontWeight: '700', marginBottom: 8, paddingRight: 24 },
  texto: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  codigo: {
    fontSize: 16, lineHeight: 24, letterSpacing: 0.6, fontWeight: '700',
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16,
  },
  campo: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15, letterSpacing: 0.5, marginBottom: 6,
  },
  contador: { fontSize: 12, marginBottom: 10 },
  erro: { fontSize: 13, marginBottom: 10 },
  dica: { fontSize: 12, marginTop: 10, textAlign: 'center', opacity: 0.8 },
  linha: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  botao: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  botaoLargo: { marginTop: 6 },
});
