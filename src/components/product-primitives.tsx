import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ProductTone = 'neutral' | 'primary' | 'mint' | 'peach' | 'yellow' | 'purple' | 'danger';

const toneMap = {
  neutral: { background: 'backgroundElement', text: 'textSecondary' },
  primary: { background: 'primarySoft', text: 'primary' },
  mint: { background: 'mint', text: 'mintText' },
  peach: { background: 'peach', text: 'peachText' },
  yellow: { background: 'yellow', text: 'yellowText' },
  purple: { background: 'purple', text: 'purpleText' },
  danger: { background: 'dangerSoft', text: 'danger' },
} as const;

export type ProductIconName =
  | 'sparkle'
  | 'book'
  | 'memory'
  | 'review'
  | 'scan'
  | 'send'
  | 'arrow'
  | 'chevron'
  | 'check'
  | 'close'
  | 'refresh'
  | 'plus'
  | 'info'
  | 'lock'
  | 'target'
  | 'message'
  | 'clock'
  | 'dots'
  | 'sun'
  | 'moon';

const iconGlyphs: Record<ProductIconName, string> = {
  sparkle: '✦',
  book: '▤',
  memory: '◒',
  review: '◇',
  scan: '▣',
  send: '↑',
  arrow: '→',
  chevron: '⌄',
  check: '✓',
  close: '×',
  refresh: '↻',
  plus: '+',
  info: 'i',
  lock: '◇',
  target: '◎',
  message: '◌',
  clock: '◷',
  dots: '•••',
  sun: '☀',
  moon: '☾',
};

export function ProductIcon({ name, size = 18, color, style }: { name: ProductIconName; size?: number; color?: string; style?: TextStyle }) {
  const theme = useTheme();
  return (
    <Text
      aria-hidden
      style={[{ color: color ?? theme.text, fontSize: size, lineHeight: size + 3, fontFamily: Fonts.sans }, style]}>
      {iconGlyphs[name]}
    </Text>
  );
}

export function ProductText({
  children,
  style,
  variant = 'body',
  color,
  ...props
}: TextProps & { children?: ReactNode; variant?: 'display' | 'heading' | 'body' | 'bodyMedium' | 'caption' | 'label' | 'eyebrow' | 'mono'; color?: string }) {
  const theme = useTheme();
  return (
    <Text
      {...props}
      style={[
        { color: color ?? theme.text },
        variant === 'display' && styles.display,
        variant === 'heading' && styles.heading,
        variant === 'body' && styles.body,
        variant === 'bodyMedium' && styles.bodyMedium,
        variant === 'caption' && styles.caption,
        variant === 'label' && styles.label,
        variant === 'eyebrow' && styles.eyebrow,
        variant === 'mono' && styles.mono,
        style,
      ]}>
      {children}
    </Text>
  );
}

export function Surface({ children, style, elevated = false, ...props }: { children: ReactNode; style?: StyleProp<ViewStyle>; elevated?: boolean } & React.ComponentProps<typeof View>) {
  return (
    <View {...props} style={[styles.surface, elevated && styles.elevated, style]}>
      {children}
    </View>
  );
}

export function Pill({ children, tone = 'neutral', icon, style }: { children: ReactNode; tone?: ProductTone; icon?: ProductIconName; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const colors = toneMap[tone];
  return (
    <View style={[styles.pill, { backgroundColor: theme[colors.background], borderColor: theme[colors.background] }, style]}>
      {icon ? <ProductIcon name={icon} size={13} color={theme[colors.text]} /> : null}
      <ProductText variant="label" color={theme[colors.text]}>
        {children}
      </ProductText>
    </View>
  );
}

export function Avatar({ initials, backgroundColor, textColor, size = 42, selected = false }: { initials: string; backgroundColor: string; textColor: string; size?: number; selected?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`${initials} avatar`}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor }, selected && styles.avatarSelected]}>
      <ProductText variant="label" color={textColor} style={{ fontSize: Math.max(11, size * 0.29), lineHeight: size * 0.35 }}>
        {initials}
      </ProductText>
    </View>
  );
}

export function IconButton({ label, icon, onPress, variant = 'ghost', disabled = false, style, ...props }: PressableProps & { label: string; icon: ProductIconName; variant?: 'ghost' | 'primary' | 'outline'; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        variant === 'primary' && { backgroundColor: theme.primary },
        variant === 'outline' && { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.backgroundElement },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      <ProductIcon name={icon} size={18} color={variant === 'primary' ? '#FFFFFF' : theme.textSecondary} />
    </Pressable>
  );
}

export function Button({ children, icon, tone = 'primary', loading = false, style, ...props }: PressableProps & { children: ReactNode; icon?: ProductIconName; tone?: 'primary' | 'neutral' | 'outline' | 'danger'; loading?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const background = tone === 'primary' ? theme.primary : tone === 'danger' ? theme.dangerSoft : theme.backgroundElement;
  const foreground = tone === 'primary' ? '#FFFFFF' : tone === 'danger' ? theme.danger : theme.text;
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      disabled={loading || props.disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        tone === 'outline' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
        (loading || props.disabled) && styles.disabled,
        pressed && !(loading || props.disabled) && styles.pressed,
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={foreground} /> : icon ? <ProductIcon name={icon} size={16} color={foreground} /> : null}
      <ProductText variant="label" color={foreground}>
        {children}
      </ProductText>
    </Pressable>
  );
}

export function ProgressBar({ value, color, height = 7 }: { value: number | null; color?: string; height?: number }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 1, now: value ?? 0 }} style={[styles.progressTrack, { height, backgroundColor: theme.border }]}>
      {value !== null ? <View style={[styles.progressFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, backgroundColor: color ?? theme.primary }]} /> : <View style={[styles.progressUnknown, { backgroundColor: theme.textSecondary }]} />}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }, style]} />;
}

export function EmptyState({ icon = 'book', title, detail, action }: { icon?: ProductIconName; title: string; detail: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.emptyState} accessibilityRole="summary">
      <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
        <ProductIcon name={icon} size={22} color={theme.primary} />
      </View>
      <ProductText variant="heading" style={styles.emptyTitle}>{title}</ProductText>
      <ProductText variant="body" color={theme.textSecondary} style={styles.emptyDetail}>{detail}</ProductText>
      {action}
    </View>
  );
}

export function LoadingLines({ lines = 3 }: { lines?: number }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ gap: Spacing.two }}>
      {Array.from({ length: lines }).map((_, index) => (
        <View key={index} style={[styles.loadingLine, { backgroundColor: theme.border, width: index === lines - 1 ? '65%' : '100%' }]} />
      ))}
    </View>
  );
}

export function InlineNotice({ children, tone = 'neutral', icon = 'info', action }: { children: ReactNode; tone?: ProductTone; icon?: ProductIconName; action?: ReactNode }) {
  const theme = useTheme();
  const colors = toneMap[tone];
  return (
    <View style={[styles.inlineNotice, { backgroundColor: theme[colors.background] }]} accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}>
      <ProductIcon name={icon} size={17} color={theme[colors.text]} />
      <ProductText variant="caption" color={theme[colors.text]} style={styles.inlineNoticeText}>{children}</ProductText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.8 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  bodyMedium: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.1 },
  eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.15, textTransform: 'uppercase' },
  mono: { fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: Fonts.mono }), fontSize: 12, lineHeight: 18 },
  surface: { borderRadius: 22, padding: Spacing.three },
  elevated: Platform.select({ web: { boxShadow: '0px 10px 30px rgba(29, 49, 95, 0.08)' }, default: { shadowColor: '#172955', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 4 } }),
  pill: { minHeight: 26, paddingHorizontal: 10, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarSelected: Platform.select({
    web: { borderWidth: 3, borderColor: '#FFFFFF', boxShadow: '0 3px 8px rgba(70, 104, 242, 0.22)' },
    default: { borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#4668F2', shadowOpacity: 0.22, shadowRadius: 7, elevation: 4 },
  }),
  iconButton: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  button: { minHeight: 42, paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  progressTrack: { borderRadius: 20, overflow: 'hidden', width: '100%' },
  progressFill: { height: '100%', borderRadius: 20 },
  progressUnknown: { height: '100%', width: '35%', borderRadius: 20, opacity: 0.48 },
  divider: { height: 1, width: '100%' },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { textAlign: 'center' },
  emptyDetail: { maxWidth: 300, textAlign: 'center' },
  loadingLine: { height: 12, borderRadius: 8, opacity: 0.75 },
  inlineNotice: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13 },
  inlineNoticeText: { flex: 1 },
});
