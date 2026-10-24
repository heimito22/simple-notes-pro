import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import {
  SharedValue,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';

/**
 * Liquid Glass do celular.
 *
 * O material é desenhado por um shader Skia (não é só um BlurView):
 * - a borda é uma SDF que ondula com ruído lento, como líquido;
 * - cáusticas, brilho especular e uma película de nuvem se movem por dentro;
 * - o toque (press) engrossa o brilho e o vinco da borda.
 *
 * Tudo roda na GPU. O componente é usado só nas superfícies pedidas:
 * Configurações, menu +, modal de perfil, rodapé (barra de abas) e a barra
 * de formatação do editor (essa última tem um vidro CSS próprio no WebView).
 */

const SKSL = `
uniform float2 resolution;
uniform float radius;
uniform float time;
uniform float4 tint;
uniform float4 rim;
uniform float4 accent;
uniform float intensity;
uniform float press;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + float2(1.0, 0.0));
  float c = hash21(i + float2(0.0, 1.0));
  float d = hash21(i + float2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float sdRoundBox(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

half4 main(float2 xy) {
  float2 res = max(resolution, float2(1.0));
  float2 p = xy - res * 0.5;
  float2 halfSize = res * 0.5;
  float minSide = max(min(res.x, res.y), 1.0);
  float2 q = p / minSide;
  float rr = clamp(radius, 0.0, min(halfSize.x, halfSize.y));
  float t = time;

  // Uma única oitava de ruído, bem lenta: a borda ondula como líquido, sem
  // virar "chuvisco". O resto do vidro é analítico (barato).
  float n = noise2(q * 3.0 + float2(t * 0.18, -t * 0.12));
  float onda = sin(p.x * 0.014 + t * 0.55) * 0.32;
  float wobble = ((n - 0.5) * 1.35 + onda) * intensity * (1.0 + press * 0.45);

  float d = sdRoundBox(p, halfSize - 1.5, rr) + wobble;
  float inside = 1.0 - smoothstep(-1.5, 2.2, d);
  if (inside <= 0.002) { return half4(0.0); }

  float edge = clamp(1.0 + d / 14.0, 0.0, 1.0);
  float rimBand = 1.0 - smoothstep(0.0, 2.2, abs(d + 1.2));
  float2 uv = p / res + 0.5;
  float v = p.y / max(halfSize.y, 1.0);

  // Corpo do vidro: gradiente suave + um leve tom de acento.
  float3 env = mix(tint.rgb * 0.78, tint.rgb * 1.22, clamp(uv.y, 0.0, 1.0));
  env += accent.rgb * accent.a * (0.035 + edge * 0.10);

  // Duas luzes grandes e macias que se movem devagar por dentro.
  float2 o1 = float2(0.28 + 0.10 * sin(t * 0.38), 0.34 + 0.08 * cos(t * 0.31));
  float2 o2 = float2(0.72 + 0.07 * cos(t * 0.27), 0.63 + 0.07 * sin(t * 0.35));
  float aura = (exp(-10.0 * dot(uv - o1, uv - o1)) * 0.65
             + exp(-14.0 * dot(uv - o2, uv - o2)) * 0.40);
  aura *= 0.35 + 0.65 * edge;
  env += accent.rgb * aura * accent.a * 0.16 * intensity;
  env += rim.rgb * aura * 0.025 * intensity;

  // Uma faixa diagonal de luz atravessa o vidro.
  float band = 1.0 - smoothstep(0.0, 0.22, abs(uv.x + uv.y * 0.55 - fract(t * 0.055) * 1.75 + 0.25));
  env += rim.rgb * band * (0.25 + 0.75 * edge) * 0.035 * intensity;

  // Brilho interno junto à borda (refração).
  env += accent.rgb * accent.a * (1.0 - smoothstep(0.0, 14.0, abs(d))) * 0.025;

  // Fio especular: forte no topo, quase nada embaixo.
  float topRim = smoothstep(0.0, 0.32, -v) * rimBand;
  float bottomRim = smoothstep(0.0, 0.22, v) * rimBand;
  float sideRim = pow(clamp(abs(p.x) / max(halfSize.x, 1.0), 0.0, 1.0), 6.0) * rimBand;
  float spec = (topRim * 0.68 + bottomRim * 0.14 + sideRim * 0.10) * rim.a;
  spec *= 0.82 + 0.18 * sin(t * 0.9);
  spec += press * 0.06;
  env += rim.rgb * spec;

  // Reflexo de topo, fino e limpo, sem ruído por cima.
  float topLine = (1.0 - smoothstep(0.0, 0.07, abs(v + 0.88))) * 0.55;
  env += rim.rgb * topLine * 0.11;

  // Luz refletida embaixo, como uma borda molhada.
  float bottomGlow = (1.0 - smoothstep(0.0, 0.16, abs(v - 0.72))) * 0.35;
  env += rim.rgb * bottomGlow * 0.06;

  // Grão minúsculo só para matar banding; não vira estático.
  float grain = (hash21(xy + floor(t * 2.0) * 17.0) - 0.5) * 0.006;
  env += grain;

  float alpha = clamp(tint.a + rimBand * 0.14 + spec * 0.05, 0.0, 0.94);
  alpha *= inside;
  return half4(env * alpha, alpha);
}
`;

let efeitoLiquido: any = null;
try {
  efeitoLiquido = Skia.RuntimeEffect.Make(SKSL);
} catch {
  efeitoLiquido = null;
}
if (!efeitoLiquido) {
  console.warn('[LiquidGlass] RuntimeEffect indisponível; usando o vidro translúcido de fallback.');
}

type GlassVariant = 'subtle' | 'regular' | 'strong';

type OverlayProps = {
  radius?: number;
  variant?: GlassVariant;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
  press?: SharedValue<number>;
};

function hexParaRgba(hex: string | undefined, alpha: number): number[] {
  const bruto = (hex || '#0A84FF').replace('#', '');
  const completo = bruto.length === 3
    ? bruto.split('').map(c => c + c).join('')
    : bruto.padEnd(6, '0').slice(0, 6);
  const n = parseInt(completo, 16);
  if (!Number.isFinite(n)) return [0.04, 0.52, 1, alpha];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

export function LiquidGlassOverlay({
  radius = 18,
  variant = 'regular',
  accentColor,
  style,
  press,
}: OverlayProps) {
  const { isDark } = useTheme();
  const [tamanho, setTamanho] = useState({ width: 0, height: 0 });
  const relogio = useSharedValue(0);
  const ultimoQuadro = useSharedValue(0);
  // O vidro não precisa de 60 fps: o movimento é lento de propósito. Atualizar
  // o shader a ~30 fps (20 fps nos cards discretos) corta o custo pela metade
  // sem a animação parecer travada.
  const intervaloMs = variant === 'subtle' ? 50 : 33;
  useFrameCallback(info => {
    const agora = info.timeSinceFirstFrame;
    if (agora == null) return;
    if (agora - ultimoQuadro.value >= intervaloMs) {
      ultimoQuadro.value = agora;
      relogio.value = agora / 1000;
    }
  });

  const intensidade = variant === 'subtle' ? 0.55 : variant === 'strong' ? 1.30 : 1;
  const accent = hexParaRgba(accentColor, 0.85);
  // Fundo escuro fumê / vidro claro. Alphas baixos deixam o conteúdo respirar;
  // o shader fecha as bordas com o brilho especular.
  const tint = isDark ? [0.070, 0.080, 0.105, 0.46] : [0.97, 0.98, 1.0, 0.24];
  const rim = isDark ? [1, 1, 1, 0.46] : [1, 1, 1, 0.76];

  const uniforms = useDerivedValue(() => ({
    resolution: [tamanho.width, tamanho.height],
    radius: Math.max(0, radius),
    time: relogio.value,
    tint,
    rim,
    accent,
    intensity: intensidade,
    press: press ? press.value : 0,
  }));

  if (!efeitoLiquido) return null;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0 && (Math.abs(width - tamanho.width) > 0.5 || Math.abs(height - tamanho.height) > 0.5)) {
          setTamanho({ width, height });
        }
      }}
    >
      {tamanho.width > 0 && tamanho.height > 0 && (
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={efeitoLiquido} uniforms={uniforms} />
          </Fill>
        </Canvas>
      )}
    </View>
  );
}

type PanelProps = ViewProps & {
  radius?: number;
  variant?: GlassVariant;
  accentColor?: string;
  fallbackColor?: string;
  enabled?: boolean;
  /** Superfícies sobre conteúdo (modais) precisam de uma base mais opaca. */
  dense?: boolean;
};

export function LiquidGlassPanel({
  radius = 18,
  variant = 'regular',
  accentColor,
  fallbackColor = 'transparent',
  enabled,
  dense = false,
  style,
  children,
  ...rest
}: PanelProps) {
  const { config, isDark } = useTheme();
  const ativo = enabled ?? config.liquidGlass === true;

  if (!ativo) {
    return (
      <View {...rest} style={[style, { backgroundColor: fallbackColor }]}>
        {children}
      </View>
    );
  }

  return (
    <View
      {...rest}
      style={[
        styles.painel,
        { borderRadius: radius, backgroundColor: 'transparent' },
        style,
      ]}
    >
      {/* Base translúcida: garante contraste mesmo quando atrás é preto puro. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            backgroundColor: isDark
              ? `rgba(4, 6, 10, ${dense ? '0.86' : '0.44'})`
              : `rgba(255, 255, 255, ${dense ? '0.92' : '0.50'})`,
          },
        ]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={
          isDark
            ? ['rgba(255,255,255,0.055)', 'rgba(255,255,255,0.012)', 'rgba(0,0,0,0.10)']
            : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.16)', 'rgba(120,140,170,0.06)']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      <LiquidGlassOverlay radius={radius} variant={variant} accentColor={accentColor} />
      {children}
    </View>
  );
}

type ButtonProps = {
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  fallbackColor?: string;
  accentColor?: string;
  variant?: GlassVariant;
  accessibilityLabel?: string;
  children?: React.ReactNode;
};

export function LiquidGlassButton({
  onPress,
  disabled,
  style,
  radius = 999,
  fallbackColor = 'transparent',
  accentColor,
  variant = 'regular',
  accessibilityLabel,
  children,
}: ButtonProps) {
  const { config } = useTheme();
  const ativo = config.liquidGlass === true;
  const press = useSharedValue(0);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => {
        press.value = withSpring(1, { damping: 18, stiffness: 320 });
      }}
      onPressOut={() => {
        press.value = withSpring(0, { damping: 16, stiffness: 220 });
      }}
      style={({ pressed }) => [
        style,
        {
          backgroundColor: ativo ? 'transparent' : fallbackColor,
          opacity: pressed ? 0.94 : 1,
        },
      ]}
    >
      {ativo && (
        <LiquidGlassOverlay
          radius={radius}
          variant={variant}
          accentColor={accentColor}
          press={press}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  painel: {
    overflow: 'hidden',
  },
});
