/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#18233A',
    background: '#F6F8FC',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8EEFF',
    textSecondary: '#66718A',
    border: '#E4E8F0',
    primary: '#4668F2',
    primarySoft: '#EEF1FF',
    mint: '#DDF7EA',
    mintText: '#18744B',
    peach: '#FFE8D8',
    peachText: '#A84F1A',
    yellow: '#FFF3C8',
    yellowText: '#8B6500',
    purple: '#F1E9FF',
    purpleText: '#6B43A1',
    danger: '#C84655',
    dangerSoft: '#FDEBED',
  },
  dark: {
    text: '#F6F8FC',
    background: '#111522',
    backgroundElement: '#1B2232',
    backgroundSelected: '#25315A',
    textSecondary: '#AAB4C9',
    border: '#2B354A',
    primary: '#8EA2FF',
    primarySoft: '#27345F',
    mint: '#163B2D',
    mintText: '#85E2B1',
    peach: '#4B2D1D',
    peachText: '#FFC39C',
    yellow: '#493B15',
    yellowText: '#FFE28A',
    purple: '#382B50',
    purpleText: '#D2B9FF',
    danger: '#FF9AA5',
    dangerSoft: '#4E2730',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 1440;
export const ProductMaxWidth = 1500;
