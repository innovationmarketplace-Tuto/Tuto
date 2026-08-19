import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { Button, InlineNotice, Pill, ProductIcon, ProductText, Surface } from '@/components/product-primitives';
import { authErrorMessage, authNotConfiguredMessage, useTutoAuth } from '@/features/auth/auth-boundary';
import { useTheme } from '@/hooks/use-theme';

export function AuthScreen({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const theme = useTheme();
  const auth = useTutoAuth();
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (mode === 'sign_up' && displayName.trim().length < 2) {
      setError('Enter the name you would like Tuto to use.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const credentials = { email: normalizedEmail, password, ...(mode === 'sign_up' ? { displayName: displayName.trim() } : {}) };
      if (mode === 'sign_up') await auth.signUp(credentials);
      else await auth.signIn(credentials);
      onAuthenticated?.();
    } catch (submitError) {
      setError(authErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const isUnavailable = auth.status === 'unconfigured';
  const isLoading = auth.status === 'loading' || isSubmitting;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.shell}>
            <View style={styles.brandRow}>
              <View style={[styles.logo, { backgroundColor: theme.primary }]}><ProductIcon name="sparkle" size={21} color="#FFFFFF" /></View>
              <View>
                <ProductText variant="heading">tuto</ProductText>
                <ProductText variant="caption" color={theme.textSecondary}>Learning studio</ProductText>
              </View>
            </View>

            <Surface style={[styles.card, { backgroundColor: theme.backgroundElement }]} elevated>
              <View style={styles.cardHeading}>
                <View style={styles.headingCopy}>
                  <ProductText variant="display" style={styles.title}>{mode === 'sign_in' ? 'Welcome back.' : 'Create your learning space.'}</ProductText>
                  <ProductText variant="body" color={theme.textSecondary}>
                    {mode === 'sign_in' ? 'Sign in to continue learning with your saved tutor sessions.' : 'Create an account to keep your questions, work, and progress private across devices.'}
                  </ProductText>
                </View>
                <Pill tone="mint" icon="lock">Private by default</Pill>
              </View>

              {isUnavailable ? <InlineNotice tone="yellow" icon="info">{authNotConfiguredMessage} Connect the approved identity provider before accepting credentials.</InlineNotice> : null}
              {auth.error && !isUnavailable ? <InlineNotice tone="danger" icon="info">{auth.error.message}</InlineNotice> : null}
              {error ? <InlineNotice tone="danger" icon="refresh">{error}</InlineNotice> : null}

              {mode === 'sign_up' ? <Field label="Your name" value={displayName} onChangeText={setDisplayName} placeholder="Alex Morgan" autoComplete="name" /> : null}
              <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'} />

              <Button icon={mode === 'sign_in' ? 'arrow' : 'plus'} loading={isLoading} disabled={isUnavailable} onPress={submit} style={styles.submitButton}>
                {mode === 'sign_in' ? 'Sign in' : 'Create account'}
              </Button>

              <View style={styles.switchRow}>
                <ProductText variant="caption" color={theme.textSecondary}>{mode === 'sign_in' ? 'New to Tuto?' : 'Already have an account?'}</ProductText>
                <Pressable accessibilityRole="button" onPress={() => { setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in'); setError(null); }}>
                  <ProductText variant="label" color={theme.primary}>{mode === 'sign_in' ? 'Create an account' : 'Sign in instead'}</ProductText>
                </Pressable>
              </View>
            </Surface>

            <ProductText variant="caption" color={theme.textSecondary} style={styles.privacyCopy}>
              Your learning data is scoped to your account. Tuto will never treat an unauthenticated client as the owner of your work.
            </ProductText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ProductText variant="label">{label}</ProductText>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.background }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four },
  shell: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: Spacing.three },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  logo: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  card: { gap: Spacing.three },
  cardHeading: { gap: Spacing.two },
  headingCopy: { gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 34 },
  field: { gap: 7 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, fontSize: 15 },
  submitButton: { marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  privacyCopy: { textAlign: 'center', paddingHorizontal: Spacing.three },
});
