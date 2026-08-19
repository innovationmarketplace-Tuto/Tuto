import { Link } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Divider, InlineNotice, LoadingLines, Pill, ProductIcon, ProductText, ProgressBar, Surface } from '@/components/product-primitives';
import { StudentNavigation } from '@/components/student-navigation';
import { ProductMaxWidth, Spacing } from '@/constants/theme';
import { AuthScreen } from '@/features/auth/auth-screen';
import type { LearnerRecord } from '@/features/learners/client';
import { useTutoAuth } from '@/features/auth/auth-boundary';
import { useStudentProfile } from '@/hooks/use-student-profile';
import { useStudentProgress, type StudentMemoryItem, type StudentSkillProgress } from '@/hooks/use-student-progress';
import { useTheme } from '@/hooks/use-theme';

export function StudentHomeScreen() {
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

  return <StudentHomeContent profile={profile} />;
}

export function StudentLoadingScreen() {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.loadingScreen}>
        <View style={[styles.logo, { backgroundColor: theme.primary }]}>
          <ProductIcon name="sparkle" size={20} color="#FFFFFF" />
        </View>
        <ProductText variant="heading">Opening your learning space</ProductText>
        <LoadingLines lines={3} />
      </View>
    </SafeAreaView>
  );
}

function StudentHomeContent({ profile }: { profile: LearnerRecord }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 960;
  const isCompact = width < 600;
  const auth = useTutoAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const progress = useStudentProgress(profile.studentId);

  const signOut = async () => {
    setSignOutError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Try again.');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <StudentNavigation profile={profile} onSignOut={() => void signOut()} />

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.shell}>
            <Surface style={[styles.hero, { backgroundColor: theme.backgroundElement }, isCompact && styles.heroStack]} elevated>
              <View style={styles.heroCopy}>
                <ProductText variant="eyebrow" color={theme.primary}>Your space</ProductText>
                <ProductText variant="display">{greeting()}, {firstName(profile.displayName)}.</ProductText>
                <ProductText variant="body" color={theme.textSecondary} style={styles.heroDetail}>
                  Keep asking, trying, and making connections. I&apos;ll meet you wherever you are today.
                </ProductText>
              </View>
              <Pill tone="mint" icon="lock">Private by default</Pill>
            </Surface>

            {signOutError ? <InlineNotice tone="danger" icon="refresh">{signOutError}</InlineNotice> : null}

            <View style={[styles.destinationGrid, !isWide && styles.destinationGridStack]}>
              <DestinationCard
                href="/chat"
                icon="message"
                eyebrow="Conversation"
                title="Chat with your tutor"
                detail="Open your saved conversation and ask about any topic."
                action="Open chat"
              />
              <DestinationCard
                href="/worksheet"
                icon="scan"
                eyebrow="Visual workspace"
                title="Work on a worksheet"
                detail="Upload a page, select a step, and see tutor notes on your work."
                action="Open worksheet studio"
              />
            </View>

            <StudentInsightsCard progress={progress} />
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function DestinationCard({ href, icon, eyebrow, title, detail, action }: { href: '/chat' | '/worksheet'; icon: 'message' | 'scan'; eyebrow: string; title: string; detail: string; action: string }) {
  const theme = useTheme();
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${title}. ${detail}`}
        style={({ pressed }) => [styles.destinationCard, { borderColor: theme.border, backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}
      >
        <View style={[styles.destinationIcon, { backgroundColor: theme.primarySoft }]}><ProductIcon name={icon} size={24} color={theme.primary} /></View>
        <ProductText variant="eyebrow" color={theme.primary}>{eyebrow}</ProductText>
        <ProductText variant="heading" style={styles.destinationTitle}>{title}</ProductText>
        <ProductText variant="body" color={theme.textSecondary} style={styles.destinationDetail}>{detail}</ProductText>
        <View style={styles.destinationAction}>
          <ProductText variant="label" color={theme.primary}>{action}</ProductText>
          <ProductIcon name="arrow" size={16} color={theme.primary} />
        </View>
      </Pressable>
    </Link>
  );
}

function StudentInsightsCard({ progress }: { progress: ReturnType<typeof useStudentProgress> }) {
  const theme = useTheme();
  const skills = progress.skills.slice(0, 3);
  const memories = [...progress.facts, ...progress.episodes].slice(0, 3);
  return (
    <Surface style={[styles.insightsCard, { backgroundColor: theme.backgroundElement }]} elevated>
      <View style={styles.cardHeading}>
        <View style={[styles.cardIcon, { backgroundColor: theme.mint }]}><ProductIcon name="target" size={18} color={theme.mintText} /></View>
        <View style={styles.cardHeadingCopy}>
          <ProductText variant="heading">Your progress</ProductText>
          <ProductText variant="caption" color={theme.textSecondary}>A gentle picture of what you&apos;re building.</ProductText>
        </View>
      </View>

      {progress.status === 'loading' ? <LoadingLines lines={3} /> : null}
      {progress.status === 'error' ? <InlineNotice tone="yellow" icon="info">Your progress is taking a moment to load. You can keep learning while it catches up.</InlineNotice> : null}
      {progress.status === 'ready' && skills.length === 0 ? (
        <View style={styles.insightEmpty}>
          <ProductIcon name="sparkle" size={20} color={theme.primary} />
          <ProductText variant="body" color={theme.textSecondary}>As you practice, I&apos;ll show the skills that are growing with you.</ProductText>
        </View>
      ) : null}
      {skills.map((skill) => <SkillProgress key={skill.skillId} skill={skill} />)}

      <Divider style={styles.insightsDivider} />
      <View style={styles.memoryHeading}>
        <View style={[styles.cardIcon, { backgroundColor: theme.purple }]}><ProductIcon name="memory" size={18} color={theme.purpleText} /></View>
        <View style={styles.cardHeadingCopy}>
          <ProductText variant="heading">Things I remember</ProductText>
          <ProductText variant="caption" color={theme.textSecondary}>Useful bits from learning together.</ProductText>
        </View>
      </View>
      {memories.length === 0 ? (
        <ProductText variant="body" color={theme.textSecondary} style={styles.memoryEmpty}>
          Your notes and reflections will appear here as we learn together.
        </ProductText>
      ) : memories.map((memory) => <MemoryRow key={memory.id} memory={memory} />)}
    </Surface>
  );
}

function SkillProgress({ skill }: { skill: StudentSkillProgress }) {
  const theme = useTheme();
  const label = skill.mastery === null
    ? 'Just getting started'
    : skill.mastery >= 0.8
      ? 'Feeling strong'
      : skill.mastery >= 0.5
        ? 'Building confidence'
        : 'Still practicing';
  return (
    <View style={styles.skillProgress}>
      <View style={styles.skillHeading}>
        <ProductText variant="bodyMedium" style={styles.skillName} numberOfLines={1}>{skill.name}</ProductText>
        <Pill tone={skill.mastery !== null && skill.mastery >= 0.7 ? 'mint' : 'primary'}>{label}</Pill>
      </View>
      <ProgressBar value={skill.mastery} height={7} color={skill.mastery !== null && skill.mastery >= 0.7 ? theme.mintText : theme.primary} />
    </View>
  );
}

function MemoryRow({ memory }: { memory: StudentMemoryItem }) {
  const theme = useTheme();
  return (
    <View style={styles.memoryRow}>
      <View style={[styles.memoryDot, { backgroundColor: theme.purpleText }]} />
      <ProductText variant="body" style={styles.memoryText} numberOfLines={3}>{memory.text}</ProductText>
    </View>
  );
}

export function ProfileSetupScreen({
  error,
  isCreating,
  onCreate,
  onSignOut,
}: {
  error: Error | null;
  isCreating: boolean;
  onCreate: (displayName: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const submit = async () => {
    const value = displayName.trim();
    if (value.length < 2) {
      setValidationError('Enter at least two characters so I know what to call you.');
      return;
    }
    setValidationError(null);
    try {
      await onCreate(value);
    } catch {
      // The hook renders the normalized error inline below.
    }
  };
  const message = validationError ?? error?.message;
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.setupScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.setupShell}>
            <View style={styles.setupBrand}>
              <View style={[styles.logo, { backgroundColor: theme.primary }]}><ProductIcon name="sparkle" size={20} color="#FFFFFF" /></View>
              <View><ProductText variant="heading">tuto</ProductText><ProductText variant="caption" color={theme.textSecondary}>Your learning companion</ProductText></View>
            </View>
            <Surface style={[styles.setupCard, { backgroundColor: theme.backgroundElement }]} elevated>
              <View style={[styles.setupIcon, { backgroundColor: theme.primarySoft }]}><ProductIcon name="sparkle" size={23} color={theme.primary} /></View>
              <ProductText variant="display" style={styles.setupTitle}>Let&apos;s make this yours.</ProductText>
              <ProductText variant="body" color={theme.textSecondary}>
                Tell me what to call you and your private learning space is ready. You can start with a question right away.
              </ProductText>
              {message ? <InlineNotice tone="danger" icon="info">{message}</InlineNotice> : null}
              <View style={styles.setupField}>
                <ProductText variant="label">Your name</ProductText>
                <TextInput
                  accessibilityLabel="Your name"
                  autoCapitalize="words"
                  autoComplete="name"
                  autoFocus
                  maxLength={200}
                  onChangeText={setDisplayName}
                  onSubmitEditing={() => void submit()}
                  placeholder="Alex"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                  value={displayName}
                  style={[styles.setupInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
                />
              </View>
              <Button icon="arrow" loading={isCreating} disabled={!displayName.trim()} onPress={() => void submit()}>Start learning</Button>
              <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.setupSignOut}>
                <ProductText variant="caption" color={theme.textSecondary}>Not you?</ProductText>
                <ProductText variant="label" color={theme.primary}>Log out</ProductText>
              </Pressable>
            </Surface>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function StudentStatusScreen({ title, detail, action }: { title: string; detail: string; action: React.ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.statusScreen}>
        <View style={[styles.setupIcon, { backgroundColor: theme.primarySoft }]}><ProductIcon name="refresh" size={23} color={theme.primary} /></View>
        <ProductText variant="heading" style={styles.statusTitle}>{title}</ProductText>
        <ProductText variant="body" color={theme.textSecondary} style={styles.statusDetail}>{detail}</ProductText>
        {action}
      </View>
    </SafeAreaView>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || 'there';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  root: { flex: 1 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  topBar: { minHeight: 72, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  logoSmall: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  profileActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileName: { maxWidth: 160 },
  scrollContent: { padding: Spacing.four, paddingBottom: 64 },
  shell: { width: '100%', maxWidth: ProductMaxWidth, alignSelf: 'center', gap: Spacing.four },
  hero: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  heroStack: { flexDirection: 'column' },
  heroCopy: { flex: 1, gap: 7 },
  heroDetail: { maxWidth: 650 },
  destinationGrid: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three },
  destinationGridStack: { flexDirection: 'column' },
  destinationCard: { flex: 1, minHeight: 230, padding: Spacing.four, borderRadius: 22, borderWidth: 1, gap: Spacing.two },
  destinationIcon: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  destinationTitle: { fontSize: 22, lineHeight: 28 },
  destinationDetail: { flex: 1, maxWidth: 440 },
  destinationAction: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: Spacing.two },
  studyGrid: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three },
  studyGridStack: { flexDirection: 'column' },
  promptCard: { gap: Spacing.two },
  promptColumn: { width: 350 },
  promptIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  promptTitle: { fontSize: 22, lineHeight: 28 },
  starterList: { gap: 8, marginTop: 7 },
  starterButton: { minHeight: 58, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  starterIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  starterCopy: { flex: 1, gap: 1 },
  chatColumn: { flex: 1, minWidth: 0 },
  lowerGrid: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three },
  lowerGridStack: { flexDirection: 'column' },
  lowerColumn: { flex: 1, minWidth: 0 },
  insightsCard: { gap: Spacing.three, minHeight: 360 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardHeadingCopy: { flex: 1, gap: 2 },
  cardIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  skillProgress: { gap: 8 },
  skillHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillName: { flex: 1 },
  insightsDivider: { marginVertical: 1 },
  memoryHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memoryEmpty: { marginTop: -6 },
  memoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  memoryDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  memoryText: { flex: 1 },
  insightEmpty: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  setupScroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four },
  setupShell: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: Spacing.three },
  setupBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  setupCard: { gap: Spacing.three },
  setupIcon: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  setupTitle: { fontSize: 28, lineHeight: 34 },
  setupField: { gap: 7 },
  setupInput: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, fontSize: 15 },
  setupSignOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  statusScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  statusTitle: { textAlign: 'center' },
  statusDetail: { maxWidth: 440, textAlign: 'center' },
});
