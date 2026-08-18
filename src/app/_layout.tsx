import { ConvexReactClient } from 'convex/react';
import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';
import { ConvexAuthProvider } from '@/features/auth/auth-boundary';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error('EXPO_PUBLIC_CONVEX_URL is required');
const convex = new ConvexReactClient(convexUrl);

export default function RootLayout() {
  return (
    <ConvexAuthProvider client={convex}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.light.background },
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="worksheet" />
        <Stack.Screen name="learners" />
        <Stack.Screen name="sign-in" />
      </Stack>
    </ConvexAuthProvider>
  );
}
