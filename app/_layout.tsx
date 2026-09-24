import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient as GradienteSvg,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { Alert } from 'react-native';
import AlarmeOverlay from '../components/alarme-overlay';
import { alarmeEstado } from '../context/alarme-estado';
import { bloqueioEstado } from '../context/bloqueio-estado';
import { FeedbackProvider } from '../context/feedback';
import { ListaProvider } from '../context/ListaContext';
import { MonetizacaoProvider } from '../context/monetizacao';
import { NotasProvider } from '../context/NotasContext';
import TarefasProvider from '../context/TarefasContext';
import ThemeProvider, { useTheme } from '../context/ThemeContext';
import { appColors } from '../constants/theme';

// --- Cadeado em SVG (react-native-svg) ---
// O brilho/vazamento que o usuário via no fundo preto acontecia porque, no
// Android, Views com borderRadius NÃO clipam filhos — as faixas de luz saíam
// da forma do cadeado. Em SVG tudo vive dentro da própria forma: gradiente no
// fill, buraco recortado com evenodd e brilho preso por clipPath.

// Clareia/escurece uma cor hex para derivar os tons metálicos do tema.
function misturarCor(hex: string, branco: boolean, fator: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const alvo = branco ? 255 : 0;
  const m = (c: number) => Math.round(c + (alvo - c) * fator);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
const clarear = (hex: string, fator: number) => misturarCor(hex, true, fator);
const escurecer = (hex: string, fator: number) => misturarCor(hex, false, fator);

// Faixa do arco: semicírculo no topo + laterais retas, com o "buraco" do U
// recortado (fillRule evenodd). Usado para preencher o arco E como clipPath,
// mantendo o brilho que varre preso dentro do metal.
const ARCO_BANDA =
  'M 0 66 L 0 30 C 0 13.4 13 0 29 0 C 45 0 58 13.4 58 30 L 58 66 L 47 66 L 47 30 C 47 19.5 39 11 29 11 C 19 11 11 19.5 11 30 L 11 66 Z';
// Brilho especular discreto, seguindo a curvatura do arco e permanecendo
// inteiramente dentro da espessura metálica.
const ARCO_BRILHO = 'M 9 30 C 9 19 18 9 29 9 C 40 9 49 19 49 30';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export default function RootLayout() {
  return (
    <ThemeProvider>
      <MonetizacaoProvider>
        <TarefasProvider>
          <ListaProvider>
            <NotasProvider>
              <FeedbackProvider>
                <ConteudoApp />
              </FeedbackProvider>
            </NotasProvider>
          </ListaProvider>
        </TarefasProvider>
      </MonetizacaoProvider>
    </ThemeProvider>
  );
}

/**
 * BLOQUEIO POR BIOMETRIA — agora GLOBAL, na raiz do app:
 * - A tela de bloqueio é um <Modal> nativo por cima do Stack, então cobre TODAS
 *   as telas (abas, editor, pastas) — inclusive as rotas apresentadas em modal —
 *   e PRESERVA o estado de navegação (nada é desmontado, só coberto).
 * - O tempo de bloqueio automático é medido pela saída do app (AppState) e
 *   avaliado no retorno: ausência >= tempoBloqueio → bloqueia. "Imediato" (0)
 *   bloqueia em qualquer saída. Usuário já autenticado e sem saída observada
 *   não é bloqueado à toa.
 * - O alarme (AlarmeOverlay, também um Modal) fica ACIMA do bloqueio — toca e é
 *   visível sem desbloquear; ao fechar, pede a biometria.
 */
function ConteudoApp() {
  const { isDark, config, t } = useTheme();
  const paleta = appColors(isDark);

  // --- LÓGICA DE BLOQUEIO ---
  // "autenticado" = o usuário desbloqueou nesta sessão. A tela de bloqueio é DERIVADA:
  // aparece sempre que a biometria está ativa e o usuário ainda não autenticou.
  // O desbloqueio é em duas etapas: `autenticar` só VALIDA a biometria (retorna
  // sucesso); a TelaBloqueio roda a animação do cadeado abrindo + fade do fundo e
  // só então chama `aoConcluirDesbloqueio` (setAutenticado(true)). Assim a animação
  // acontece em TODOS os caminhos: botão, timeout, alarme e volta ao app.
  const appState = useRef(AppState.currentState);
  const [autenticado, setAutenticado] = useState(false);
  const [pedidoDesbloqueio, setPedidoDesbloqueio] = useState(0);
  const tempoSaida = useRef<number | null>(null);
  const autenticadoRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedindoRef = useRef(false);

  useEffect(() => {
    autenticadoRef.current = autenticado;
  }, [autenticado]);

  // Valida a biometria e RETORNA se desbloqueou — não seta estado (a animação
  // decide quando concluir).
  // DESKTOP (web): usa o PIN de 4 dígitos do próprio app (config.pinDesbloqueio).
  // A TelaBloqueio pergunta o PIN e chama `aoDesbloquear` com ele; aqui validamos.
  // Sem biometria cadastrada (mobile), desbloqueia direto.
  const autenticar = useCallback(async (pin?: string): Promise<boolean> => {
    if (pedindoRef.current) return false; // evita prompts simultâneos (toque duplo)

    if (Platform.OS === 'web') {
      // Web: PIN do app. Sem PIN configurado, desbloqueia direto (toggle exigiria PIN).
      if (!config?.pinDesbloqueio) return true;
      const ok = pin === config.pinDesbloqueio;
      if (ok) tempoSaida.current = null;
      return ok;
    }

    const compativel = await LocalAuthentication.hasHardwareAsync();
    const cadastrado = await LocalAuthentication.isEnrolledAsync();

    if (!compativel || !cadastrado) {
      return true;
    }

    pedindoRef.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Acesse suas informações'),
        fallbackLabel: t('Usar senha do dispositivo'),
        disableDeviceFallback: false,
      });

      if (res.success) {
        tempoSaida.current = null;
        return true;
      }
      return false;
    } finally {
      pedindoRef.current = false;
    }
  }, [t, config?.pinDesbloqueio]);

  // Dispara a animação de desbloqueio na TelaBloqueio (incrementa o contador).
  // RETORNA ok para o PIN saber se errou (a TelaBloqueio limpa/treme os pontos).
  const desbloquear = useCallback(async (pin?: string): Promise<boolean> => {
    const ok = await autenticar(pin);
    if (ok) setPedidoDesbloqueio(n => n + 1);
    return ok;
  }, [autenticar]);

  useEffect(() => {
    // Com biometria ativa o app abre BLOQUEADO (autenticado=false → tela de bloqueio).
    // Só pede biometria se NENHUM alarme estiver na frente — o alarme é visível sem
    // desbloquear; ao fechar, o subscribe abaixo pede a biometria.
    if (config?.exigirBiometriaApp) {
      timeoutRef.current = setTimeout(() => {
        if (!alarmeEstado.ativo && !autenticadoRef.current) desbloquear();
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
        // Alarme na frente OU voltando de seletor de fotos/permissão → não bloqueia.
        if (alarmeEstado.ativo || bloqueioEstado.suspender) {
          tempoSaida.current = null;
          appState.current = nextState;
          return;
        }

        let deveBloquear: boolean;
        if (tempoSaida.current) {
          // Tempo de saída registrado: bloqueia só se a ausência passou do limite
          // configurado ("Imediato" = 0 bloqueia em qualquer ausência).
          const diferencaMinutos = (Date.now() - tempoSaida.current) / 1000 / 60;
          deveBloquear = diferencaMinutos >= (config.tempoBloqueio || 0);
        } else {
          // Sem saída registrada (ex.: app reaberto direto do background): bloqueia
          // apenas se o usuário NUNCA desbloqueou nesta sessão — usuário já autenticado
          // não deve ser bloqueado à toa por uma transição de AppState perdida.
          deveBloquear = !autenticadoRef.current;
        }
        tempoSaida.current = null;

        if (deveBloquear) {
          setAutenticado(false);
          desbloquear();
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
        desbloquear();
      }
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      subscription.remove();
      unsubAlarme();
    };
  }, [config?.exigirBiometriaApp, config?.tempoBloqueio]);

  const lockVisivel = !autenticado && !!config?.exigirBiometriaApp;
  const aoConcluirDesbloqueio = useCallback(() => setAutenticado(true), []);

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="editor" options={{ presentation: 'modal' }} />
        <Stack.Screen name="editorL" options={{ presentation: 'modal' }} />
        <Stack.Screen name="permissoes" options={{ presentation: 'modal' }} />
      </Stack>
      {/* Tela de bloqueio em Modal nativo TRANSPARENTE: cobre inclusive as rotas
          apresentadas em modal (editor/pastas). O fundo opaco é desenhado pela
          própria TelaBloqueio — no desbloqueio ele dá fade e revela o app. */}
      <Modal
        visible={lockVisivel}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <TelaBloqueio
          aoDesbloquear={desbloquear}
          aoConcluir={aoConcluirDesbloqueio}
          pedidoDesbloqueio={pedidoDesbloqueio}
          tempoBloqueio={config?.tempoBloqueio ?? 0}
          paleta={paleta}
          pinAtivo={Platform.OS === 'web' && !!config?.pinDesbloqueio}
        />
      </Modal>
      {/* Alarme em Modal nativo por cima de tudo — toca e é visível mesmo bloqueado. */}
      <AlarmeOverlay />
    </View>
  );
}

/**
 * Tecla do teclado PIN (desktop): círculo grande com feedback de press
 * (escala encolhe e volta com mola) — visual de teclado de desbloqueio.
 */
const TeclaPin = ({
  digito,
  aoPressionar,
  paleta,
  disabled,
}: {
  digito: string;
  aoPressionar: (d: string) => void;
  paleta: ReturnType<typeof appColors>;
  disabled?: boolean;
}) => {
  const escala = useRef(new Animated.Value(1)).current;
  const aoTocar = () => {
    Animated.sequence([
      Animated.spring(escala, { toValue: 0.86, friction: 8, tension: 300, useNativeDriver: true }),
      Animated.spring(escala, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }),
    ]).start();
    aoPressionar(digito);
  };
  return (
    <Animated.View style={{ transform: [{ scale: escala }] }}>
      <TouchableOpacity
        style={[styles.teclaPin, { backgroundColor: paleta.surface, borderColor: paleta.border }]}
        onPress={aoTocar}
        activeOpacity={0.7}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={digito}
      >
        <Text style={[styles.teclaPinTexto, { color: paleta.text }]}>{digito}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

/**
 * Tela de bloqueio com animação de desbloqueio REFINADA (v2):
 * - ENTRADA coreografada: o cadeado entra com spring + brilho que varre o arco
 *   (shine), e título/subtítulo/botão/chip entram em cascata com fades curtos.
 * - PULSO: anel de acento respira atrás do cadeado o tempo todo.
 * - DESBLOQUEIO em 4 atos:
 *     1. Tremor do mecanismo (o corpo vibra 3x antes de soltar);
 *     2. Corpo dá um "clique" (pop de escala) com bounce;
 *     3. ABERTURA COMO CADEADO REAL: SÓ o arco sobe e gira 180° em 3D
 *        (rotateY + perspectiva) ao redor do eixo vertical da perna ESQUERDA —
 *        que fica plantada no corpo — e a perna livre termina do lado de fora;
 *     4. ONDA de sucesso: dois anéis verdes se expandem em sequência a partir
 *        do cadeado e o conteúdo sobe com fade enquanto o FUNDO dá fade com
 *        leve zoom — revelando o app por baixo (Modal transparente).
 * Feedback tátil: impact no toque do botão e notificação de sucesso ao destravar.
 */
function TelaBloqueio({
  aoDesbloquear,
  aoConcluir,
  pedidoDesbloqueio,
  tempoBloqueio,
  paleta,
  pinAtivo,
}: {
  aoDesbloquear: (pin?: string) => Promise<boolean | void>;
  aoConcluir: () => void;
  pedidoDesbloqueio: number;
  tempoBloqueio: number;
  paleta: ReturnType<typeof appColors>;
  /** DESKTOP: bloqueio por PIN de 4 dígitos (em vez do botão de biometria). */
  pinAtivo?: boolean;
}) {
  const { t } = useTheme();
  // --- PIN (desktop): 4 dígitos digitados + animação de erro/sucesso ---
  const [pinDigitado, setPinDigitado] = useState('');
  const [pinErro, setPinErro] = useState(false);
  const verificandoRef = useRef(false);
  // --- Entrada (cascata) ---
  const entrada = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current; // brilho que varre o arco
  const cascata1 = useRef(new Animated.Value(0)).current; // título
  const cascata2 = useRef(new Animated.Value(0)).current; // botão
  const cascata3 = useRef(new Animated.Value(0)).current; // chip
  // --- Pulsar ---
  const pulso = useRef(new Animated.Value(0)).current;
  // --- Desbloqueio ---
  const tremor = useRef(new Animated.Value(0)).current; // vibração do mecanismo
  const arcoSubida = useRef(new Animated.Value(0)).current; // 0 encaixado → 1 levantado
  const virada3d = useRef(new Animated.Value(0)).current; // 0 → 1: giro 3D de 180° do cadeado
  const corpoPop = useRef(new Animated.Value(0)).current; // escala do corpo
  const ripple1 = useRef(new Animated.Value(0)).current; // primeiro anel verde
  const ripple2 = useRef(new Animated.Value(0)).current; // segundo anel (atrasado)
  const saidaConteudo = useRef(new Animated.Value(0)).current; // conteúdo some
  const saidaFundo = useRef(new Animated.Value(0)).current; // fade do fundo
  const desbloqueandoRef = useRef(false);
  const [desbloqueando, setDesbloqueando] = useState(false);

  // --- Entrada coreografada ---
  useEffect(() => {
    Animated.spring(entrada, {
      toValue: 1,
      friction: 6,
      tension: 60,
      useNativeDriver: true,
    }).start();

    // Brilho varre o arco pouco depois do cadeado pousar
    Animated.sequence([
      Animated.delay(260),
      Animated.timing(shine, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    // Texto, botão e chip entram em cascata (delays escalonados)
    Animated.timing(cascata1, {
      toValue: 1,
      duration: 460,
      delay: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(cascata2, {
      toValue: 1,
      duration: 460,
      delay: 330,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(cascata3, {
      toValue: 1,
      duration: 460,
      delay: 440,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulso, {
          toValue: 0,
          duration: 1600,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [entrada, shine, cascata1, cascata2, cascata3, pulso]);

  // --- Sequência de desbloqueio ---
  // Guarda o valor de `pedidoDesbloqueio` já CONSUMIDO por esta montagem. A tela
  // remonta toda vez que o Modal reaparece (voltar ao app), e o contador fica
  // > 0 do desbloqueio anterior — sem este guard, a animação antiga disparava
  // sozinha ao reabrir o app (cadeado "já abrindo" sem pedir biometria) e o
  // `aoConcluir` dela entrava direto no app. Só toca a animação quando o
  // contador CRESCE depois da montagem — ou seja, após um desbloqueio real.
  const ultimoPedidoConsumidoRef = useRef(pedidoDesbloqueio);
  useEffect(() => {
    if (pedidoDesbloqueio <= ultimoPedidoConsumidoRef.current || desbloqueandoRef.current) return;
    ultimoPedidoConsumidoRef.current = pedidoDesbloqueio;
    desbloqueandoRef.current = true;
    setDesbloqueando(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // 1) Tremor do mecanismo (3 micro-vibrações rápidas antes de soltar)
    Animated.sequence([
      Animated.timing(tremor, { toValue: -1, duration: 45, useNativeDriver: true }),
      Animated.timing(tremor, { toValue: 0.6, duration: 45, useNativeDriver: true }),
      Animated.timing(tremor, { toValue: -0.6, duration: 45, useNativeDriver: true }),
      Animated.timing(tremor, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();

    // 2) O corpo dá o clique e, logo depois, o arco sobe/gira. Os dois
    // movimentos são encadeados para não haver um frame em que o cadeado
    // pareça desaparecer entre o tremor e a abertura.
    Animated.sequence([
      Animated.delay(145),
      Animated.timing(corpoPop, {
        toValue: 1,
        duration: 105,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(corpoPop, {
        toValue: 0,
        friction: 5,
        tension: 180,
        useNativeDriver: true,
      }),
    ]).start();
    // 3) ABERTURA REAL: SÓ o arco sobe e gira 180° em 3D ao redor do eixo da
    // perna esquerda (o corpo fica parado). A perna livre varre para fora.
    Animated.parallel([
      Animated.spring(arcoSubida, {
        toValue: 1,
        friction: 6,
        tension: 92,
        delay: 160,
        useNativeDriver: true,
      }),
      Animated.timing(virada3d, {
        toValue: 1,
        duration: 560,
        delay: 160,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // 4) ONDA de sucesso: os anéis verdes explodem SÓ depois de o arco terminar
    // a abertura (sem bola/check — o anel é o sinal de desbloqueio).
    Animated.timing(ripple1, {
      toValue: 1,
      duration: 620,
      delay: 700,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    Animated.timing(ripple2, {
      toValue: 1,
      duration: 680,
      delay: 830,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // 5) Conteúdo sobe com fade + fundo dá fade com zoom → conclui
    Animated.timing(saidaConteudo, {
      toValue: 1,
      duration: 360,
      delay: 1080,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
    Animated.timing(saidaFundo, {
      toValue: 1,
      duration: 420,
      delay: 1210,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) aoConcluir();
    });
  }, [
    pedidoDesbloqueio,
    aoConcluir,
    tremor,
    arcoSubida,
    virada3d,
    corpoPop,
    ripple1,
    ripple2,
    saidaConteudo,
    saidaFundo,
  ]);

  const escalaPulso = pulso.interpolate({ inputRange: [0, 1], outputRange: [1, 1.26] });
  const opacidadePulso = pulso.interpolate({ inputRange: [0, 1], outputRange: [0.26, 0] });

  // --- Entrada ---
  const entradaEscala = entrada.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const entradaY = entrada.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  // Shine: faixa diagonal que varre o arco (translateX -70 → 90) com fade
  const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-70, 96] });
  const shineOpac = shine.interpolate({ inputRange: [0, 0.25, 0.8, 1], outputRange: [0, 0.55, 0.5, 0] });
  // Cascata: cada bloco entra com fade curto em sequência
  const cascataOpac = (v: Animated.Value) => v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const cascataY = (v: Animated.Value) => v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  // --- Desbloqueio ---
  const tremorX = tremor.interpolate({ inputRange: [-1, 0, 1], outputRange: [-3.5, 0, 3.5] });
  // Abertura COMO CADEADO REAL: SÓ o arco gira em 3D (rotateY 0° → 180°) ao
  // redor do eixo vertical da perna ESQUERDA (o wrapper do giro é centralizado
  // nessa perna) enquanto SOBE — a perna esquerda fica plantada no corpo e a
  // livre varre para o lado de fora. O corpo NÃO gira (sem carta, sem diagonal).
  const arcoY = arcoSubida.interpolate({ inputRange: [0, 1], outputRange: [0, -20] });
  const viradaY = virada3d.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  // O arco NÃO some: sobe e fica levantado (cadeado aberto) — sem fade do arco,
  // sem "piscada" de elemento sumindo.
  const arcoOpac = 1;
  const corpoEscala = corpoPop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] });
  // Onda: cada anel parte pequeno, perto do cadeado, e expande até bem maior
  // que o ícone, sumindo no fim — o sinal de desbloqueio é o próprio anel.
  const rippleEscala = ripple1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1.25, 2.05] });
  const rippleOpac = ripple1.interpolate({ inputRange: [0, 0.18, 0.55, 1], outputRange: [0, 0.65, 0.4, 0] });
  const ripple2Escala = ripple2.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1.4, 2.4] });
  const ripple2Opac = ripple2.interpolate({ inputRange: [0, 0.18, 0.55, 1], outputRange: [0, 0.5, 0.28, 0] });
  const conteudoOpac = saidaConteudo.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const conteudoY = saidaConteudo.interpolate({ inputRange: [0, 1], outputRange: [0, -30] });
  const conteudoEscala = saidaConteudo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  const textoBloqueio =
    tempoBloqueio === 0
      ? t('Bloqueio automático: imediato ao sair do app')
      : t('Bloqueio automático: após {n} min fora do app', { n: tempoBloqueio });

  // --- PIN (desktop): cada dígito preenche um ponto; ao 4º, valida. Erro =
  // tremor dos pontos + limpa. Sucesso = chama aoDesbloquear(pin) → animação.
  const digitarPin = (digito: string) => {
    if (desbloqueandoRef.current || verificandoRef.current) return;
    if (pinDigitado.length >= 4) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const novo = pinDigitado + digito;
    setPinDigitado(novo);
    setPinErro(false);
    if (novo.length === 4) {
      verificandoRef.current = true;
      // Pequena pausa para o 4º ponto "assentar" antes de validar (feedback visual).
      setTimeout(async () => {
        const ok = await aoDesbloquear(novo);
        // aoDesbloquear retorna undefined quando disparou a animação de sucesso;
        // se o PIN estava errado, nada acontece e limpamos com tremor.
        if (ok === false) {
          setPinErro(true);
          Animated.sequence([
            Animated.timing(tremor, { toValue: -1, duration: 55, useNativeDriver: true }),
            Animated.timing(tremor, { toValue: 1, duration: 55, useNativeDriver: true }),
            Animated.timing(tremor, { toValue: -0.8, duration: 55, useNativeDriver: true }),
            Animated.timing(tremor, { toValue: 0, duration: 55, useNativeDriver: true }),
          ]).start();
          setTimeout(() => {
            setPinDigitado('');
            setPinErro(false);
            verificandoRef.current = false;
          }, 420);
        } else {
          verificandoRef.current = false;
        }
      }, 160);
    }
  };
  const apagarPin = () => {
    if (verificandoRef.current) return;
    setPinDigitado(pinDigitado.slice(0, -1));
    setPinErro(false);
  };

  // Blocos da cascata: cada um usa sua própria animação (delays escalonados).
  // `width: '100%'` + alignItems center garantem que título/subtítulo/botão
  // fiquem SEMPRE centralizados mesmo com a animação de translateY rodando.
  const blocoCascata = (bloco: React.ReactNode, v: Animated.Value) => (
    <Animated.View
      style={{
        width: '100%',
        alignItems: 'center',
        opacity: cascataOpac(v),
        transform: [{ translateY: cascataY(v) }],
      }}
    >
      {bloco}
    </Animated.View>
  );

  return (
    <Animated.View
      style={[
        styles.lockContainer,
        {
          backgroundColor: paleta.background,
          opacity: saidaFundo.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: saidaFundo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) }],
        },
      ]}
    >
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: Animated.multiply(entrada, conteudoOpac),
          transform: [{ translateY: Animated.add(entradaY, conteudoY) }, { scale: Animated.multiply(entradaEscala, conteudoEscala) }],
        }}
      >
        <View style={styles.lockIconWrap}>
          <Animated.View
            style={[
              styles.pulsoAnel,
              {
                borderColor: paleta.primary,
                opacity: Animated.multiply(opacidadePulso, conteudoOpac),
                transform: [{ scale: escalaPulso }],
              },
            ]}
          />

          {/* Onda de sucesso: dois anéis verdes que se expandem do cadeado em
              sequência (sem bola/check — o anel é o sinal do desbloqueio). */}
          <Animated.View
            style={[
              styles.anelOk,
              {
                borderColor: '#4ADE80',
                opacity: rippleOpac,
                transform: [{ scale: rippleEscala }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.anelOnda2,
              {
                borderColor: '#4ADE80',
                opacity: ripple2Opac,
                transform: [{ scale: ripple2Escala }],
              },
            ]}
          />

          {/* Cadeado com gradiente metálico: arco (U) + corpo com fechadura */}
          {/* ABERTURA COMO CADEADO REAL: apenas o ARCO gira em 3D (rotateY, 180°)
              ao redor do EIXO VERTICAL da perna ESQUERDA — a perna esquerda fica
              plantada no corpo e a perna livre varre 180° para o lado, terminando
              do lado de fora. O corpo fica parado (não é carta virando, não
              inclina na diagonal e não achata/estica o desenho: o wrapper do giro
              é centralizado na perna esquerda, eixo da rotação). */}
          <Animated.View
            style={[
              styles.cadeadoWrap,
              {
                transform: [{ translateX: tremorX }],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.arcoGiroWrap,
                {
                  transform: [
                    { perspective: 700 },
                    { rotateY: viradaY },
                    { translateY: arcoY },
                  ],
                  opacity: arcoOpac,
                },
              ]}
            >                {/* Arco em U em SVG: o gradiente metálico vive dentro da forma,
                    o buraco é construído no próprio caminho e o brilho é
                    recortado pelo clipPath — nada vaza para o fundo. O SVG fica
                    deslocado para a direita dentro do wrapper de giro de modo que
                    a perna esquerda (centro x≈5.5) coincida com o CENTRO do
                    wrapper — assim o rotateY gira em torno dela. */}
              <Svg width={58} height={66} style={styles.arcoSvgNoGiro}>
                <Defs>
                  <GradienteSvg id="gradArco" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={clarear(paleta.primary, 0.52)} />
                    <Stop offset="0.2" stopColor={clarear(paleta.primary, 0.16)} />
                    <Stop offset="0.52" stopColor={paleta.primary} />
                    <Stop offset="0.82" stopColor={paleta.primaryStrong} />
                    <Stop offset="1" stopColor={escurecer(paleta.primary, 0.34)} />
                  </GradienteSvg>
                  <ClipPath id="clipArcoCadeado">
                    <Path d={ARCO_BANDA} />
                  </ClipPath>
                </Defs>
                <Path d={ARCO_BANDA} fill="url(#gradArco)" fillRule="evenodd" />
                {/* Brilho especular que segue a curvatura do topo do arco */}
                <Path
                  d={ARCO_BRILHO}
                  stroke={clarear(paleta.primary, 0.62)}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.72}
                />
                {/* Shine: faixa diagonal que varre o arco na entrada, recortada
                    pela própria forma do U (clipPath) */}
                <G clipPath="url(#clipArcoCadeado)">
                  <AnimatedRect
                    x={shineX}
                    y={-6}
                    width={20}
                    height={80}
                    rotation={24}
                    originX={29}
                    originY={33}
                    fill="rgba(255,255,255,0.85)"
                    opacity={shineOpac}
                  />
                </G>
              </Svg>
            </Animated.View>
            <Animated.View
              style={[
                styles.corpoWrap,
                {
                  transform: [{ scale: corpoEscala }],
                },
              ]}
            >
              {/* Corpo em SVG: peça arredondada com gradiente metálico, borda
                  interna discreta e fechadura alinhada ao centro. */}
              <Svg width={72} height={54} style={styles.corpoSvg}>
                <Defs>
                  <GradienteSvg id="gradCorpo" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={clarear(paleta.primary, 0.42)} />
                    <Stop offset="0.18" stopColor={clarear(paleta.primary, 0.12)} />
                    <Stop offset="0.52" stopColor={paleta.primary} />
                    <Stop offset="0.84" stopColor={paleta.primaryStrong} />
                    <Stop offset="1" stopColor={escurecer(paleta.primary, 0.34)} />
                  </GradienteSvg>
                </Defs>
                <Rect x="0" y="0" width="72" height="54" rx="17" fill="url(#gradCorpo)" stroke={clarear(paleta.primary, 0.24)} strokeWidth="1" />
                {/* Reflexo interno curto, contido no topo plano do corpo. */}
                <Rect x="12" y="4" width="48" height="4" rx="2" fill={clarear(paleta.primary, 0.5)} opacity={0.42} />
                {/* Fechadura recortada na cor do fundo */}
                <Circle cx="36" cy="23.5" r="3.5" fill={paleta.background} />
                <Rect x="33.5" y="27" width="5" height="10" rx="2.5" fill={paleta.background} />
                <Circle cx="36" cy="23.5" r="1.2" fill={paleta.muted} opacity={0.35} />
              </Svg>
            </Animated.View>
          </Animated.View>

        </View>

        {blocoCascata(
          <>
            <Text style={[styles.lockTitle, { color: paleta.text }]}>{t('App Bloqueado')}</Text>
            <Text style={[styles.lockSubTitle, { color: paleta.muted }]}>
              {t('Toque no botão abaixo para acessar suas notas, tarefas e anotações.')}
            </Text>
          </>,
          cascata1
        )}

        {pinAtivo ? (
          /* DESKTOP: PIN de 4 dígitos — pontos + teclado numérico com animações */
          blocoCascata(
            <View style={{ alignItems: 'center' }}>
              {/* Pontos: preenchem conforme digita; tremem em erro */}
              <Animated.View
                style={[
                  styles.pinPontos,
                  { transform: [{ translateX: tremor.interpolate({ inputRange: [-1, 0, 1], outputRange: [-6, 0, 6] }) }] },
                ]}
              >
                {[0, 1, 2, 3].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.pinPonto,
                      pinErro && styles.pinPontoErro,
                      {
                        backgroundColor:
                          pinErro ? paleta.danger
                          : i < pinDigitado.length ? paleta.primary
                          : 'transparent',
                        borderColor: pinErro ? paleta.danger : i < pinDigitado.length ? paleta.primary : paleta.muted,
                      },
                    ]}
                  />
                ))}
              </Animated.View>
              <Text style={[styles.pinDica, { color: paleta.muted }]}>{t('Digite o PIN de 4 dígitos')}</Text>
              {/* Teclado 3×4: dígitos sobem com leve fade ao tocar (press) */}
              <View style={styles.pinTeclado}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                  <TeclaPin key={d} digito={d} aoPressionar={digitarPin} paleta={paleta} disabled={desbloqueando} />
                ))}
                <View style={styles.teclaPin} pointerEvents="none" />
                <TeclaPin digito="0" aoPressionar={digitarPin} paleta={paleta} disabled={desbloqueando} />
                <TouchableOpacity
                  style={styles.teclaPin}
                  onPress={apagarPin}
                  activeOpacity={0.7}
                  disabled={desbloqueando}
                  accessibilityRole="button"
                  accessibilityLabel={t('Apagar')}
                >
                  <Ionicons name="backspace-outline" size={24} color={paleta.text} />
                </TouchableOpacity>
              </View>
            </View>,
            cascata2
          )
        ) : (
          blocoCascata(
            <TouchableOpacity
              style={[styles.btnAutenticar, { backgroundColor: paleta.primary }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                aoDesbloquear();
              }}
              activeOpacity={0.85}
              disabled={desbloqueando}
            >
              <Ionicons name="finger-print" size={22} color={paleta.onPrimary} style={{ marginRight: 10 }} />
              <Text style={[styles.btnText, { color: paleta.onPrimary }]}>{t('Desbloquear')}</Text>
            </TouchableOpacity>,
            cascata2
          )
        )}

        {blocoCascata(
          <View
            style={[styles.lockHintChip, { backgroundColor: paleta.surface, borderColor: paleta.border }]}
          >
            <Ionicons name="time-outline" size={14} color={paleta.muted} style={{ marginRight: 6 }} />
            <Text style={[styles.lockHint, { color: paleta.muted }]}>{textoBloqueio}</Text>
          </View>,
          cascata3
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lockContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  // ---- PIN (desktop) ----
  pinPontos: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 10,
  },
  pinPonto: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  pinPontoErro: {
    // cor/background/borda vêm do render (paleta.danger)
  },
  pinDica: {
    fontSize: 13,
    marginBottom: 18,
  },
  pinTeclado: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: 264, // 3 teclas de 72 + 2 gaps de 24
    gap: 24,
    marginTop: 4,
  },
  teclaPin: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teclaPinTexto: {
    fontSize: 26,
    fontWeight: '600',
  },
  lockIconWrap: {
    width: 128,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  pulsoAnel: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 2,
  },
  // Anel primário da onda (mais grosso, com leve brilho). A sombra verde
  // usa elevation/offset 0 para não deslocar o anel nas plataformas.
  anelOk: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 3.5,
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 0,
  },
  // Segundo anel da onda: um pouco mais fino para dar profundidade.
  anelOnda2: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 2.5,
  },
  // Cadeado desenhado com Views: arco em U por cima, corpo com fechadura embaixo.
  // O arco tem PERNAS que descem para dentro do corpo (como um cadeado real) —
  // o corpo (zIndex 3) cobre a base das pernas, que ficam visíveis só no alto.
  cadeadoWrap: {
    width: 100,
    height: 108,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  // Wrapper de GIRO do arco: é aqui que o rotateY (abertura 3D como cadeado
  // real) acontece. Ele é largo (100) e deslocado para a esquerda (left -23.5)
  // de modo que seu CENTRO (eixo da rotação) coincida com a PERNA ESQUERDA do
  // arco (x≈26.5 no cadeado) — assim a perna esquerda fica plantada no corpo e
  // a perna livre varre 180° para o lado. Espaço extra acima (top -26, altura
  // 92) para o arco subir sem ser cortado (a "piscada" antiga era corte).
  arcoGiroWrap: {
    position: 'absolute',
    top: -26,
    left: -23.5,
    width: 100,
    height: 92,
    zIndex: 2,
    // O giro da abertura leva o arco para fora da caixa — nunca cortar.
    overflow: 'visible',
  },
  // SVG do arco dentro do wrapper de giro: deslocado à direita (left 44.5) para
  // que o arco ocupe x 21..79 no cadeado (como antes) e a perna esquerda fique
  // exatamente no centro do wrapper (eixo do rotateY).
  arcoSvgNoGiro: {
    position: 'absolute',
    top: 26,
    left: 44.5,
  },
  // Wrapper do corpo: anima o "clique" (scale) junto com o tremor. Top 40 faz o
  // corpo cobrir a base das pernas do arco (que descem até y=66). A sombra do
  // corpo fica no wrapper (View), o desenho em si é o SVG.
  corpoWrap: {
    position: 'absolute',
    top: 40,
    left: (100 - 72) / 2,
    width: 72,
    height: 54,
    zIndex: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.32,
    shadowRadius: 11,
    elevation: 9,
  },
  corpoSvg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  lockTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  lockSubTitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 36,
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  btnAutenticar: {
    flexDirection: 'row',
    paddingVertical: 16,
    paddingHorizontal: 34,
    borderRadius: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  btnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  lockHintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  lockHint: {
    fontSize: 13,
  },
});