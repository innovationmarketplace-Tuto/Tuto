import { ScrollView, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import {
  Button,
  EmptyState,
  Pill,
  ProductIcon,
  ProductText,
  ProgressBar,
  Surface,
} from '@/components/product-primitives';
import { useTheme } from '@/hooks/use-theme';

import {
  studentSkillProgressLabel,
  studentSkillStatus,
  studentSkillStatusLabel,
  summarizeStudentProgress,
  type StudentProgressSkill,
} from './progress';

export type StudentMemoryItem = {
  id: string;
  text: string;
  createdAt?: string;
};

export type StudentProgressViewProps = {
  skills: readonly StudentProgressSkill[];
  memory?: readonly StudentMemoryItem[];
  onPracticeNext?: (skillId: string) => void;
};

/**
 * A self-directed progress and memory surface. It accepts already-authorized
 * records and owns no data fetching, learner selection, or roster controls.
 * The authenticated workspace can place it beside the tutor session without
 * changing the Convex learner or document contracts.
 */
export function StudentProgressView({ skills, memory = [], onPracticeNext }: StudentProgressViewProps) {
  const theme = useTheme();
  const summary = summarizeStudentProgress(skills);
  const nextSkill = skills.find((skill) => skill.skillId === summary.nextSkillId);

  if (skills.length === 0 && memory.length === 0) {
    return (
      <Surface style={styles.surface}>
        <EmptyState
          icon="target"
          title="Your progress starts here"
          detail="Practice with your tutor and Tuto will keep a clear, private record of what you are learning."
        />
      </Surface>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Surface elevated style={styles.surface}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <ProductText variant="eyebrow" color={theme.primary}>Your learning</ProductText>
            <ProductText variant="display">Progress you can use.</ProductText>
            <ProductText variant="body" color={theme.textSecondary}>
              Tuto remembers your practice so the next explanation can meet you where you are.
            </ProductText>
          </View>
          <View style={[styles.headerIcon, { backgroundColor: theme.primarySoft }]} accessibilityLabel="Your progress" accessible>
            <ProductIcon name="target" size={22} color={theme.primary} />
          </View>
        </View>

        <View style={styles.metrics} accessibilityLabel="Progress summary">
          <Metric value={String(summary.assessedSkillCount)} label="Skills explored" />
          <Metric value={String(summary.practiceSignalCount)} label="Practice signals" />
          <Metric value={summary.averageMastery === null ? '—' : `${Math.round(summary.averageMastery * 100)}%`} label="Average progress" />
        </View>

        {nextSkill ? (
          <View style={[styles.nextStep, { backgroundColor: theme.primarySoft }]}>
            <View style={styles.nextStepCopy}>
              <ProductText variant="eyebrow" color={theme.primary}>A useful next step</ProductText>
              <ProductText variant="heading">Keep working on {nextSkill.name}</ProductText>
              <ProductText variant="body" color={theme.textSecondary}>
                {nextSkill.mastery === null
                  ? 'You have not practiced this one with Tuto yet.'
                  : 'A little more practice here will help your tutor choose the right challenge.'}
              </ProductText>
            </View>
            {onPracticeNext ? (
              <Button icon="arrow" onPress={() => onPracticeNext(nextSkill.skillId)}>Practice next</Button>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <ProductText variant="heading">What I’m learning</ProductText>
          <ProductText variant="caption" color={theme.textSecondary}>Only you can see this</ProductText>
        </View>
        <View style={styles.skillList}>
          {skills.map((skill) => <SkillRow key={skill.skillId} skill={skill} selected={skill.skillId === summary.nextSkillId} />)}
        </View>

        {memory.length > 0 ? (
          <View style={styles.memorySection}>
            <View style={styles.sectionHeader}>
              <ProductText variant="heading">What Tuto remembers</ProductText>
              <Pill tone="purple" icon="memory">Private memory</Pill>
            </View>
            <View style={styles.memoryList}>
              {memory.map((item) => (
                <View key={item.id} style={[styles.memoryItem, { backgroundColor: theme.purple }]}>
                  <View style={[styles.memoryIcon, { backgroundColor: theme.backgroundElement }]}><ProductIcon name="memory" size={15} color={theme.purpleText} /></View>
                  <View style={styles.memoryCopy}>
                    <ProductText variant="bodyMedium">A note from your practice</ProductText>
                    <ProductText variant="caption" color={theme.textSecondary}>{item.text}</ProductText>
                    {item.createdAt ? <ProductText variant="caption" color={theme.textSecondary}>{item.createdAt}</ProductText> : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </Surface>
    </ScrollView>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.background }]}>
      <ProductText variant="heading">{value}</ProductText>
      <ProductText variant="caption" color={theme.textSecondary}>{label}</ProductText>
    </View>
  );
}

function SkillRow({ skill, selected }: { skill: StudentProgressSkill; selected: boolean }) {
  const theme = useTheme();
  const status = studentSkillStatus(skill.mastery);
  const tone = status === 'strong' ? 'mint' : status === 'not_started' ? 'neutral' : status === 'building' ? 'peach' : 'primary';
  return (
    <View style={[styles.skillRow, { backgroundColor: theme.background, borderColor: theme.border }, selected && { borderColor: theme.primary }]} accessibilityLabel={`${skill.name}: ${studentSkillStatusLabel(status)}`}>
      <View style={styles.skillCopy}>
        <View style={styles.skillTitleLine}>
          <ProductText variant="bodyMedium" style={styles.skillName}>{skill.name}</ProductText>
          <Pill tone={tone}>{studentSkillStatusLabel(status)}</Pill>
        </View>
        <ProgressBar value={skill.mastery} color={status === 'strong' ? theme.mintText : theme.primary} />
        <ProductText variant="caption" color={theme.textSecondary}>{studentSkillProgressLabel(skill)}</ProductText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.two },
  surface: { gap: Spacing.four, width: '100%' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  titleBlock: { flex: 1, gap: 6 },
  headerIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  metrics: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  metric: { flex: 1, minWidth: 110, gap: 2, padding: Spacing.two, borderRadius: 14 },
  nextStep: { padding: Spacing.three, borderRadius: 17, gap: Spacing.three },
  nextStepCopy: { gap: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  skillList: { gap: Spacing.two },
  skillRow: { padding: Spacing.three, borderRadius: 16, borderWidth: 1 },
  skillCopy: { gap: 8 },
  skillTitleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  skillName: { flex: 1 },
  memorySection: { gap: Spacing.three, paddingTop: Spacing.one },
  memoryList: { gap: Spacing.two },
  memoryItem: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.two, borderRadius: 14 },
  memoryIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  memoryCopy: { flex: 1, gap: 2 },
});
