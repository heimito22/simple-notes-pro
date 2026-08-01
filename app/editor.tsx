import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert,
    Animated,
    BackHandler,
    Keyboard, Platform, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useNotas } from '../context/NotasContext';
import { useTheme } from '../context/ThemeContext';
import RichTextEditor, { FormatoAtivo, RichTextEditorHandle } from '../components/rich-text-editor';

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

export default function EditorScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { notas, salvarNota } = useNotas();
    const { isDark, config } = useTheme();

    const keyboardHeight = useRef(new Animated.Value(0)).current;
    // Impede salvamento duplo (ex.: toque duplo em "Pronto" ou Pronto + botão voltar)
    const salvandoRef = useRef(false);
    // HTML mais recente do editor rico (garante salvar a última digitação)
    const conteudoRef = useRef('');
    const editorRef = useRef<RichTextEditorHandle>(null);

    // Garante que a busca no array não quebre se "notas" estiver indefinido
    const notaExistente = (notas || []).find((n: any) => n.id === params.id);

    const [titulo, setTitulo] = useState('');
    const [protegida, setProtegida] = useState(false);
    // Notas sempre podem ser editadas (tanto novas quanto existentes)
    const [editando, setEditando] = useState(true);
    const [carregandoImagem, setCarregandoImagem] = useState(false);
    const [gravando, setGravando] = useState(false);
    // Estado de formatação ativa na seleção (negrito/itálico/listas...) da toolbar
    const [fmt, setFmt] = useState<FormatoAtivo>(FORMATO_INICIAL);
    // Gravador gerenciado pelo hook (liberado automaticamente ao desmontar o editor)
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    const tema = {
        fundo: isDark ? '#000' : '#FFF',
        texto: isDark ? '#FFF' : '#000',
        placeholder: isDark ? '#444' : '#AAA',
        toolbar: isDark ? '#1C1C1E' : '#F0F0F0',
        accent: isDark ? '#BB86FC' : '#6200EE',
    };

    // Monitoramento estável do teclado
    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSubscription = Keyboard.addListener(showEvent, (e) => {
            Animated.timing(keyboardHeight, {
                toValue: e.endCoordinates.height + (Platform.OS === 'android' ? 10 : 0),
                duration: Platform.OS === 'ios' ? e.duration : 150,
                useNativeDriver: false,
            }).start();
        });

        const hideSubscription = Keyboard.addListener(hideEvent, (e) => {
            Animated.timing(keyboardHeight, {
                toValue: 0,
                duration: Platform.OS === 'ios' ? e.duration : 150,
                useNativeDriver: false,
            }).start();
        });

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    // Carregamento inicial seguro da nota
    useEffect(() => {
        // Nota: NÃO resetar salvandoRef aqui — após salvar, notaExistente troca de
        // referência e re-rodaria este efeito, reabrindo a janela de salvamento duplo.
        if (notaExistente) {
            setTitulo(notaExistente.titulo || '');
            const conteudo = notaExistente.conteudo || '';
            if (conteudoRef.current !== conteudo) {
                conteudoRef.current = conteudo;
                // Apenas se o conteúdo mudou por fora (evita re-injeção ao abrir)
                editorRef.current?.setContent(conteudo);
            }
            setProtegida(!!notaExistente.protegida);
        } else {
            setTitulo('');
            conteudoRef.current = '';
            setProtegida(false);
            setEditando(true);
        }
    }, [params.id, notaExistente]);

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
            // Nota nova: sem id → o contexto cria a nota.
            // Nota existente: passa o id → o contexto atualiza.
            salvarNota(titulo, conteudoRef.current, params.id ? (params.id as string) : undefined, protegida);
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
    };

    const aplicarFormato = (cmd: string) => editorRef.current?.execCommand(cmd);

    const corAtiva = isDark ? 'rgba(187,134,252,0.28)' : 'rgba(98,0,238,0.13)';
    const estiloAtivo = (ativo: boolean) => (ativo ? { backgroundColor: corAtiva, borderRadius: 10 } : null);
    const corBotao = (ativo: boolean) => (ativo ? tema.accent : tema.texto);

    const RenderToolbar = () => (
        <View style={[styles.toolbarWrapper, { backgroundColor: tema.toolbar }]}>
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
        <View style={[styles.container, { backgroundColor: tema.fundo }]}>
            {gravando && (
                <View style={styles.statusGravando}>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={styles.txtGravando}>Gravando...</Text>
                </View>
            )}

            <View style={styles.navBar}>
                <TouchableOpacity
                    style={styles.btnVoltar}
                    onPress={() => editando ? finalizarESalvar() : router.back()}
                >
                    <Ionicons name="chevron-back" size={32} color={tema.accent} />
                    <Text style={[styles.txtVoltar, { color: tema.accent }]}>Notas</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {(config && config.protegerNotasIndividuais === true) && (
                        <TouchableOpacity onPress={handleToggleProtecao} style={{ marginRight: 20 }}>
                            <Ionicons
                                name={protegida ? "lock-closed" : "lock-open-outline"}
                                size={26}
                                color={protegida ? tema.accent : tema.placeholder}
                            />
                        </TouchableOpacity>
                    )}
                    {editando && (
                        <TouchableOpacity onPress={finalizarESalvar} style={styles.btnProntoSuperior}>
                            <Text style={[styles.txtProntoSuperior, { color: tema.accent }]}>Pronto</Text>
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

                <RichTextEditor
                    ref={editorRef}
                    initialValue={notaExistente?.conteudo || ''}
                    onChange={handleConteudoChange}
                    onFormatoChange={handleFormatoChange}
                    placeholder={editando ? "Comece a escrever..." : ""}
                    textColor={tema.texto}
                    placeholderColor={tema.placeholder}
                    backgroundColor={tema.fundo}
                    accentColor={tema.accent}
                    imagensDirUri={DIR_IMAGENS.uri}
                    audiosDirUri={DIR_AUDIOS.uri}
                    style={styles.inputConteudo}
                />
            </View>

            {editando && (
                <Animated.View
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: keyboardHeight,
                        zIndex: 9999
                    }}
                >
                    <RenderToolbar />
                </Animated.View>
            )}

            {carregandoImagem && (
                <View style={[styles.loadingOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)' }]}>
                    <ActivityIndicator size="large" color={tema.accent} />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, paddingTop: 50 },
    navBar: { flexDirection: 'row', paddingHorizontal: 8, marginBottom: 5, justifyContent: 'space-between', alignItems: 'center', height: 50 },
    btnVoltar: { flexDirection: 'row', alignItems: 'center', marginLeft: -4 },
    txtVoltar: { fontSize: 18, fontWeight: '400', marginLeft: -6 },
    btnProntoSuperior: { paddingHorizontal: 12 },
    txtProntoSuperior: { fontSize: 18, fontWeight: 'bold' },
    inputTitulo: { fontSize: 32, fontWeight: '900', marginHorizontal: 25, paddingVertical: 10 },
    inputConteudo: { flex: 1, minHeight: 300 },
    toolbarWrapper: {
        height: 55,
        borderRadius: 28,
        marginHorizontal: 15,
        marginBottom: 10,
        justifyContent: 'center',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 5
    },
    toolbarScroll: { alignItems: 'center', paddingHorizontal: 12, gap: 4 },
    btnToolbarExtra: { width: 40, height: 44, justifyContent: 'center', alignItems: 'center' },
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
    txtGravando: { color: '#FFF', fontWeight: 'bold', marginLeft: 8 }
});
