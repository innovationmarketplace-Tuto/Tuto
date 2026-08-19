import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Platform, useColorScheme as useSystemColorScheme } from 'react-native';

import { Colors, type ThemeColor } from '@/constants/theme';

type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'tuto.colorScheme';

function readStoredScheme(): ColorScheme | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function writeStoredScheme(scheme: ColorScheme) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, scheme);
}

type ThemeContextValue = {
  scheme: ColorScheme;
  theme: Record<ThemeColor, string>;
  toggleScheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [scheme, setScheme] = useState<ColorScheme>(
    () => readStoredScheme() ?? (systemScheme === 'dark' ? 'dark' : 'light'),
  );

  const toggleScheme = useCallback(() => {
    setScheme((current) => {
      const next: ColorScheme = current === 'light' ? 'dark' : 'light';
      writeStoredScheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ scheme, theme: Colors[scheme], toggleScheme }),
    [scheme, toggleScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemeContext must be used within a ThemeProvider');
  return context;
}
