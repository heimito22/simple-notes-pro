/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#7C3AED';
const tintColorDark = '#FFFFFF';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

/** Paleta visual do Simple Notes usada pelas telas do app.
 * Mantém a mesma linguagem OLED/roxo nos temas claro e escuro.
 */
export const AppColors = {
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    surfaceElevated: '#2C2C2E',
    border: '#3A3A3C',
    text: '#FFFFFF',
    muted: '#8E8E93',
    placeholder: '#66666F',
    primary: '#BF5AF2',
    primaryStrong: '#D09BFF',
    primarySoft: '#24162F',
    success: '#34C759',
    danger: '#FF453A',
    dangerSoft: '#3A1D1D',
    warning: '#FFD60A',
    onPrimary: '#FFFFFF',
    tabBackground: '#09090B',
  },
  light: {
    background: '#F2F2F7',
    surface: '#FFFFFF',
    surfaceElevated: '#E9E9EF',
    border: '#E5E5EA',
    text: '#1C1C1E',
    muted: '#6E6E73',
    placeholder: '#8E8E93',
    primary: '#7C3AED',
    primaryStrong: '#6D28D9',
    primarySoft: '#EDE9FE',
    success: '#34C759',
    danger: '#FF3B30',
    dangerSoft: '#FBE9E9',
    warning: '#B58900',
    onPrimary: '#FFFFFF',
    tabBackground: '#FFFFFF',
  },
} as const;

export const appColors = (isDark: boolean) => (isDark ? AppColors.dark : AppColors.light);

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
