import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearnerSession as LearnerSessionPanel } from '@/components/learner-session';
import { ConversationHistory } from '@/components/conversation-history';
import { InlineNotice, Pill, ProductText } from '@/components/product-primitives';
import { StudentNavigation } from '@/components/student-navigation';
import { Colors, ProductMaxWidth, Spacing } from '@/constants/theme';
import { useTutoAuth } from '@/features/auth/auth-boundary';
import type { LearnerRecord } from '@/features/learners/client';
import { useLearnerSession } from '@/hooks/use-learner-session';

/** Full-height conversation destination. Saved messages are restored by the session hook. */
export function StudentChatScreen({ profile }: { profile: LearnerRecord }) {
  const auth = useTutoAuth();
  const { width } = useWindowDimensions();
  const isCompact = width < 820;
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const session = useLearnerSession({ studentId: profile.studentId, enabled: true, scope: 'chat' });

  const signOut = async () => {
    setSignOutError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.root}>
        <StudentNavigation profile={profile} onSignOut={() => void signOut()} />
        <View style={[styles.content, isCompact && styles.contentCompact]}>
          <View style={[styles.pageHeading, isCompact && styles.pageHeadingCompact]}>
            <View style={styles.headingCopy}>
              <ProductText variant="eyebrow" color={Colors.light.primary}>Chat</ProductText>
              <ProductText variant="heading" style={styles.title}>Your tutor, whenever you&apos;re ready.</ProductText>
              <ProductText variant="caption" color={Colors.light.textSecondary}>
                Your saved conversation history stays here, ready for the next question.
              </ProductText>
            </View>
            <Pill tone="mint" icon="lock">Saved privately</Pill>
          </View>

          {signOutError ? <InlineNotice tone="danger" icon="refresh">{signOutError}</InlineNotice> : null}

          <View style={[styles.chatWorkspace, isCompact && styles.chatWorkspaceCompact]}>
            <ConversationHistory
              sessions={session.sessionHistory}
              selectedThreadId={session.threadId}
              compact={isCompact}
              onSelect={session.selectThread}
              onNew={() => { session.newConversation(); }}
            />
            <View style={[styles.chatFrame, isCompact && styles.chatFrameCompact]}>
              <LearnerSessionPanel
                learner={profile}
                {...session}
                onSend={session.sendMessage}
                onRetry={session.retryMessage}
                onReload={session.retry}
              />
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.light.background },
  root: { flex: 1, backgroundColor: Colors.light.background },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: ProductMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  contentCompact: { paddingHorizontal: Spacing.two, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.two },
  pageHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  pageHeadingCompact: { alignItems: 'flex-start' },
  headingCopy: { flex: 1, gap: 3 },
  title: { fontSize: 20, lineHeight: 27 },
  chatWorkspace: { flex: 1, minHeight: 0, flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three },
  chatWorkspaceCompact: { flexDirection: 'column' },
  chatFrame: { flex: 1, minHeight: 0, minWidth: 0 },
  chatFrameCompact: { minHeight: 560 },
});
