import type { StudentSkillState } from '@/domain/memory';

/**
 * The smallest provider-neutral shape needed by a student progress surface.
 * Keeping this adapter independent from Convex lets the product render the
 * same explanation for live records and deterministic test fixtures.
 */
export type StudentProgressSkill = Pick<
  StudentSkillState,
  | 'skillId'
  | 'mastery'
  | 'confidence'
  | 'evidenceCount'
  | 'lastPracticedAt'
  | 'misconceptionIds'
> & {
  name: string;
};

export type StudentProgressSkillStatus = 'not_started' | 'building' | 'practicing' | 'strong';

export type StudentProgressSummary = {
  skillCount: number;
  assessedSkillCount: number;
  practiceSignalCount: number;
  averageMastery: number | null;
  nextSkillId: string | null;
};

/**
 * Return a stable summary for the student-facing progress view.
 *
 * `mastery: null` stays unknown rather than being coerced to zero. Unknown
 * skills are the first next-step recommendation; otherwise the least mature
 * assessed skill is chosen, with the id as a deterministic tie-breaker.
 */
export function summarizeStudentProgress(
  skills: readonly StudentProgressSkill[],
): StudentProgressSummary {
  const assessed = skills.filter((skill) => skill.mastery !== null);
  const averageMastery = assessed.length === 0
    ? null
    : assessed.reduce((sum, skill) => sum + (skill.mastery ?? 0), 0) / assessed.length;
  const nextSkill = [...skills].sort((a, b) => {
    const aRank = a.mastery === null ? -1 : a.mastery;
    const bRank = b.mastery === null ? -1 : b.mastery;
    return aRank - bRank || a.skillId.localeCompare(b.skillId);
  })[0];

  return {
    skillCount: skills.length,
    assessedSkillCount: assessed.length,
    practiceSignalCount: skills.reduce((sum, skill) => sum + Math.max(0, skill.evidenceCount), 0),
    averageMastery,
    nextSkillId: nextSkill?.skillId ?? null,
  };
}

/**
 * Convert a projected score into language that is useful to a student. The
 * labels deliberately avoid implying a grade or a permanent judgment.
 */
export function studentSkillStatus(mastery: number | null): StudentProgressSkillStatus {
  if (mastery === null) return 'not_started';
  if (mastery >= 0.8) return 'strong';
  if (mastery >= 0.55) return 'practicing';
  return 'building';
}

export function studentSkillStatusLabel(status: StudentProgressSkillStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not started yet';
    case 'building':
      return 'Building this skill';
    case 'practicing':
      return 'Practicing this skill';
    case 'strong':
      return 'Feeling strong here';
  }
}

export function studentSkillProgressLabel(skill: StudentProgressSkill): string {
  if (skill.mastery === null) return 'No practice signal yet';
  const percentage = Math.round(Math.max(0, Math.min(1, skill.mastery)) * 100);
  return `${percentage}% based on ${skill.evidenceCount} practice ${skill.evidenceCount === 1 ? 'signal' : 'signals'}`;
}
