import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert,
    Animated,
    AppState, BackHandler, Dimensions,
    Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, UIManager, View
} from 'react-native';
import { responderPergunta, resumirNotaComIA, type MensagemChat } from '../context/ia-service';
import { useNotas } from '../context/NotasContext';
import { useTheme } from '../context/ThemeContext';
import { bloqueioEstado } from '../context/bloqueio-estado';
import { DIAS_SEMANA, resumoLembrete, type LembreteNota, type TipoLembrete } from '../context/lembrete-notas';
import { useMonetizacao } from '../context/monetizacao';
import { appColors } from '../constants/theme';
import RichTextEditor, { FormatoAtivo, RichTextEditorHandle } from '../components/rich-text-editor';
import * as Haptics from 'expo-haptics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Diretórios de anexos no armazenamento do app (API nova do expo-file-system)
const DIR_IMAGENS = new Directory(Paths.document, 'imagens_notas');
const DIR_AUDIOS = new Directory(Paths.document, 'audios_notas');

const FORMATO_INICIAL: FormatoAtivo = {
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    unorderedList: false,
    orderedList: false,
};

// Detecta anexos (imagem/áudio) no conteúdo da nota — mostra o botão "Continuar no fim"
const TEM_ANEXO = /<img|<audio|\[Imagem anexada:|\[Áudio anexado:/i;

// Transição suave das seções do lembrete (Data / A cada X dias / Dias da semana)
const LAYOUT_LEMBRETE = {
    duration: 280,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

// Bolha de mensagem com animação de entrada (desliza + fade + leve escala)
const BolhaChatAnimada = ({ m, isUsuario, tema }: any) => {
    const [entrada] = useState(() => new Animated.Value(0));
    useEffect(() => {
        Animated.spring(entrada, {
            toValue: 1,
            friction: 7,
            tension: 70,
            useNativeDriver: true,
        }).start();
    }, [entrada]);
    const estiloEntrada = {
        opacity: entrada,
        transform: [
            { translateX: entrada.interpolate({ inputRange: [0, 1], outputRange: [isUsuario ? 26 : -26, 0] }) },
            { scale: entrada.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
        ],
    };
    return (
        <Animated.View
            style={[
                styles.bolhaChat,
                isUsuario
                    ? { alignSelf: 'flex-end', backgroundColor: tema.accent }
                    : { alignSelf: 'flex-start', backgroundColor: tema.chipFundo, borderColor: tema.chipBorda, borderWidth: 1 },
                estiloEntrada,
            ]}
        >
            <Text
                style={[
                    styles.bolhaChatTexto,
                    isUsuario ? { color: tema.onPrimary } : { color: m.erro ? tema.danger : tema.sheetTitulo },
                ]}
            >
                {m.texto}
            </Text>
        </Animated.View>
    );
};

// Indicador de digitação da IA: 3 pontinhos pulando em sequência
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

export default function EditorScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { notas, salvarNota, salvarLembreteNota } = useNotas();
    const { isDark, config } = useTheme();
    const { mostrarAnuncio } = useMonetizacao();

    // Impede salvamento duplo (ex.: toque duplo em "Pronto" ou Pronto + botão voltar)
    const salvandoRef = useRef(false);
    // HTML mais recente do editor rico (garante salvar a última digitação)
    const conteudoRef = useRef('');
    const editorRef = useRef<RichTextEditorHandle>(null);

    // Id resolvido da nota: o da rota (nota existente) ou, para nota NOVA, o
    // id criado na hora em que o sino é usado pela primeira vez.
    const [idNotaCriada, setIdNotaCriada] = useState<string | undefined>(undefined);
    const idEditor = params.id ? String(params.id) : idNotaCriada;
    // Garante que a busca no array não quebre se "notas" estiver indefinido
    const notaExistente = (notas || []).find((n: any) => n.id === idEditor);

    const [titulo, setTitulo] = useState('');
    const [protegida, setProtegida] = useState(false);
    // Notas EXISTENTES abrem em modo de VISUALIZAÇÃO (leitura); notas novas abrem
    // direto no editor. O usuário toca em "Editar" para entrar no editor padrão.
    const [editando, setEditando] = useState<boolean>(() => !params.id);
    const [carregandoImagem, setCarregandoImagem] = useState(false);
    const [gravando, setGravando] = useState(false);
    // Lembrete de revisão da nota (modal)
    const [modalLembreteAberto, setModalLembreteAberto] = useState(false);
    const [rTipo, setRTipo] = useState<TipoLembrete>('data');
    const [rData, setRData] = useState('');
    const [rDias, setRDias] = useState(3);
    const [rDiasSemana, setRDiasSemana] = useState<string[]>([]);
    const [rHorario, setRHorario] = useState('08:00');
    const [mostrarHora, setMostrarHora] = useState(false);
    const [mostrarData, setMostrarData] = useState(false);
    // Estado de formatação ativa na seleção (negrito/itálico/listas...) da toolbar
    const [fmt, setFmt] = useState<FormatoAtivo>(FORMATO_INICIAL);
    // --- IA (assistente de perguntas/resumo) ---
    const [modalIAAberto, setModalIAAberto] = useState(false);
    const [abaIA, setAbaIA] = useState<'perguntar' | 'resumo'>('perguntar');
    const [perguntaIA, setPerguntaIA] = useState('');
    const [mensagensIA, setMensagensIA] = useState<MensagemChat[]>([]);
    const [chatPensando, setChatPensando] = useState(false);
    const [resumoPensando, setResumoPensando] = useState(false);
    const [resumoIA, setResumoIA] = useState<string | null>(null);
    // Deslocamento da sheet da IA quando o teclado abre (Android)
    // Animações: botão de enviar da IA, entrada da sheet do lembrete e da faixa do lembrete
    const [animaEnviarIA] = useState(() => new Animated.Value(1));
    const [animaSheetLembrete] = useState(() => new Animated.Value(0));
    const [animaLembreteRow] = useState(() => new Animated.Value(0));
    const [animaBotaoFim] = useState(() => new Animated.Value(0));
    // Botão circular "ir para o fim": escala de clique, anel de sonar, seta que cai e hop
    const [animaEscala] = useState(() => new Animated.Value(1));
    const [animaAnel] = useState(() => new Animated.Value(0));
    const [animaSeta] = useState(() => new Animated.Value(0));
    const [animaHop] = useState(() => new Animated.Value(0));
    const chatScrollRef = useRef<ScrollView>(null);
    // Botão circular "ir para o fim" — aparece quando a nota tem anexos e o fim
    // ainda não está à vista; some ao chegar no fim (maxScroll vem do WebView)
    const [temAnexo, setTemAnexo] = useState(false);
    const [mostrarBotao, setMostrarBotao] = useState(false);
    // Altura real do teclado (Android). O KeyboardAvoidingView do RN, no Android,
    // recalcula o padding com as coordenadas do evento 'keyboardDidHide' — que
    // neste aparelho reportam um teclado "fantasma" de ~155px (faixa branca) e,
    // quando o teclado "pisca" (ex.: diálogo de permissão do microfone leva o app
    // a background), os eventos podem se perder ou vir com altura 0 — a toolbar
    // ficava dentro do teclado. Aqui a altura vem DIRETA dos eventos (0 no hide,
    // altura real no show, ignorando eventos com 0 ou inflados). Ao voltar do
    // background, recupera-se usando a MELHOR altura já vista nos eventos — os
    // valores crus do Keyboard.metrics()/insets do IME são instáveis (parciais
    // ~276px ou inflados) e NÃO são aplicados diretamente. Sem gambiarra de
    // posição absoluta.
    const [alturaTeclado, setAlturaTeclado] = useState(() => {
        // Inicializa com o metrics() SÓ se for plausível (os valores parciais
        // como ~276px ou inflados são ignorados — os eventos corrigem logo).
        if (Platform.OS !== 'android' || !Keyboard.isVisible()) return 0;
        const h = Keyboard.metrics()?.height ?? 0;
        const teto = Math.round(Dimensions.get('window').height * 0.6);
        return h > 0 && h <= teto ? h : 0;
    });
    // Melhor (maior) altura real do teclado já vista nos eventos — a altura é
    // constante no aparelho; os eventos parciais durante a animação são menores.
    const melhorAlturaTecladoRef = useRef(0);
    useEffect(() => {
        if (Platform.OS !== 'android') return;
        // Teto defensivo: nenhum teclado ocupa mais de ~60% da tela — valores
        // acima disso são eventos corrompidos e são ignorados.
        const ALTURA_MAX = Math.round(Dimensions.get('window').height * 0.6);
        const show = Keyboard.addListener('keyboardDidShow', (e) => {
            const h = e.endCoordinates.height;
            if (h > 0 && h <= ALTURA_MAX) {
                melhorAlturaTecladoRef.current = Math.max(melhorAlturaTecladoRef.current, h);
                setAlturaTeclado(h);
            }
        });
        const hide = Keyboard.addListener('keyboardDidHide', () => setAlturaTeclado(0));
        // Ao voltar do background (ex.: diálogo de permissão do microfone), os
        // eventos podem se perder (teclado aberto com altura 0). Recupera com a
        // MELHOR altura vista nos eventos — nunca valores crus do metrics/IME.
        const appStateSub = AppState.addEventListener('change', (estado) => {
            if (estado !== 'active') return;
            setTimeout(() => {
                setAlturaTeclado((atual) => {
                    if (atual > 0 || !Keyboard.isVisible()) return atual;
                    return melhorAlturaTecladoRef.current > 0 ? melhorAlturaTecladoRef.current : atual;
                });
            }, 350);
        });
        return () => { show.remove(); hide.remove(); appStateSub.remove(); };
    }, []);
    // A IA de verdade só funciona com chave configurada
    const temChaveIA = !!config?.chaveIA;
    // Gravador gerenciado pelo hook (liberado automaticamente ao desmontar o editor)
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    const paleta = appColors(isDark);
    const tema = {
        fundo: paleta.background,
        texto: paleta.text,
        placeholder: paleta.placeholder,
        toolbar: paleta.surface,
        accent: paleta.primary,
        primarySoft: paleta.primarySoft,
        // Modal do lembrete (tema claro/escuro)
        sheetFundo: paleta.background,
        sheetBorda: paleta.border,
        sheetHandle: paleta.border,
        sheetTitulo: paleta.text,
        sheetSub: paleta.muted,
        botaoFecharFundo: paleta.surfaceElevated,
        botaoFecharIcone: paleta.text,
        chipFundo: paleta.surface,
        chipBorda: paleta.border,
        chipTextoInativo: paleta.muted,
        opcaoFundo: paleta.surface,
        opcaoBorda: paleta.border,
        opcaoLabel: paleta.text,
        removerFundo: paleta.dangerSoft,
        onPrimary: paleta.onPrimary,
        danger: paleta.danger,
    };

    // O teclado é tratado do jeito certo: no Android o editor é uma tela modal
    // (a janela NÃO redimensiona com o teclado neste aparelho — verificado), então
    // a altura REAL do teclado (alturaTeclado) vira paddingBottom do container e a
    // toolbar no fluxo sobe junto — re-sincronizada ao voltar do background via
    // getImeHeight (nativo) + eventos do RN. No iOS o KeyboardAvoidingView com
    // behavior 'padding' cuida do recuo.

    // Carregamento inicial seguro da nota
    useEffect(() => {
        // Nota: NÃO resetar salvandoRef aqui — após salvar, notaExistente troca de
        // referência e re-rodaria este efeito, reabrindo a janela de salvamento duplo.
        const timer = setTimeout(() => {
            if (notaExistente) {
                setTitulo(notaExistente.titulo || '');
                const conteudo = notaExistente.conteudo || '';
                if (conteudoRef.current !== conteudo) {
                    conteudoRef.current = conteudo;
                    // Apenas se o conteúdo mudou por fora (evita re-injeção ao abrir)
                    editorRef.current?.setContent(conteudo);
                }
                setProtegida(!!notaExistente.protegida);
                const tem = TEM_ANEXO.test(conteudo);
                setTemAnexo(prev => (prev === tem ? prev : tem));
            } else {
                setTitulo('');
                conteudoRef.current = '';
                setProtegida(false);
                setEditando(true);
                setTemAnexo(false);
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [params.id, notaExistente]);

    // Sincroniza o modo leitura/edição com o WebView (contenteditable) ao alternar
    useEffect(() => {
        editorRef.current?.setEditable(editando);
    }, [editando]);

    // Criação segura das pastas locais (API nova do expo-file-system)
    useEffect(() => {
        const garantirPasta = async () => {
            try {
                if (!DIR_IMAGENS.exists) {
                    await DIR_IMAGENS.create({ intermediates: true, idempotent: true });
                }
                if (!DIR_AUDIOS.exists) {
                    await DIR_AUDIOS.create({ intermediates: true, idempotent: true });
                }
            } catch (e) {
                console.warn("Erro ao configurar diretórios de armazenamento", e);
            }
        };
        garantirPasta();
    }, []);

    // Mantém o HTML mais recente do editor rico no ref (para salvar com segurança).
    // NÃO há estado aqui: digitar não re-renderiza a tela (o WebView é não-controlado).
    const handleConteudoChange = useCallback((html: string) => {
        conteudoRef.current = html;
        const tem = TEM_ANEXO.test(html);
        setTemAnexo(prev => (prev === tem ? prev : tem));
    }, []);

    // Atualiza os estados ativos dos botões da toolbar (negrito, listas etc.)
    const handleFormatoChange = useCallback((f: FormatoAtivo) => {
        setFmt((prev) => {
            if (
                prev.bold === f.bold &&
                prev.italic === f.italic &&
                prev.underline === f.underline &&
                prev.strikeThrough === f.strikeThrough &&
                prev.unorderedList === f.unorderedList &&
                prev.orderedList === f.orderedList
            ) {
                return prev;
            }
            return f;
        });
    }, []);

    // Insere uma imagem/áudio de verdade (com bordas arredondadas / player) no fim da nota
    const anexarImagem = useCallback((uri: string, nome: string) => {
        const html = `<br><img src="${uri}" alt="${nome}" class="anexo-img"><br>`;
        conteudoRef.current += html;
        editorRef.current?.appendContent(html);
    }, []);

    const anexarAudio = useCallback((uri: string, nome: string) => {
        const html = `<br><audio controls src="${uri}" class="anexo-audio"></audio><br>`;
        conteudoRef.current += html;
        editorRef.current?.appendContent(html);
    }, []);

    const iniciarGravacao = async () => {
        // O diálogo de permissão do sistema derruba o app para background — sem
        // suspender o bloqueio, a biometria travaria o meio da gravação.
        bloqueioEstado.ativar();
        try {
            const { granted } = await requestRecordingPermissionsAsync();
            if (!granted) return Alert.alert("Erro", "Permissão negada.");

            // O modo de áudio pode falhar em casos específicos — não impede a gravação
            try {
                await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
            } catch (e) {
                console.warn("[Audio] Aviso ao configurar modo de áudio:", e);
            }

            await audioRecorder.prepareToRecordAsync();
            audioRecorder.record();
            setGravando(true);
        } catch (err) {
            console.error("[Audio] Erro ao iniciar a gravação:", err);
            Alert.alert("Erro", "Não foi possível iniciar a gravação.");
        } finally {
            bloqueioEstado.liberar();
        }
    };

    const pararGravacao = async () => {
        if (!gravando) return;
        setGravando(false);
        let uri: string | null = null;
        try {
            await audioRecorder.stop();
            uri = audioRecorder.uri || null;
        } catch (error) {
            // O stop() pode rejeitar no Android MESMO com o arquivo salvo — tenta recuperar a URI
            console.error("[Audio] Erro no stop (tentando recuperar o áudio):", error);
            try { uri = audioRecorder.uri || null; } catch { uri = null; }
        }
        if (uri) {
            try {
                const nomeArquivo = `audio_${Date.now()}.m4a`;
                const destino = new File(DIR_AUDIOS, nomeArquivo);
                await new File(uri).move(destino, { overwrite: true });
                anexarAudio(destino.uri, nomeArquivo);
            } catch (error) {
                // Só mostra erro se realmente não conseguiu salvar o arquivo
                console.error("[Audio] Erro ao salvar o arquivo:", error);
                if (audioRecorder.isRecording) setGravando(true);
                Alert.alert("Erro", "Falha ao salvar o áudio.");
            }
        } else {
            if (audioRecorder.isRecording) setGravando(true);
            Alert.alert("Erro", "Nada foi gravado.");
        }
    };

    // --- LEMBRETE DE REVISÃO ---
    const formatarHora = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const formatarData = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const horaComoDate = (h: string) => {
        const [hh, mm] = h.split(':').map(Number);
        const d = new Date();
        d.setHours(hh || 0, mm || 0, 0, 0);
        return d;
    };

    const abrirIA = () => {
        setAbaIA('perguntar');
        setPerguntaIA('');
        setMensagensIA([]);
        setResumoIA(null);
        setModalIAAberto(true);
    };
    // A sheet da IA acompanha o teclado pelo KeyboardAvoidingView do modal
    // (behavior 'padding', com gate pela altura do teclado no Android) — o
    // modal tem janela própria, então o gate garante o reset determinístico.

    const pulsarEnviarIA = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.sequence([
            Animated.timing(animaEnviarIA, { toValue: 1.22, duration: 110, useNativeDriver: true }),
            Animated.spring(animaEnviarIA, { toValue: 1, friction: 4, useNativeDriver: true }),
        ]).start();
    };

    const fazerPerguntaIA = async () => {
        if (!temChaveIA) return;
        const texto = perguntaIA.trim();
        if (!texto || chatPensando) return;
        pulsarEnviarIA();
        const novaPergunta: MensagemChat = { papel: 'usuario', texto };
        setMensagensIA(prev => [...prev, novaPergunta]);
        setPerguntaIA('');
        setChatPensando(true);
        try {
            const resposta = await responderPergunta(texto, notas || [], config?.chaveIA || '', mensagensIA);
            setMensagensIA(prev => [...prev, { papel: 'ia', texto: resposta.texto }]);
        } catch (e) {
            setMensagensIA(prev => [...prev, { papel: 'ia', texto: 'Desculpe, não consegui responder agora. Tente de novo.', erro: true }]);
        } finally {
            setChatPensando(false);
        }
    };

    const gerarResumoIA = async () => {
        if (!temChaveIA) return;
        setResumoPensando(true);
        setResumoIA(null);
        try {
            const nota = notaExistente
                ? notaExistente
                : { titulo, conteudo: conteudoRef.current };
            const resposta = await resumirNotaComIA(nota, config?.chaveIA || '');
            setResumoIA(resposta.texto);
        } catch (e) {
            setResumoIA('Não consegui gerar o resumo agora. Tente de novo.');
        } finally {
            setResumoPensando(false);
        }
    };

    // Garante a permissão de notificação (obrigatória no Android 13+ e iOS),
    // espelhando o que já é feito ao criar uma tarefa com alarme.
    const garantirPermissaoNotificacoes = async () => {
        try {
            const permissao = await Notifications.getPermissionsAsync();
            if (permissao.granted) return;
            const pedido = await Notifications.requestPermissionsAsync();
            if (!pedido.granted) {
                Alert.alert(
                    "Notificações desativadas",
                    "Permita as notificações nas configurações do aparelho para receber os lembretes das notas."
                );
            }
        } catch (e) {
            console.warn("[Notificações] Falha ao pedir permissão:", e);
        }
    };

    const abrirModalLembrete = async () => {
        // O diálogo de permissão do sistema leva o app para background — sem
        // suspender o bloqueio, a biometria travaria ao voltar.
        bloqueioEstado.ativar();
        try {
            await garantirPermissaoNotificacoes();
        } finally {
            bloqueioEstado.liberar();
        }
        // Nota NOVA (sem id ainda): salva a nota AGORA para poder anexar o
        // lembrete — o sino funciona já na primeira edição, sem precisar sair,
        // salvar e voltar para editar de novo.
        if (!params.id && !idNotaCriada) {
            const novoId = salvarNota(titulo, conteudoRef.current, undefined, protegida);
            setIdNotaCriada(novoId);
        }
        const l = notaExistente?.lembrete;
        setRTipo(l?.tipo ?? 'data');
        setRData(l?.data ?? '');
        setRDias(l?.intervaloDias ?? 3);
        setRDiasSemana(l?.diasSemana ?? []);
        setRHorario(l?.horario ?? '08:00');
        setModalLembreteAberto(true);
    };

    // Anima a entrada da sheet do lembrete quando o modal abre
    useEffect(() => {
        if (modalLembreteAberto) {
            animaSheetLembrete.setValue(0);
            Animated.spring(animaSheetLembrete, {
                toValue: 1,
                friction: 7,
                tension: 65,
                useNativeDriver: true,
            }).start();
        }
    }, [modalLembreteAberto, animaSheetLembrete]);

    // Entrada suave da faixa do lembrete quando a nota tem lembrete
    useEffect(() => {
        if (notaExistente?.lembrete) {
            animaLembreteRow.setValue(0);
            Animated.spring(animaLembreteRow, {
                toValue: 1,
                friction: 7,
                tension: 60,
                useNativeDriver: true,
            }).start();
        }
    }, [notaExistente?.lembrete, animaLembreteRow]);

    // Visibilidade do botão circular "ir para o fim": entra com bounce + anel de
    // sonar + seta caindo; some suavemente quando o fim da nota está à vista.
    // Tudo com driver NATIVO — o botão tem posição fixa (bottom: 78; o container
    // encolhe com o teclado via KeyboardAvoidingView), então não há animação JS
    // no mesmo nó (o crash antigo era do Animated.add do teclado).
    useEffect(() => {
        if (!mostrarBotao) {
            Animated.spring(animaBotaoFim, {
                toValue: 0,
                friction: 7,
                tension: 40,
                useNativeDriver: true,
            }).start();
            return;
        }
        // Entrada: bounce + anel de sonar + seta que cai (levemente atrasada)
        Animated.spring(animaBotaoFim, {
            toValue: 1,
            friction: 7,
            tension: 110,
            useNativeDriver: true,
        }).start();
        animaAnel.setValue(0);
        Animated.timing(animaAnel, { toValue: 1, duration: 650, useNativeDriver: true }).start();
        animaSeta.setValue(0);
        const t = setTimeout(() => {
            Animated.spring(animaSeta, { toValue: 1, friction: 4, tension: 150, useNativeDriver: true }).start();
        }, 100);
        return () => clearTimeout(t);
    }, [mostrarBotao, animaBotaoFim, animaAnel, animaSeta]);

    // Clique: aperta (encolhe), seta pula para baixo e volta com mola — e o botão
    // some na hora (rolar até o fim é o estado final; ele reaparece ao subir).
    const irParaOFim = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setMostrarBotao(false);
        Animated.sequence([
            Animated.timing(animaEscala, { toValue: 0.84, duration: 90, useNativeDriver: true }),
            Animated.spring(animaEscala, { toValue: 1, friction: 3, tension: 300, useNativeDriver: true }),
        ]).start();
        animaHop.setValue(0);
        Animated.sequence([
            Animated.timing(animaHop, { toValue: 1, duration: 110, useNativeDriver: true }),
            Animated.timing(animaHop, { toValue: 0, duration: 170, useNativeDriver: true }),
        ]).start();
        editorRef.current?.prepararEscrita();
    };

    // Última posição de rolagem (só usada dentro do callback, nunca no render).
    const ultimoYRef = useRef(0);

    const aoRolarEditor = useCallback((y: number, maxScroll: number) => {
        const subiu = y < ultimoYRef.current - 8;
        ultimoYRef.current = y;
        setMostrarBotao((mostrando) => {
            // Chegou no fim → some; no topo ou subindo → aparece; senão mantém o estado
            // (assim o teclado abrir/fechar não faz o botão piscar de volta no fim).
            if (y >= maxScroll - 150) return false;
            if (y < 40 || subiu) return true;
            return mostrando;
        });
    }, []);

    const mudarTipoLembrete = (m: TipoLembrete) => {
        Haptics.selectionAsync();
        LayoutAnimation.configureNext(LAYOUT_LEMBRETE);
        setRTipo(m);
    };

    const mudarDiasLembrete = (n: number) => {
        Haptics.selectionAsync();
        LayoutAnimation.configureNext(LAYOUT_LEMBRETE);
        setRDias(n);
    };

    const alternarDia = (dia: string) => {
        Haptics.selectionAsync();
        LayoutAnimation.configureNext(LAYOUT_LEMBRETE);
        setRDiasSemana(prev => prev.includes(dia) ? prev.filter(d => d !== dia) : [...prev, dia]);
    };

    const salvarLembrete = async () => {
        if (rTipo === 'data' && !rData) return Alert.alert('Falta o dia', 'Escolha a data do lembrete.');
        if (rTipo === 'semana' && rDiasSemana.length === 0) return Alert.alert('Faltam os dias', 'Escolha pelo menos um dia da semana.');
        if (rTipo === 'data') {
            // Data no passado (ou hoje com o horário já passado) nunca dispararia — avisa em vez de salvar mudo.
            const alvo = new Date(rData + 'T' + rHorario + ':00');
            if (alvo.getTime() <= Date.now()) {
                return Alert.alert('Horário no passado', 'Escolha uma data e horário futuros para o lembrete.');
            }
        }
        const lembrete: LembreteNota = {
            tipo: rTipo,
            data: rTipo === 'data' ? rData : undefined,
            intervaloDias: rTipo === 'dias' ? rDias : undefined,
            diasSemana: rTipo === 'semana' ? rDiasSemana : undefined,
            horario: rHorario,
        };
        // Id da nota: o da rota ou o criado agora pelo sino (nota nova)
        const idAlvo = params.id ? String(params.id) : idNotaCriada;
        // Anúncio curto ao criar um NOVO lembrete (a nota ainda não tinha um).
        // Se a nota acabou de ser criada pelo sino, o anúncio da criação já
        // foi mostrado — não mostra outro.
        const tinhaLembrete = !!notaExistente?.lembrete;
        if (idAlvo) await salvarLembreteNota(idAlvo, lembrete);
        if (!tinhaLembrete && params.id) mostrarAnuncio();
        setModalLembreteAberto(false);
    };

    const removerLembrete = async () => {
        const idAlvo = params.id ? String(params.id) : idNotaCriada;
        if (idAlvo) await salvarLembreteNota(idAlvo, null);
        setModalLembreteAberto(false);
    };

    const handleToggleProtecao = async () => {
        try {
            if (protegida) {
                const autenticado = await LocalAuthentication.authenticateAsync({
                    promptMessage: 'Confirme para remover a proteção desta nota',
                    fallbackLabel: 'Usar senha',
                });
                if (autenticado.success) setProtegida(false);
            } else {
                setProtegida(true);
            }
        } catch (e) {
            console.warn("Erro ao autenticar biometricamente", e);
        }
    };

    const finalizarESalvar = useCallback(async () => {
        if (salvandoRef.current) return; // já está salvando/navegando
        salvandoRef.current = true;
        if (editando && salvarNota) {
            // Nota nova sem lembrete: sem id → o contexto cria a nota.
            // Nota criada pelo sino / nota existente: passa o id → atualiza
            // (evita criar nota duplicada ao finalizar).
            const idFinal = params.id ? String(params.id) : idNotaCriada;
            salvarNota(titulo, conteudoRef.current, idFinal, protegida);
            setEditando(false);
        }
        router.back();
    }, [titulo, params.id, salvarNota, router, editando, protegida]);

    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                // Salva (se ainda não salvou) e volta — tanto para notas novas quanto existentes
                finalizarESalvar();
                return true;
            };
            const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => subscription.remove();
        }, [finalizarESalvar, editando, params.id, router])
    );

    const selecionarImagem = async () => {
        // O seletor de fotos do sistema abre por cima do app (background). Sem
        // suspender o bloqueio, a biometria travaria ao voltar do seletor.
        bloqueioEstado.ativar();
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return Alert.alert("Erro", "Permissão necessária.");

            const resultado = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.6,
            });

            if (!resultado.canceled && resultado.assets && resultado.assets[0]) {
                setCarregandoImagem(true);
                try {
                    const manip = await ImageManipulator.manipulateAsync(
                        resultado.assets[0].uri,
                        [{ resize: { width: 800 } }],
                        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
                    );
                    const nomeImagem = `img_${Date.now()}.jpg`;
                    const destino = new File(DIR_IMAGENS, nomeImagem);
                    await new File(manip.uri).move(destino, { overwrite: true });

                    anexarImagem(destino.uri, nomeImagem);
                } catch (e) {
                    Alert.alert("Erro", "Não foi possível carregar a imagem.");
                } finally {
                    setCarregandoImagem(false);
                }
            }
        } finally {
            bloqueioEstado.liberar();
        }
    };

    const aplicarFormato = (cmd: string) => editorRef.current?.execCommand(cmd);

    const corAtiva = tema.primarySoft;
    const estiloAtivo = (ativo: boolean) => (ativo ? { backgroundColor: corAtiva, borderColor: tema.accent } : null);
    const corBotao = (ativo: boolean) => (ativo ? tema.accent : tema.texto);

    const renderToolbar = () => (
        <View style={[styles.toolbarWrapper, { backgroundColor: tema.toolbar, borderColor: tema.sheetBorda }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarScroll}>
                <TouchableOpacity onPress={() => aplicarFormato('bold')} style={[styles.btnToolbarExtra, estiloAtivo(fmt.bold)]}>
                    <MaterialCommunityIcons name="format-bold" size={22} color={corBotao(fmt.bold)} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => aplicarFormato('italic')} style={[styles.btnToolbarExtra, estiloAtivo(fmt.italic)]}>
                    <MaterialCommunityIcons name="format-italic" size={22} color={corBotao(fmt.italic)} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => aplicarFormato('underline')} style={[styles.btnToolbarExtra, estiloAtivo(fmt.underline)]}>
                    <MaterialCommunityIcons name="format-underline" size={22} color={corBotao(fmt.underline)} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => aplicarFormato('strikeThrough')} style={[styles.btnToolbarExtra, estiloAtivo(fmt.strikeThrough)]}>
                    <MaterialCommunityIcons name="format-strikethrough-variant" size={22} color={corBotao(fmt.strikeThrough)} />
                </TouchableOpacity>

                <View style={styles.divisorToolbar} />

                <TouchableOpacity onPress={() => aplicarFormato('insertUnorderedList')} style={[styles.btnToolbarExtra, estiloAtivo(fmt.unorderedList)]}>
                    <MaterialCommunityIcons name="format-list-bulleted" size={22} color={corBotao(fmt.unorderedList)} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => aplicarFormato('insertOrderedList')} style={[styles.btnToolbarExtra, estiloAtivo(fmt.orderedList)]}>
                    <MaterialCommunityIcons name="format-list-numbered" size={22} color={corBotao(fmt.orderedList)} />
                </TouchableOpacity>

                <View style={styles.divisorToolbar} />

                <TouchableOpacity onPress={gravando ? pararGravacao : iniciarGravacao} style={styles.btnToolbarExtra}>
                    <Ionicons name={gravando ? "stop-circle" : "mic"} size={22} color={gravando ? "#FF3B30" : tema.accent} />
                </TouchableOpacity>
                <TouchableOpacity onPress={selecionarImagem} style={styles.btnToolbarExtra}>
                    <Ionicons name="image" size={22} color={tema.accent} />
                </TouchableOpacity>
            </ScrollView>
        </View>
    );

    return (
        <KeyboardAvoidingView
            style={[
                styles.container,
                { backgroundColor: tema.fundo },
                // Folga de 12px entre a toolbar e o topo do teclado (só com o
                // teclado aberto — fechado mantém a posição padrão no rodapé).
                Platform.OS === 'android' && {
                    paddingBottom: alturaTeclado > 0 ? alturaTeclado + 12 : 0,
                },
            ]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
        >
            {gravando && (
                <View style={[styles.statusGravando, { backgroundColor: tema.danger }]}>
                    <ActivityIndicator size="small" color={tema.onPrimary} />
                    <Text style={styles.txtGravando}>Gravando...</Text>
                </View>
            )}

            <View style={styles.navBar}>
                <TouchableOpacity
                    style={[styles.btnVoltar, { backgroundColor: tema.toolbar }]}
                    onPress={() => editando ? finalizarESalvar() : router.back()}
                >
                    <Ionicons name="chevron-back" size={32} color={tema.accent} />
                    <Text style={[styles.txtVoltar, { color: tema.accent }]}>Notas</Text>
                </TouchableOpacity>

                <View style={styles.navActions}>
                    <TouchableOpacity onPress={abrirIA} style={[styles.navIconButton, { backgroundColor: tema.toolbar }]} activeOpacity={0.7}>
                        <Ionicons name="sparkles" size={21} color={tema.accent} />
                    </TouchableOpacity>
                    {editando && (
                        <TouchableOpacity onPress={abrirModalLembrete} style={[styles.navIconButton, { backgroundColor: tema.toolbar }]} activeOpacity={0.7}>
                            <Ionicons
                                name={notaExistente?.lembrete ? "notifications" : "notifications-outline"}
                                size={22}
                                color={notaExistente?.lembrete ? tema.accent : tema.placeholder}
                            />
                        </TouchableOpacity>
                    )}
                    {(config && config.protegerNotasIndividuais === true) && editando && (
                        <TouchableOpacity onPress={handleToggleProtecao} style={[styles.navIconButton, { backgroundColor: tema.toolbar }]} activeOpacity={0.7}>
                            <Ionicons
                                name={protegida ? "lock-closed" : "lock-open-outline"}
                                size={22}
                                color={protegida ? tema.accent : tema.placeholder}
                            />
                        </TouchableOpacity>
                    )}
                    {editando ? (
                        <TouchableOpacity onPress={finalizarESalvar} style={[styles.btnProntoSuperior, { backgroundColor: tema.accent }]} activeOpacity={0.8}>
                            <Text style={[styles.txtProntoSuperior, { color: tema.onPrimary }]}>Pronto</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            onPress={() => setEditando(true)}
                            style={[styles.btnProntoSuperior, { backgroundColor: tema.accent, flexDirection: 'row', alignItems: 'center' }]}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="pencil" size={17} color={tema.onPrimary} />
                            <Text style={[styles.txtProntoSuperior, { color: tema.onPrimary, marginLeft: 5 }]}>Editar</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <View style={{ flex: 1 }}>
                <TextInput
                    style={[styles.inputTitulo, { color: tema.texto }]}
                    value={titulo}
                    onChangeText={setTitulo}
                    placeholder="Título"
                    placeholderTextColor={tema.placeholder}
                    editable={editando}
                />

                {notaExistente?.lembrete && (
                    <Animated.View style={{
                        opacity: animaLembreteRow,
                        transform: [{ translateY: animaLembreteRow.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                    }}>
                        <TouchableOpacity style={[styles.lembreteRow, { backgroundColor: tema.chipFundo, borderColor: tema.chipBorda }]} onPress={params.id ? abrirModalLembrete : undefined} activeOpacity={0.7}>
                            <Ionicons name="notifications" size={14} color={tema.accent} />
                            <Text style={[styles.lembreteTexto, { color: tema.accent }]} numberOfLines={1}>
                                {resumoLembrete(notaExistente.lembrete)}
                            </Text>
                        </TouchableOpacity>
                    </Animated.View>
                )}

                <RichTextEditor
                    ref={editorRef}
                    initialValue={notaExistente?.conteudo || ''}
                    onChange={handleConteudoChange}
                    onFormatoChange={handleFormatoChange}
                    editavel={editando}
                    placeholder={editando ? "Comece a escrever..." : ""}
                    textColor={tema.texto}
                    placeholderColor={tema.placeholder}
                    backgroundColor={tema.fundo}
                    accentColor={tema.accent}
                    imagensDirUri={DIR_IMAGENS.uri}
                    audiosDirUri={DIR_AUDIOS.uri}
                    onScrollPos={aoRolarEditor}
                    style={styles.inputConteudo}
                />

                {/* Toolbar no fluxo: no Android o paddingBottom do container usa a
                    altura REAL do teclado (alturaTeclado) e ela sobe junto; no iOS o
                    KeyboardAvoidingView cuida. Sem animação manual. */}
                {editando && (
                    <View style={{ zIndex: 9999 }}>
                        {renderToolbar()}
                    </View>
                )}
            </View>

            {editando && temAnexo && (
                <Animated.View
                    style={[
                        styles.botaoFim,
                        {
                            bottom: 78,
                            opacity: animaBotaoFim,
                            transform: [
                                { translateY: animaBotaoFim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
                                { scale: animaBotaoFim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                            ],
                        },
                    ]}
                    pointerEvents={mostrarBotao ? 'auto' : 'none'}
                >
                    {/* Anel de sonar da entrada */}
                    <Animated.View
                        style={[
                            styles.botaoFimAnel,
                            {
                                borderColor: tema.accent,
                                opacity: animaAnel.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                                transform: [{ scale: animaAnel.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2] }) }],
                            },
                        ]}
                    />
                    <Animated.View style={{ transform: [{ scale: animaEscala }] }}>
                        <TouchableOpacity
                            style={[styles.botaoFimCirculo, { backgroundColor: tema.accent }]}
                            onPress={irParaOFim}
                            activeOpacity={0.85}
                        >
                            <Animated.View style={{ transform: [
                                { translateY: animaSeta.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
                                { translateY: animaHop.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }) },
                            ] }}>
                                <Ionicons name="arrow-down" size={22} color={tema.onPrimary} />
                            </Animated.View>
                        </TouchableOpacity>
                    </Animated.View>
                </Animated.View>
            )}

            {carregandoImagem && (
                <View style={[styles.loadingOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)' }]}>
                    <ActivityIndicator size="large" color={tema.accent} />
                </View>
            )}

            {/* MODAL DO LEMBRETE DE REVISÃO */}
            <Modal visible={modalLembreteAberto} transparent animationType="slide" onRequestClose={() => setModalLembreteAberto(false)}>
                <View style={styles.modalFundo}>
                    <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setModalLembreteAberto(false)} />
                    <View style={[styles.sheet, { backgroundColor: tema.sheetFundo, borderColor: tema.sheetBorda }]}>
                        <View style={[styles.sheetHandle, { backgroundColor: tema.sheetHandle }]} />
                        <Animated.View style={{
                            opacity: animaSheetLembrete,
                            transform: [
                                { translateY: animaSheetLembrete.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
                                { scale: animaSheetLembrete.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
                            ],
                        }}>
                        <View style={styles.sheetHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.sheetTitulo, { color: tema.sheetTitulo }]}>Lembrete de revisão</Text>
                                <Text style={[styles.sheetSub, { color: tema.sheetSub }]}>Me lembre de ver esta nota</Text>
                            </View>
                            <TouchableOpacity onPress={() => setModalLembreteAberto(false)} style={[styles.botaoFechar, { backgroundColor: tema.botaoFecharFundo }]} activeOpacity={0.7}>
                                <Ionicons name="close" size={22} color={tema.botaoFecharIcone} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.modoRow}>
                            {(['data', 'dias', 'semana'] as TipoLembrete[]).map(m => (
                                <TouchableOpacity
                                    key={m}
                                    style={[
                                        styles.modoChip,
                                        { backgroundColor: tema.chipFundo, borderColor: tema.chipBorda },
                                        rTipo === m && { backgroundColor: tema.accent, borderColor: tema.accent },
                                    ]}
                                    onPress={() => mudarTipoLembrete(m)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.modoChipTexto, { color: rTipo === m ? tema.onPrimary : tema.chipTextoInativo }]}>
                                        {m === 'data' ? 'Data' : m === 'dias' ? 'A cada X dias' : 'Dias da semana'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <TouchableOpacity
                            style={[styles.opcaoRow, { backgroundColor: tema.opcaoFundo, borderColor: tema.opcaoBorda }]}
                            onPress={() => setMostrarHora(true)}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="time-outline" size={20} color={tema.accent} />
                            <Text style={[styles.opcaoLabel, { color: tema.opcaoLabel }]}>Horário</Text>
                            <Text style={[styles.opcaoValor, { color: tema.accent }]}>{rHorario}</Text>
                        </TouchableOpacity>
                        {Platform.OS === 'android' && mostrarHora && (
                            <DateTimePicker
                                value={horaComoDate(rHorario)}
                                mode="time"
                                is24Hour
                                display="default"
                                onChange={(e, d) => { setMostrarHora(false); if (d) setRHorario(formatarHora(d)); }}
                            />
                        )}
                        {Platform.OS !== 'android' && (
                            <DateTimePicker
                                value={horaComoDate(rHorario)}
                                mode="time"
                                is24Hour
                                display="spinner"
                                style={{ width: '100%', marginBottom: 10 }}
                                onChange={(e, d) => { if (d) setRHorario(formatarHora(d)); }}
                            />
                        )}

                        {rTipo === 'data' && (
                            <>
                                <TouchableOpacity
                                    style={[styles.opcaoRow, { backgroundColor: tema.opcaoFundo, borderColor: tema.opcaoBorda }]}
                                    onPress={() => setMostrarData(true)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="calendar-outline" size={20} color={tema.accent} />
                                    <Text style={[styles.opcaoLabel, { color: tema.opcaoLabel }]}>Data</Text>
                                    <Text style={[styles.opcaoValor, { color: tema.accent }]}>
                                        {rData ? new Date(rData + 'T00:00:00').toLocaleDateString('pt-BR') : 'Escolher'}
                                    </Text>
                                </TouchableOpacity>
                                {Platform.OS === 'android' && mostrarData && (
                                    <DateTimePicker
                                        value={rData ? new Date(rData + 'T00:00:00') : new Date()}
                                        mode="date"
                                        minimumDate={new Date()}
                                        display="default"
                                        onChange={(e, d) => { setMostrarData(false); if (d) setRData(formatarData(d)); }}
                                    />
                                )}
                                {Platform.OS !== 'android' && (
                                    <DateTimePicker
                                        value={rData ? new Date(rData + 'T00:00:00') : new Date()}
                                        mode="date"
                                        minimumDate={new Date()}
                                        display="spinner"
                                        style={{ width: '100%', marginBottom: 10 }}
                                        onChange={(e, d) => { if (d) setRData(formatarData(d)); }}
                                    />
                                )}
                            </>
                        )}

                        {rTipo === 'dias' && (
                            <View style={styles.chipsArea}>
                                {[1, 2, 3, 5, 7, 10, 15, 30].map(n => (
                                    <TouchableOpacity
                                        key={n}
                                        style={[
                                            styles.chip,
                                            { backgroundColor: tema.chipFundo, borderColor: tema.chipBorda },
                                            rDias === n && { backgroundColor: tema.accent, borderColor: tema.accent },
                                        ]}
                                    onPress={() => mudarDiasLembrete(n)}
                                    activeOpacity={0.7}
                                >
                                        <Text style={[styles.chipTexto, { color: rDias === n ? tema.onPrimary : tema.chipTextoInativo }]}>{n}d</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        {rTipo === 'semana' && (
                            <View style={styles.chipsArea}>
                                {DIAS_SEMANA.map(dia => {
                                    const ativo = rDiasSemana.includes(dia);
                                    return (
                                        <TouchableOpacity
                                            key={dia}
                                            style={[
                                                styles.chip,
                                                { minWidth: '30%', backgroundColor: tema.chipFundo, borderColor: tema.chipBorda },
                                                ativo && { backgroundColor: tema.accent, borderColor: tema.accent },
                                            ]}
                                            onPress={() => alternarDia(dia)}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={[styles.chipTexto, { color: ativo ? tema.onPrimary : tema.chipTextoInativo }]}>{dia}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}

                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                            {notaExistente?.lembrete && (
                                <TouchableOpacity
                                    style={[styles.botaoSalvar, { backgroundColor: tema.removerFundo, flex: 1 }]}
                                    onPress={removerLembrete}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name="trash" size={18} color="#FF6B6B" />
                                    <Text style={[styles.botaoSalvarTexto, { color: '#FF6B6B' }]}>Remover</Text>
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                style={[styles.botaoSalvar, { backgroundColor: tema.accent, flex: 1 }]}
                                onPress={salvarLembrete}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="checkmark" size={18} color={tema.onPrimary} />
                                <Text style={styles.botaoSalvarTexto}>Salvar</Text>
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </View>
                </View>
            </Modal>

            {/* MODAL DA IA */}
            <Modal visible={modalIAAberto} transparent animationType="slide" onRequestClose={() => setModalIAAberto(false)}>
                <KeyboardAvoidingView style={styles.modalFundo} behavior="padding" enabled={Platform.OS === 'ios' ? true : alturaTeclado > 0}>
                    <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setModalIAAberto(false)} />
                    <Animated.View style={[styles.sheet, { backgroundColor: tema.sheetFundo, borderColor: tema.sheetBorda }]}>
                        <View style={[styles.sheetHandle, { backgroundColor: tema.sheetHandle }]} />
                        <View style={styles.sheetHeader}>
                            <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons name="sparkles" size={20} color={tema.accent} style={{ marginRight: 8 }} />
                                    <Text style={[styles.sheetTitulo, { color: tema.sheetTitulo }]}>Assistente IA</Text>
                                </View>
                                <Text style={[styles.sheetSub, { color: tema.sheetSub }]}>Pergunte sobre suas notas</Text>
                            </View>
                            <TouchableOpacity onPress={() => setModalIAAberto(false)} style={[styles.botaoFechar, { backgroundColor: tema.botaoFecharFundo }]} activeOpacity={0.7}>
                                <Ionicons name="close" size={22} color={tema.botaoFecharIcone} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        <View style={styles.modoRow}>
                            {(['perguntar', 'resumo'] as const).map(m => (
                                <TouchableOpacity
                                    key={m}
                                    style={[
                                        styles.modoChip,
                                        { backgroundColor: tema.chipFundo, borderColor: tema.chipBorda },
                                        abaIA === m && { backgroundColor: tema.accent, borderColor: tema.accent },
                                    ]}
                                    onPress={() => setAbaIA(m)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.modoChipTexto, { color: abaIA === m ? '#FFF' : tema.chipTextoInativo }]}>
                                        {m === 'perguntar' ? 'Perguntar' : 'Resumo'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* SEM CHAVE: bloqueia a conversa — só IA de verdade com chave */}
                        {!temChaveIA ? (
                            <View style={{ alignItems: 'center', paddingVertical: 26, paddingHorizontal: 10 }}>
                                <Ionicons name="key-outline" size={40} color={tema.accent} />
                                <Text style={[styles.resumoAvia, { color: tema.sheetTitulo, marginTop: 14 }]}>
                                    A conversa com IA precisa de chave
                                </Text>
                                <Text style={[styles.sheetSub, { color: tema.sheetSub, textAlign: 'center', marginTop: 8, lineHeight: 19 }]}>
                                    Adicione sua chave gratuita em{'\n'}Ajustes → IA para conversar com a IA de verdade.
                                </Text>
                                <TouchableOpacity
                                    style={[styles.botaoSalvar, { backgroundColor: tema.accent, marginTop: 18, alignSelf: 'stretch' }]}
                                    onPress={() => { setModalIAAberto(false); router.navigate('/settings'); }}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name="settings-outline" size={18} color={tema.onPrimary} />
                                    <Text style={styles.botaoSalvarTexto}>Ir para Ajustes</Text>
                                </TouchableOpacity>
                            </View>
                        ) : abaIA === 'perguntar' ? (
                            <View>
                                {mensagensIA.length === 0 && !chatPensando && (
                                    <Text style={[styles.sheetSub, { color: tema.sheetSub, textAlign: 'center', marginTop: 18, marginBottom: 6, lineHeight: 20 }]}>
                                        Pergunte qualquer coisa sobre suas notas. ✨
                                        {'\n'}Ex.: «Quanto custa o arroz?» ou «Qual a data da festa?»
                                    </Text>
                                )}

                                <ScrollView
                                    ref={chatScrollRef}
                                    style={{ maxHeight: 300 }}
                                    showsVerticalScrollIndicator={false}
                                    onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                                >
                                    {mensagensIA.map((m, i) => (
                                        <BolhaChatAnimada key={i} m={m} isUsuario={m.papel === 'usuario'} tema={tema} />
                                    ))}
                                    {chatPensando && (
                                        <View style={[styles.bolhaChat, { alignSelf: 'flex-start', backgroundColor: tema.chipFundo, borderColor: tema.chipBorda, borderWidth: 1 }]}>
                                            <TypingDots cor={tema.sheetSub} />
                                        </View>
                                    )}
                                </ScrollView>

                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                                    <TextInput
                                        style={[styles.perguntaInput, { backgroundColor: tema.chipFundo, color: tema.sheetTitulo, borderColor: tema.chipBorda }]}
                                        placeholder="Pergunte sobre suas notas..."
                                        placeholderTextColor={tema.placeholder}
                                        value={perguntaIA}
                                        onChangeText={setPerguntaIA}
                                        onSubmitEditing={fazerPerguntaIA}
                                        returnKeyType="send"
                                        editable={!chatPensando}
                                    />
                                    <Animated.View style={{ transform: [{ scale: animaEnviarIA }] }}>
                                        <TouchableOpacity style={[styles.botaoPerguntar, { backgroundColor: tema.accent, opacity: chatPensando ? 0.5 : 1 }]} onPress={fazerPerguntaIA} activeOpacity={0.8} disabled={chatPensando}>
                                            <Ionicons name="arrow-forward" size={20} color={tema.onPrimary} />
                                        </TouchableOpacity>
                                    </Animated.View>
                                </View>
                            </View>
                        ) : (
                            <View>
                                <TouchableOpacity style={[styles.botaoSalvar, { backgroundColor: tema.accent, marginBottom: 16 }]} onPress={gerarResumoIA} activeOpacity={0.8} disabled={resumoPensando}>
                                    <Ionicons name="document-text-outline" size={18} color={tema.onPrimary} />
                                    <Text style={styles.botaoSalvarTexto}>{resumoPensando ? 'Resumindo…' : 'Gerar resumo com IA'}</Text>
                                </TouchableOpacity>
                                {resumoIA && (
                                    <View style={[styles.resumoCard, { backgroundColor: tema.chipFundo, borderColor: tema.chipBorda }]}>
                                        <Text style={{ color: tema.sheetTitulo, fontSize: 14.5, lineHeight: 21 }}>{resumoIA}</Text>
                                    </View>
                                )}
                            </View>
                        )}
                        </ScrollView>
                    </Animated.View>
                </KeyboardAvoidingView>
            </Modal>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, paddingTop: 50 },
    navBar: { flexDirection: 'row', paddingHorizontal: 14, marginBottom: 8, justifyContent: 'space-between', alignItems: 'center', height: 58, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.16)' },
    btnVoltar: { flexDirection: 'row', alignItems: 'center', paddingRight: 12, paddingLeft: 4, height: 40, borderRadius: 14 },
    txtVoltar: { fontSize: 16, fontWeight: '700', marginLeft: -4 },
    navActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    navIconButton: { width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    btnProntoSuperior: { minWidth: 72, height: 40, borderRadius: 14, paddingHorizontal: 13, justifyContent: 'center', alignItems: 'center' },
    txtProntoSuperior: { fontSize: 15, fontWeight: '800' },
    inputTitulo: { fontSize: 31, fontWeight: '900', marginHorizontal: 25, paddingTop: 12, paddingBottom: 8, letterSpacing: -0.7 },
    inputConteudo: { flex: 1, minHeight: 300 },
    toolbarWrapper: {
        height: 58,
        borderRadius: 20,
        marginHorizontal: 16,
        marginBottom: 12,
        justifyContent: 'center',
        borderWidth: 1,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 5
    },
    toolbarScroll: { alignItems: 'center', paddingHorizontal: 10, gap: 5 },
    btnToolbarExtra: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', alignItems: 'center' },
    divisorToolbar: { width: 1, height: 26, backgroundColor: 'rgba(128,128,128,0.4)', marginHorizontal: 6 },
    loadingOverlay: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center', alignItems: 'center', zIndex: 999
    },
    statusGravando: {
        position: 'absolute',
        top: 55,
        alignSelf: 'center',
        backgroundColor: '#FF3B30',
        paddingHorizontal: 18,
        paddingVertical: 7,
        borderRadius: 25,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 1000,
        elevation: 10,
    },
    txtGravando: { color: '#FFF', fontWeight: 'bold', marginLeft: 8 },
    lembreteRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: 25, marginBottom: 12, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, borderWidth: 1, gap: 6 },
    lembreteTexto: { fontSize: 13, fontWeight: '700' },
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
    sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    sheetTitulo: { fontSize: 21, fontWeight: '800' },
    sheetSub: { fontSize: 12.5, marginTop: 4 },
    botaoFechar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
    modoRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    modoChip: { flex: 1, minHeight: 42, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    modoChipTexto: { fontSize: 12.5, fontWeight: '700' },
    opcaoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        paddingVertical: 15,
        paddingHorizontal: 15,
        marginBottom: 10,
        gap: 10,
    },
    opcaoLabel: { fontSize: 15, fontWeight: '600', flex: 1 },
    opcaoValor: { fontSize: 15, fontWeight: '800' },
    chipsArea: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    chip: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chipTexto: { fontSize: 14, fontWeight: '700' },
    botaoSalvar: { height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, elevation: 2 },
    botaoSalvarTexto: { color: '#FFF', fontSize: 16, fontWeight: '800' },
    perguntaInput: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 14,
        fontSize: 15,
    },
    botaoPerguntar: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 2 },
    botaoFim: {
        position: 'absolute',
        right: 18,
        zIndex: 10000,
        elevation: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
    },
    botaoFimCirculo: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
    },
    botaoFimAnel: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 2,
    },
    respostaCard: {
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
    bolhaChat: {
        maxWidth: '88%',
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginBottom: 8,
    },
    bolhaChatTexto: { fontSize: 14.5, lineHeight: 20 },
    resumoAvia: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
    resumoCard: {
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 14,
        paddingHorizontal: 16,
    }
});
