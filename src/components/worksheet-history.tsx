import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Spacing } from '@/constants/theme';
import type { WorksheetHistoryItem } from '@/domain/artifacts';
import { useTheme } from '@/hooks/use-theme';
import { InlineNotice, LoadingLines, Pill, ProductIcon, ProductText } from '@/components/product-primitives';

export type WorksheetHistoryProps = {
  /** History rows from `useWorksheetHistory`. */
  items?: readonly WorksheetHistoryItem[];
  /** Alias for callers that name the collection after the feature. */
  worksheets?: readonly WorksheetHistoryItem[];
  /** Controlled selection. The aliases make the component easy to place in a page-focused workspace. */
  selectedWorksheetId?: string | null;
  selectedPageId?: string | null;
  selectedId?: string | null;
  defaultSelectedWorksheetId?: string | null;
  defaultSelectedPageId?: string | null;
  defaultSelectedId?: string | null;
  onSelect?: (worksheet: WorksheetHistoryItem) => void;
  onWorksheetSelect?: (worksheet: WorksheetHistoryItem) => void;
  onSelectedWorksheetChange?: (worksheet: WorksheetHistoryItem | null) => void;
  loading?: boolean;
  error?: string | null;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Responsive, data-only worksheet picker. It becomes a horizontal rail on
 * narrow screens and a wrapping card grid on wider screens, while preserving
 * the same selection and accessibility contract on every platform.
 */
export function WorksheetHistory({
  items,
  worksheets,
  selectedWorksheetId,
  selectedPageId,
  selectedId,
  defaultSelectedWorksheetId,
  defaultSelectedPageId,
  defaultSelectedId,
  onSelect,
  onWorksheetSelect,
  onSelectedWorksheetChange,
  loading = false,
  error = null,
  label = 'Worksheet history',
  style,
}: WorksheetHistoryProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const history = useMemo(() => items ?? worksheets ?? [], [items, worksheets]);
  const controlledId = firstDefined(selectedWorksheetId, selectedPageId, selectedId);
  const defaultId = firstDefined(defaultSelectedWorksheetId, defaultSelectedPageId, defaultSelectedId) ?? null;
  const [uncontrolledId, setUncontrolledId] = useState<string | null>(defaultId);
  const isControlled = controlledId !== undefined;
  const effectiveId = isControlled ? controlledId ?? null : uncontrolledId;

  useEffect(() => {
    if (isControlled) return;
    const hasSelected = effectiveId
      ? history.some((item) => item.pageId === effectiveId || item.id === effectiveId)
      : false;
    const nextId = hasSelected ? effectiveId : history[0]?.pageId ?? null;
    if (nextId !== uncontrolledId) setUncontrolledId(nextId);
  }, [effectiveId, history, isControlled, uncontrolledId]);

  const select = useCallback((item: WorksheetHistoryItem) => {
    if (!isControlled) setUncontrolledId(item.pageId || item.id);
    onSelect?.(item);
    onWorksheetSelect?.(item);
    onSelectedWorksheetChange?.(item);
  }, [isControlled, onSelect, onSelectedWorksheetChange, onWorksheetSelect]);

  return (
    <View accessibilityLabel={label} style={[styles.root, style]}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <ProductText variant="heading">{label}</ProductText>
          <ProductText variant="caption" color={theme.textSecondary}>
            Pick up where you left off.
          </ProductText>
        </View>
        {history.length > 0 ? <ProductText variant="caption" color={theme.textSecondary}>{history.length} saved</ProductText> : null}
      </View>

      {error ? <InlineNotice tone="danger" icon="refresh">{error}</InlineNotice> : null}
      {loading ? <LoadingLines lines={2} /> : null}
      {!loading && !error && history.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.background }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
            <ProductIcon name="scan" size={18} color={theme.primary} />
          </View>
          <ProductText variant="bodyMedium">No worksheets yet</ProductText>
          <ProductText variant="caption" color={theme.textSecondary} style={styles.emptyDetail}>
            Uploaded pages will appear here so you can return to them later.
          </ProductText>
        </View>
      ) : null}

      {!loading && history.length > 0 ? (
        compact ? (
          <ScrollView
            horizontal
            contentContainerStyle={styles.compactList}
            showsHorizontalScrollIndicator={false}
            accessibilityLabel={`${label} list`}
          >
            {history.map((item) => (
              <WorksheetHistoryCard
                key={item.id || item.pageId}
                item={item}
                selected={item.pageId === effectiveId || item.id === effectiveId}
                compact
                onPress={() => select(item)}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.wideList} accessibilityLabel={`${label} list`}>
            {history.map((item) => (
              <WorksheetHistoryCard
                key={item.id || item.pageId}
                item={item}
                selected={item.pageId === effectiveId || item.id === effectiveId}
                onPress={() => select(item)}
              />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function WorksheetHistoryCard({
  item,
  selected,
  compact = false,
  onPress,
}: {
  item: WorksheetHistoryItem;
  selected: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const thumbnailSource = item.thumbnailUrl ?? undefined;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.title}, ${formatWorksheetDate(item.createdAt)}, ${worksheetStatusLabel(item.status)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact && styles.compactCard,
        { backgroundColor: theme.backgroundElement, borderColor: selected ? theme.primary : theme.border },
        selected && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.thumbnail, { backgroundColor: theme.background }]}>
        {thumbnailSource ? (
          <Image
            accessibilityLabel={`${item.title} thumbnail`}
            source={thumbnailSource}
            contentFit="cover"
            style={styles.thumbnailImage}
          />
        ) : (
          <ProductIcon name="scan" size={21} color={theme.textSecondary} />
        )}
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.cardTitleLine}>
          <ProductText variant="bodyMedium" numberOfLines={1} style={styles.title}>{item.title}</ProductText>
          {selected ? <ProductIcon name="check" size={15} color={theme.primary} /> : null}
        </View>
        <ProductText variant="caption" color={theme.textSecondary} numberOfLines={1}>
          {formatWorksheetDate(item.createdAt)}
        </ProductText>
        <Pill tone={statusTone(item.status)}>{worksheetStatusLabel(item.status)}</Pill>
      </View>
    </Pressable>
  );
}

export function formatWorksheetDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function worksheetStatusLabel(status: WorksheetHistoryItem['status']): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'scheduled': return 'Preparing';
    case 'running': return 'Analyzing';
    case 'completed': return 'Ready';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return 'Pending';
  }
}

function statusTone(status: WorksheetHistoryItem['status']): 'neutral' | 'primary' | 'mint' | 'danger' {
  switch (status) {
    case 'completed': return 'mint';
    case 'failed': return 'danger';
    case 'cancelled': return 'neutral';
    case 'pending': return 'neutral';
    default: return 'primary';
  }
}

function firstDefined(...values: (string | null | undefined)[]): string | null | undefined {
  return values.find((value) => value !== undefined);
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three, width: '100%' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headingCopy: { flex: 1, gap: 2 },
  compactList: { gap: Spacing.two, paddingRight: Spacing.two },
  wideList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { flexGrow: 1, flexBasis: 220, minWidth: 210, maxWidth: 360, minHeight: 104, padding: Spacing.two, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  compactCard: { width: 260, flexGrow: 0, flexBasis: 'auto' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  thumbnail: { width: 82, height: 66, borderRadius: 11, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbnailImage: { width: '100%', height: '100%' },
  cardCopy: { flex: 1, minWidth: 0, gap: 4 },
  cardTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four, borderRadius: 16, gap: 7 },
  emptyIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  emptyDetail: { maxWidth: 290, textAlign: 'center' },
});
