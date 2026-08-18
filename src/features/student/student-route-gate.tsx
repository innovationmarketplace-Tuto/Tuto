import type { ReactNode } from 'react';
import { useState } from 'react';

import { Button } from '@/components/product-primitives';
import { AuthScreen } from '@/features/auth/auth-screen';
import { useTutoAuth } from '@/features/auth/auth-boundary';
import type { LearnerRecord } from '@/features/learners/client';
import { ProfileSetupScreen, StudentLoadingScreen, StudentStatusScreen } from '@/features/student/student-home-screen';
import { useStudentProfile } from '@/hooks/use-student-profile';

/**
 * Shared auth/profile boundary for student destinations.
 *
 * Keeping this boundary outside individual routes means deep links such as
 * `/chat` and `/worksheet` retain the same sign-in and first-run profile
 * behavior as the home route.
 */
export function StudentRouteGate({
  children,
}: {
  children: (profile: LearnerRecord) => ReactNode;
}) {
  const auth = useTutoAuth();
  const profileState = useStudentProfile(auth.status === 'signed_in');
  const [createdProfile, setCreatedProfile] = useState<LearnerRecord | null>(null);

  if (auth.status === 'loading') return <StudentLoadingScreen />;
  if (auth.status !== 'signed_in') return <AuthScreen onAuthenticated={() => undefined} />;

  const profile = profileState.profile ?? createdProfile;
  if (profileState.status === 'loading' && !profile) return <StudentLoadingScreen />;
  if (profileState.status === 'error' && !profile) {
    return (
      <StudentStatusScreen
        title="We couldn't open your learning space"
        detail={profileState.error?.message ?? 'Check your connection and try again.'}
        action={<Button icon="refresh" onPress={profileState.retry}>Try again</Button>}
      />
    );
  }
  if (!profile) {
    return (
      <ProfileSetupScreen
        error={profileState.createError}
        isCreating={profileState.isCreating}
        onCreate={async (displayName) => {
          const created = await profileState.createProfile(displayName);
          setCreatedProfile(created);
        }}
        onSignOut={() => void auth.signOut()}
      />
    );
  }

  return <>{children(profile)}</>;
}
