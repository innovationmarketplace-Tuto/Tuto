import { useRef, type Dispatch, type SetStateAction } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { LearnerMessageRecord, LearnerRecord } from '@/features/learners/client';
import type { LearnerSessionStatus, SessionSendState } from '@/hooks/use-learner-session';
import { useTheme } from '@/hooks/use-theme';
import { MathText } from '@/components/math-text';
import { Button, EmptyState, IconButton, InlineNotice, LoadingLines, Pill, ProductIcon, ProductText, Surface } from '@/components/product-primitives';

export function LearnerSession({
  learner,
  threadId,
  messages,
  status,
  error,
  sendState,
  sendError,
  input,
  setInput,
  onSend,
  onRetry,
  onReload,
}: {
  learner: LearnerRecord;
  threadId: string | null;
  messages: LearnerMessageRecord[];
  status: LearnerSessionStatus;
  error: Error | null;
  sendState: SessionSendState;
  sendError: Error | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>> | ((value: string) => void);
  onSend: (message?: string) => Promise<void>;
  onRetry: () => void;
  onReload: () => void;
}) {
  const theme = useTheme();
  const visual = studentVisuals(learner);
  const messagesRef = useRef<ScrollView>(null);

  return (
    <Surface style={[styles.panel, { backgroundColor: theme.backgroundElement }]} elevated>
      <View style={styles.header}>
        <View style={styles.heading}>
          <AvatarSmall initials={visual.initials} backgroundColor={visual.avatarColor} textColor={visual.avatarText} />
          <View style={styles.headingCopy}><ProductText variant="bodyMedium">Your tutor</ProductText><View style={styles.statusLine}><View style={[styles.statusDot, { backgroundColor: theme.mintText }]} /><ProductText variant="caption" color={theme.textSecondary}>Ready to help</ProductText></View></View>
        </View>
        <Pill tone="mint" icon="lock">Private</Pill>
      </View>

      {status === 'loading' ? <View style={styles.loading}><LoadingLines lines={4} /></View> : null}
      {status === 'error' ? <InlineNotice tone="danger" icon="refresh" action={<Button tone="danger" onPress={onReload}>Try again</Button>}>{error?.message ?? 'This session could not be loaded.'}</InlineNotice> : null}
      {status === 'empty' && !error ? <EmptyState icon="message" title="Start with a question" detail="Ask anything you are curious about. Your conversation will be saved privately." /> : null}

      <ScrollView
        ref={messagesRef}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => messagesRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message) => <MessageBubble key={`${messageKey(message)}`} message={message} learner={learner} />)}
        {sendState === 'sending' ? <TypingBubble /> : null}
        {sendState === 'error' && sendError ? <InlineNotice tone="danger" icon="refresh" action={<Button tone="danger" onPress={onRetry}>Retry</Button>}>{sendError.message}</InlineNotice> : null}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.composer, { borderColor: input.trim() ? theme.primary : theme.border, backgroundColor: theme.background }]}> 
          <TextInput
            accessibilityLabel="Message your tutor"
            accessibilityHint="Type a question for your tutor"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => void onSend()}
            onKeyPress={(event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
              if (Platform.OS !== 'web') return;
              // On web, TextInput forwards the raw DOM keyboard event as `event`
              // itself (not nested under nativeEvent) — see react-native-web's TextInput.
              const webEvent = event as unknown as { key: string; shiftKey?: boolean; preventDefault: () => void };
              if (webEvent.key === 'Enter' && !webEvent.shiftKey) {
                webEvent.preventDefault();
                void onSend();
              }
            }}
            placeholder="What would you like help with?"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="send"
            multiline
            maxLength={500}
            style={[styles.input, { color: theme.text }]}
          />
          <IconButton label="Send message" icon="send" variant="primary" disabled={!threadId || !input.trim() || sendState === 'sending'} onPress={() => void onSend()} />
        </View>
        <ProductText variant="caption" color={theme.textSecondary} style={styles.composerMeta}>{input.length}/500 · Saved privately</ProductText>
      </KeyboardAvoidingView>
    </Surface>
  );
}

function MessageBubble({ message, learner }: { message: LearnerMessageRecord; learner: LearnerRecord }) {
  const theme = useTheme();
  const isStudent = message.role === 'student';
  return (
    <View style={[styles.messageRow, isStudent ? styles.studentRow : styles.tutorRow]}>
      {!isStudent ? <View style={[styles.tinyAvatar, { backgroundColor: theme.primary }]}><ProductIcon name="sparkle" size={11} color="#FFFFFF" /></View> : null}
      <View style={[styles.bubbleGroup, isStudent ? styles.studentGroup : styles.tutorGroup]}>
        <View style={[styles.bubble, isStudent ? { backgroundColor: theme.primary } : { backgroundColor: theme.primarySoft }]}><MathText text={message.text} color={isStudent ? '#FFFFFF' : theme.text} /></View>
        <ProductText variant="caption" color={theme.textSecondary}>{isStudent ? 'You' : 'Tuto'} · {formatTimestamp(message.createdAt)}</ProductText>
      </View>
    </View>
  );
}

function TypingBubble() {
  const theme = useTheme();
  return <View style={[styles.messageRow, styles.tutorRow]} accessibilityLabel="Tutor is typing" accessibilityRole="progressbar"><View style={[styles.tinyAvatar, { backgroundColor: theme.primary }]}><ProductIcon name="sparkle" size={11} color="#FFFFFF" /></View><View style={[styles.typingBubble, { backgroundColor: theme.primarySoft }]}><View style={[styles.typingDot, { backgroundColor: theme.primary }]} /><View style={[styles.typingDot, { backgroundColor: theme.primary }]} /><View style={[styles.typingDot, { backgroundColor: theme.primary }]} /></View></View>;
}

function AvatarSmall({ initials, backgroundColor, textColor }: { initials: string; backgroundColor: string; textColor: string }) {
  return <View style={[styles.avatarSmall, { backgroundColor }]}><ProductText variant="label" color={textColor}>{initials}</ProductText></View>;
}

function studentVisuals(student: Pick<LearnerRecord, 'studentId' | 'displayName'>) {
  const initials = student.displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
  const hash = Array.from(student.studentId).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const palette = [
    { avatarColor: '#E9EDFF', avatarText: '#314EC7' },
    { avatarColor: '#E0F7ED', avatarText: '#196B4D' },
    { avatarColor: '#FFF0E8', avatarText: '#A34823' },
  ];
  return { initials, ...palette[hash % palette.length] };
}

function messageKey(message: LearnerMessageRecord): string {
  return message.id ?? message._id ?? `${message.threadId}:${message.createdAt}:${message.role}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 520, padding: Spacing.three, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headingCopy: { gap: 3 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  avatarSmall: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  loading: { gap: Spacing.two, paddingVertical: Spacing.three },
  messages: { flex: 1, minHeight: 180 },
  messageContent: { gap: 14, paddingBottom: 14 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  studentRow: { justifyContent: 'flex-end' },
  tutorRow: { justifyContent: 'flex-start' },
  tinyAvatar: { width: 23, height: 23, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bubbleGroup: { maxWidth: '86%', gap: 4 },
  studentGroup: { alignItems: 'flex-end' },
  tutorGroup: { alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 17 },
  typingBubble: { flexDirection: 'row', gap: 4, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 17 },
  typingDot: { width: 5, height: 5, borderRadius: 2.5, opacity: 0.7 },
  composer: { minHeight: 48, borderWidth: 1, borderRadius: 15, padding: 5, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minHeight: 34, maxHeight: 80, fontSize: 14, lineHeight: 20, paddingTop: 7, paddingBottom: 7 },
  composerMeta: { textAlign: 'right', marginTop: 4, marginRight: 3 },
});
