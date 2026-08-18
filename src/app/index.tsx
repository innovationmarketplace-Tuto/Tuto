import { router } from 'expo-router';

import { AuthScreen } from '@/features/auth/auth-screen';
import { useTutoAuth } from '@/features/auth/auth-boundary';
import { StudentHomeScreen, StudentLoadingScreen } from '@/features/student/student-home-screen';

/** Primary authenticated product route. */
export default function HomeScreen() {
  const auth = useTutoAuth();
  if (auth.status === 'loading') return <StudentLoadingScreen />;
  if (auth.status !== 'signed_in') return <AuthScreen onAuthenticated={() => router.replace('/')} />;
  return <StudentHomeScreen />;
}
