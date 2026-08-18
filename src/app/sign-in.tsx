import { Redirect, router } from 'expo-router';

import { AuthScreen } from '@/features/auth/auth-screen';
import { useTutoAuth } from '@/features/auth/auth-boundary';
import { StudentLoadingScreen } from '@/features/student/student-home-screen';

export default function SignInRoute() {
  const auth = useTutoAuth();
  if (auth.status === 'loading') return <StudentLoadingScreen />;
  if (auth.status === 'signed_in') return <Redirect href="/" />;
  return <AuthScreen onAuthenticated={() => router.replace('/')} />;
}
