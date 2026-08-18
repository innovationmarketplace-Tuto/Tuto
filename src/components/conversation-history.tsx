import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, ProductIcon, ProductText, Surface } from '@/components/product-primitives';
import { Spacing } from '@/constants/theme';
import type { LearnerSessionRecord } from '@/features/learners/client';
import { useTheme } from '@/hooks/use-theme';

export function ConversationHistory({
  sessions,
  selectedThreadId,
  compact = false,
  onSelect,
  onNew,
}: {
  sessions: LearnerSessionRecord[];
  selectedThreadId: string | null;
  compact?: boolean;
  onSelect: (threadId: string) => void;
  onNew: () => void;
}) {
  const theme = useTheme();
  const rows = sessions.map((session, index) => ({ session, label: conversationLabel(session, sessions.length - index) }));

  const list = rows.length === 0 ? (
    <View style={[styles.empty, { borderColor: theme.border }]}>
      <ProductText variant="caption" color={theme.textSecondary}>Your conversations will appear here.</ProductText>
    </View>
  ) : rows.map(({ session, label }) => {
    const selected = session.threadId === selectedThreadId;
    return (
      <Pressable
        key={session.threadId}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Open ${label}`}
        onPress={() => onSelect(session.threadId)}
        style={({ pressed }) => [
          styles.row,
          compact && styles.rowCompact,
          { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primarySoft : theme.background },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.icon, { backgroundColor: selected ? theme.primary : theme.backgroundElement }]}>
          <ProductIcon name="message" size={14} color={selected ? '#FFFFFF' : theme.textSecondary} />
        </View>
        <View style={styles.copy}>
          <ProductText variant="bodyMedium" numberOfLines={1}>{label}</ProductText>
          <ProductText variant="caption" color={theme.textSecondary}>{formatHistoryDate(session.updatedAt)}</ProductText>
        </View>
      </Pressable>
    );
  });

  return (
    <Surface style={[styles.panel, { backgroundColor: theme.backgroundElement }, compact && styles.panelCompact]} elevated>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <ProductText variant="bodyMedium">Chat history</ProductText>
          {!compact ? <ProductText variant="caption" color={theme.textSecondary}>Past conversations</ProductText> : null}
        </View>
        <Button icon="plus" onPress={onNew}>New chat</Button>
      </View>
      {compact ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
          {list}
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.verticalList}>
          {list}
        </ScrollView>
      )}
    </Surface>
  );
}

function conversationLabel(session: LearnerSessionRecord, fallbackNumber: number): string {
  const topic = session.currentProblem?.trim();
  if (topic) return topic.length > 42 ? `${topic.slice(0, 39)}…` : topic;
  return `Conversation ${Math.max(1, fallbackNumber)}`;
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  panel: { width: 270, minHeight: 0, gap: Spacing.three },
  panelCompact: { width: '100%', minHeight: 0, padding: Spacing.two, gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headingCopy: { flex: 1, gap: 1 },
  verticalList: { gap: 7, paddingBottom: Spacing.two },
  horizontalList: { gap: 7, paddingRight: Spacing.two },
  row: { minHeight: 58, paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowCompact: { width: 210 },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 13, padding: Spacing.three, maxWidth: 240 },
  pressed: { opacity: 0.74 },
});
