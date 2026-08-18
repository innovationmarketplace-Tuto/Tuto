/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

export function useTheme() {
  // The product shell currently has a deliberately light visual system (its
  // page canvas, side rail, and semantic status colors are light-theme assets).
  // Keep the hook as the theme seam without mixing dark text tokens into
  // hard-coded light surfaces when the OS prefers dark mode.
  return Colors.light;
}
