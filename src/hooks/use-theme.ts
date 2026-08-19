/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useThemeContext } from '@/providers/theme-provider';

export function useTheme() {
  return useThemeContext().theme;
}

export function useColorSchemeToggle() {
  const { scheme, toggleScheme } = useThemeContext();
  return { scheme, toggleScheme };
}
