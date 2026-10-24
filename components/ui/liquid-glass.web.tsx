import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

/**
 * Fallback web do Liquid Glass. O app de desktop tem o próprio tema; aqui só
 * evitamos importar Skia no bundle web e mantemos a mesma API dos componentes.
 */

type GlassVariant = 'subtle' | 'regular' | 'strong';

type PanelProps = ViewProps & {
  radius?: number;
  variant?: GlassVariant;
  accentColor?: string;
  fallbackColor?: string;
  enabled?: boolean;
  dense?: boolean;
};

export function LiquidGlassPanel({
  radius = 18,
  fallbackColor = 'transparent',
  enabled,
  dense = false,
  style,
  children,
  ...rest
}: PanelProps) {
  const { config, isDark } = useTheme();
  const ativo = enabled ?? config.liquidGlass === true;
  return (
    <View
      {...rest}
      style={[
        { overflow: 'hidden', borderRadius: radius, backgroundColor: ativo ? 'transparent' : fallbackColor },
        style,
      ]}
    >
      {ativo && (
        <>
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? `rgba(8, 11, 18, ${dense ? '0.90' : '0.70'})`
                  : `rgba(255, 255, 255, ${dense ? '0.94' : '0.70'})`,
              },
            ]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={
              isDark
                ? ['rgba(255,255,255,0.12)', 'rgba(10,132,255,0.06)', 'rgba(0,0,0,0.18)']
                : ['rgba(255,255,255,0.85)', 'rgba(190,210,235,0.35)', 'rgba(255,255,255,0.35)']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.9)',
              },
            ]}
          />
        </>
      )}
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
  fallbackColor = 'transparent',
  accessibilityLabel,
  children,
}: ButtonProps) {
  const { config } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        style,
        {
          backgroundColor: config.liquidGlass ? 'rgba(255,255,255,0.08)' : fallbackColor,
          opacity: pressed ? 0.94 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function LiquidGlassOverlay() {
  return null;
}
