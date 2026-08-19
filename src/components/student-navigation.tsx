import { Link, usePathname, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar, Button, IconButton, ProductIcon, ProductText } from '@/components/product-primitives';
import { Spacing } from '@/constants/theme';
import type { LearnerRecord } from '@/features/learners/client';
import { useColorSchemeToggle, useTheme } from '@/hooks/use-theme';

type StudentNavigationHref = '/' | '/chat' | '/worksheet';

const navigationItems: readonly {
  href: StudentNavigationHref;
  label: string;
  icon: 'sparkle' | 'message' | 'scan';
}[] = [
  { href: '/', label: 'Home', icon: 'sparkle' },
  { href: '/chat', label: 'Chat', icon: 'message' },
  { href: '/worksheet', label: 'Worksheet', icon: 'scan' },
];

export function StudentNavigation({
  profile,
  onSignOut,
}: {
  profile: LearnerRecord;
  onSignOut: () => void;
}) {
  const theme = useTheme();
  const { scheme, toggleScheme } = useColorSchemeToggle();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isCompact = width < 680;

  return (
    <View style={[styles.navigation, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.brand}>
          <View style={[styles.logoSmall, { backgroundColor: theme.primary }]}>
            <ProductIcon name="sparkle" size={17} color="#FFFFFF" />
          </View>
          <View>
            <ProductText variant="heading">tuto</ProductText>
            {!isCompact ? <ProductText variant="caption" color={theme.textSecondary}>Your learning companion</ProductText> : null}
          </View>
        </View>

        {!isCompact ? <NavigationLinks pathname={pathname} /> : null}

        <View style={styles.profileActions}>
          <IconButton
            label={scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            icon={scheme === 'dark' ? 'sun' : 'moon'}
            variant="outline"
            onPress={toggleScheme}
          />
          <Avatar
            initials={initials(profile.displayName)}
            backgroundColor={theme.primarySoft}
            textColor={theme.primary}
            size={36}
          />
          {!isCompact ? <ProductText variant="bodyMedium" numberOfLines={1} style={styles.profileName}>{profile.displayName}</ProductText> : null}
          <Button tone="outline" onPress={onSignOut}>Log out</Button>
        </View>
      </View>

      {isCompact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.compactLinks}
          accessibilityLabel="Student navigation"
        >
          <NavigationLinks pathname={pathname} />
        </ScrollView>
      ) : null}
    </View>
  );
}

function NavigationLinks({ pathname }: { pathname: string }) {
  const theme = useTheme();
  return (
    <View style={styles.links}>
      {navigationItems.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href as Href} asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [
                styles.link,
                isActive && { backgroundColor: theme.primarySoft },
                pressed && styles.pressed,
              ]}
            >
              <ProductIcon name={item.icon} size={16} color={isActive ? theme.primary : theme.textSecondary} />
              <ProductText variant="label" color={isActive ? theme.primary : theme.textSecondary}>{item.label}</ProductText>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

const styles = StyleSheet.create({
  navigation: {
    minHeight: 72,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    gap: Spacing.two,
  },
  headerRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 96 },
  logoSmall: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  compactLinks: { gap: 4, paddingRight: Spacing.two },
  link: { minHeight: 38, paddingHorizontal: 11, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  profileActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileName: { maxWidth: 160 },
  pressed: { opacity: 0.75 },
});
