import { ConvexReactClient } from 'convex/react';
import { Stack } from 'expo-router';

import { ConvexAuthProvider } from '@/features/auth/auth-boundary';
import { useTheme } from '@/hooks/use-theme';
import { ThemeProvider } from '@/providers/theme-provider';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error('EXPO_PUBLIC_CONVEX_URL is required');
const convex = new ConvexReactClient(convexUrl);

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ConvexAuthProvider client={convex}>
        <RootStack />
      </ConvexAuthProvider>
    </ThemeProvider>
  );
}

function RootStack() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="worksheet" />
      <Stack.Screen name="learners" />
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
