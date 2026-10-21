/**
 * ABA DA IA — chat dedicado do NotaIA, acessível pelo botão ✨ do menu "+"
 * na tela principal das notas.
 *
 * Mesmo motor do painel do editor (responderPergunta + protocolo de ações),
 * mas sem nota aberta: a IA opera o app INTEIRO — criar notas/listas/tarefas/
 * pastas, mover, fixar, apagar, agendar. Cada ação aparece no cartão
 * "Quero fazer isto — permitir?" e só executa pelas funções oficiais dos
 * contexts quando o usuário permite (sync idêntico a uma ação manual).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    Animated, Keyboard, KeyboardAvoidingView, Platform,
    ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNotas } from '../context/NotasContext';
import { useTarefas } from '../context/TarefasContext';
import { useListas } from '../context/ListaContext';
import { useTheme } from '../context/ThemeContext';
import { responderPergunta, type MensagemChat } from '../context/ia-service';
import { extrairAcoes, resumoAcao, executarAcoes, type AcaoIA, type DepsAcoes } from '../context/ia-acoes';
import TextoRico from '../components/ia-texto-rico';
import { appColors } from '../constants/theme';
import { PROXY_IA_ATIVO } from '../constants/ia-proxy';
import { imeHeightAtual, observarIme } from '../modules/minhasnotas-ime';

// ── Bolha do chat (mesma linguagem visual do painel do editor) ─────────────
const BolhaChat = ({ m, isUsuario, tema }: any) => {
    const [entrada] = useState(() => new Animated.Value(0));
    useEffect(() => {
        Animated.spring(entrada, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }).start();
    }, [entrada]);
    return (
        <Animated.View
            style={[
                styles.bolha,
                isUsuario
                    ? { alignSelf: 'flex-end', backgroundColor: tema.accent }
                    : { alignSelf: 'flex-start', backgroundColor: tema.chipFundo, borderColor: tema.chipBorda, borderWidth: 1 },
                { opacity: entrada, transform: [
                    { translateX: entrada.interpolate({ inputRange: [0, 1], outputRange: [isUsuario ? 26 : -26, 0] }) },
                    { scale: entrada.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ] },
            ]}
        >
            {isUsuario || m.erro ? (
                <Text style={[styles.bolhaTexto, isUsuario ? { color: tema.onPrimary } : { color: tema.danger }]}>
                    {m.texto}
                </Text>
            ) : (
                <TextoRico texto={m.texto} cor={tema.sheetTitulo} estilo={styles.bolhaTexto} corDestaque={tema.accent} />
            )}
        </Animated.View>
    );
};

/** Pontinhos "pensando…" — mesma animação da IA do painel das notas (3 pontos
 *  pulando em sequência, com atraso em cascata). */
const TypingDots = ({ cor }: { cor: string }) => {
    const [pontos] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]);
    useEffect(() => {
        const loops = pontos.map((v, i) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(i * 160),
                    Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: true }),
                    Animated.timing(v, { toValue: 0, duration: 260, useNativeDriver: true }),
                    Animated.delay(320),
                ])
            )
        );
        loops.forEach((l) => l.start());
        return () => loops.forEach((l) => l.stop());
    }, [pontos]);
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 }}>
            {pontos.map((v, i) => (
                <Animated.View
                    key={i}
                    style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        backgroundColor: cor,
                        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
                        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
                    }}
                />
            ))}
        </View>
    );
};

export default function TelaIA() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { isDark, config, t } = useTheme();
    const paleta = appColors(isDark);
    const tema = {
        fundo: paleta.background,
        texto: paleta.text,
        placeholder: paleta.placeholder,
        accent: paleta.primary,
        sheetTitulo: paleta.text,
        sheetSub: paleta.muted,
        chipFundo: paleta.surface,
        chipBorda: paleta.border,
        onPrimary: paleta.onPrimary,
        danger: paleta.danger,
    };

    const { notas, pastas, salvarNota, salvarLembreteNota, criarPasta, moverNotasParaPasta, alternarFixarNota, excluirNota } = useNotas();
    const { tarefas, adicionarTarefa, alternarTarefa, excluirTarefa } = useTarefas();
    const { listas, salvarLista, moverListasParaPasta, alternarFixarLista, excluirLista } = useListas();

    const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
    const [pergunta, setPergunta] = useState('');
    const [pensando, setPensando] = useState(false);
    const [acoesIA, setAcoesIA] = useState<AcaoIA[] | null>(null);
    const [executandoAcoes, setExecutandoAcoes] = useState(false);

    const scrollRef = useRef<ScrollView>(null);
    const boasVindasRef = useRef(false);
    if (!boasVindasRef.current) {
        boasVindasRef.current = true;
        setMensagens([{ papel: 'ia', texto: t('Olá! Sou o NotaIA ✨\n\nPosso criar notas, listas, tarefas e pastas, mover, fixar, apagar e agendar lembretes — você sempre confirma antes de eu fazer.\n\nPeça, por exemplo: "cria uma nota de treino" ou "cria uma tarefa de alongar todo dia às 7".') }]);
    }

    // ── Teclado: inset nativo do IME (SwiftKey/barra extra) + eventos RN ────
    const [alturaTeclado, setAlturaTeclado] = useState(0);
    useEffect(() => {
        let vivo = true;
        const aplicar = (h: number) => { if (vivo) setAlturaTeclado(h > 0 ? h : 0); };
        imeHeightAtual().then((h) => { if (h != null) aplicar(h); }).catch(() => {});
        const desObservar = observarIme(aplicar);
        const mostra = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e: any) => aplicar(e.endCoordinates?.height ?? 0));
        const esconde = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => aplicar(0));
        return () => { vivo = false; desObservar(); mostra.remove(); esconde.remove(); };
    }, []);

    const rolarProFim = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);

    // O chat acompanha o teclado: quando ele abre, a conversa rola pro fim
    // (o input fica colado no topo do teclado, nunca escondendo a resposta).
    useEffect(() => {
        if (alturaTeclado > 0) rolarProFim();
    }, [alturaTeclado]);

    // ── Pergunta → IA (motor do editor, sem nota aberta) ───────────────────
    const enviarPergunta = async () => {
        const texto = pergunta.trim();
        if (!texto || pensando) return;
        try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
        setMensagens(prev => [...prev, { papel: 'usuario', texto }]);
        setPergunta('');
        setPensando(true);
        rolarProFim();
        try {
            const chave = config?.chaveIA || '';
            const resposta = await responderPergunta(
                texto, notas || [], chave, mensagens, tarefas || [], config?.idioma ?? 'pt',
                undefined,                       // sem nota aberta: o agente opera o app todo
                pastas || [], listas || [],
            );
            const extraidas = extrairAcoes(resposta.texto);
            const textoLimpo = (extraidas.textoLimpo || '').trim();
            setMensagens(prev => [...prev, {
                papel: 'ia',
                texto: extraidas.acoes?.length
                    ? (textoLimpo || t('Tudo pronto — toque em Permitir para eu fazer.'))
                    // Nunca mostrar JSON cru; se a ação veio inválida, avisa em vez de fingir que fez.
                    : (textoLimpo || t('Entendi o pedido, mas não consegui aplicar. Pode repetir de outro jeito?')),
            }]);
            if (extraidas.acoes?.length) setAcoesIA(extraidas.acoes);
        } catch (e: any) {
            setMensagens(prev => [...prev, { papel: 'ia', texto: t('Desculpe, não consegui responder agora. Tente de novo.'), erro: true }]);
        } finally {
            setPensando(false);
            rolarProFim();
        }
    };

    // ── Executa as ações confirmadas — funções OFICIAIS dos contexts ────────
    const aplicarAcoesIA = async () => {
        if (!acoesIA || executandoAcoes) return;
        setExecutandoAcoes(true);
        try {
            const deps: DepsAcoes = {
                notas, pastas, listas, tarefas,
                salvarNota, criarPasta, moverNotasParaPasta, alternarFixarNota,
                salvarLembreteNota, excluirNota,
                salvarLista, moverListasParaPasta, alternarFixarLista, excluirLista,
                adicionarTarefa, alternarTarefa, excluirTarefa,
                t,
            };
            const resultados = await executarAcoes(acoesIA, deps);
            setAcoesIA(null);
            setMensagens(prev => [...prev, { papel: 'ia', texto: resultados.join('\n') || t('✅ Pronto!') }]);
        } catch (e) {
            setMensagens(prev => [...prev, { papel: 'ia', texto: t('Algumas ações falharam — veja os avisos acima.'), erro: true }]);
        } finally {
            setExecutandoAcoes(false);
            rolarProFim();
        }
    };

    const semChave = !(config?.chaveIA) && !PROXY_IA_ATIVO;

    return (
        <View style={[styles.container, { backgroundColor: tema.fundo, paddingTop: insets.top }]}>
            {/* Cabeçalho */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.botaoVoltar} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={28} color={tema.accent} />
                </TouchableOpacity>
                <View style={styles.tituloWrap}>
                    <Ionicons name="sparkles" size={19} color={tema.accent} />
                    <Text style={[styles.titulo, { color: tema.sheetTitulo }]}>NotaIA</Text>
                </View>
                <View style={{ width: 46 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                enabled={Platform.OS === 'ios' ? true : alturaTeclado > 0}
                keyboardVerticalOffset={0}
            >
                <View style={{ flex: 1, paddingBottom: Platform.OS === 'android' && alturaTeclado > 0 ? alturaTeclado + 18 : Math.max(insets.bottom, 12) }}>
                    {/* Chat */}
                    <ScrollView
                        ref={scrollRef}
                        style={{ flex: 1 }}
                        contentContainerStyle={styles.lista}
                        keyboardShouldPersistTaps="handled"
                        onContentSizeChange={rolarProFim}
                    >
                        {mensagens.map((m, i) => (
                            <BolhaChat key={i} m={m} isUsuario={m.papel === 'usuario'} tema={tema} />
                        ))}
                        {pensando && (
                            <View style={[styles.bolha, { alignSelf: 'flex-start', backgroundColor: tema.chipFundo, borderColor: tema.chipBorda, borderWidth: 1 }]}>
                                <TypingDots cor={tema.accent} />
                            </View>
                        )}

                        {/* Cartão de AÇÕES — só executa com "Permitir tudo" */}
                        {acoesIA && (
                            <View style={[styles.cardAcoes, { backgroundColor: tema.chipFundo, borderColor: tema.accent }]}>
                                <View style={styles.cardAcoesHead}>
                                    <Ionicons name="sparkles" size={18} color={tema.accent} />
                                    <Text style={[styles.cardAcoesTitulo, { color: tema.sheetTitulo }]}>
                                        {t('Quero fazer isto — permitir?')}
                                    </Text>
                                </View>
                                {acoesIA.map((acao, i) => (
                                    <Text key={i} style={[styles.cardAcaoLinha, { color: tema.sheetSub }]}>
                                        {resumoAcao(acao, { notas, pastas, listas, tarefas } as Partial<DepsAcoes>)}
                                    </Text>
                                ))}
                                <View style={styles.cardAcoesBotoes}>
                                    <TouchableOpacity
                                        style={[styles.botaoPermitir, { backgroundColor: tema.accent, opacity: executandoAcoes ? 0.6 : 1 }]}
                                        onPress={aplicarAcoesIA} disabled={executandoAcoes} activeOpacity={0.8}>
                                        <Ionicons name="checkmark" size={17} color={tema.onPrimary} />
                                        <Text style={[styles.botaoPermitirTexto, { color: tema.onPrimary }]}>
                                            {executandoAcoes ? t('Aplicando…') : t('Permitir tudo')}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.botaoNegar, { borderColor: tema.chipBorda }]}
                                        onPress={() => setAcoesIA(null)} disabled={executandoAcoes} activeOpacity={0.8}>
                                        <Text style={[styles.botaoNegarTexto, { color: tema.sheetSub }]}>{t('Não permitir')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </ScrollView>

                    {/* Aviso sem chave (discreto — o chat offline continua funcionando) */}
                    {semChave && (
                        <Text style={[styles.semChave, { color: tema.sheetSub }]}>
                            {t('(sem chave de IA — respondo offline pelo app. Adicione a chave grátis em Ajustes → IA)')}
                        </Text>
                    )}

                    {/* Barra de entrada */}
                    <View style={[styles.barraEntrada, { borderColor: tema.chipBorda }]}>
                        <TextInput
                            style={[styles.input, { color: tema.texto, borderColor: tema.chipBorda }]}
                            value={pergunta}
                            onChangeText={setPergunta}
                            placeholder={t('Pergunte ou peça algo… ex.: "cria uma nota de treino"')}
                            placeholderTextColor={tema.placeholder}
                            multiline
                            onFocus={rolarProFim}
                        />
                        <TouchableOpacity
                            style={[styles.botaoEnviar, { backgroundColor: pergunta.trim() && !pensando ? tema.accent : tema.chipFundo, borderColor: tema.accent }]}
                            onPress={enviarPergunta}
                            disabled={!pergunta.trim() || pensando}
                            activeOpacity={0.8}>
                            <Ionicons name="arrow-up" size={22} color={pergunta.trim() && !pensando ? tema.onPrimary : tema.accent} />
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4 },
    botaoVoltar: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    tituloWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    titulo: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
    lista: { paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
    bolha: {
        maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
        marginVertical: 2,
    },
    bolhaTexto: { fontSize: 15, lineHeight: 21 },
    cardAcoes: {
        alignSelf: 'stretch', marginTop: 10, padding: 14, borderRadius: 16,
        borderWidth: 1.5,
    },
    cardAcoesHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    cardAcoesTitulo: { fontWeight: '700', fontSize: 14.5, flex: 1 },
    cardAcaoLinha: { fontSize: 13.5, lineHeight: 19, marginBottom: 3 },
    cardAcoesBotoes: { flexDirection: 'row', gap: 8, marginTop: 10 },
    botaoPermitir: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
    botaoPermitirTexto: { fontWeight: '700', fontSize: 14 },
    botaoNegar: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, backgroundColor: 'transparent' },
    botaoNegarTexto: { fontWeight: '600', fontSize: 14 },
    semChave: { fontSize: 11.5, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 6, opacity: 0.8 },
    barraEntrada: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, gap: 8 },
    input: {
        flex: 1, minHeight: 46, maxHeight: 130, borderRadius: 16, borderWidth: 1,
        paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, paddingTop: Platform.OS === 'ios' ? 12 : 10,
    },
    botaoEnviar: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
