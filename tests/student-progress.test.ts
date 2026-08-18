import assert from 'node:assert/strict';
import test from 'node:test';

import {
  studentSkillProgressLabel,
  studentSkillStatus,
  studentSkillStatusLabel,
  summarizeStudentProgress,
  type StudentProgressSkill,
} from '../src/features/student/progress';

const skill = (overrides: Partial<StudentProgressSkill> = {}): StudentProgressSkill => ({
  skillId: 'fractions-equivalent',
  name: 'Equivalent fractions',
  mastery: 0.75,
  confidence: 0.8,
  evidenceCount: 3,
  lastPracticedAt: '2026-08-17T10:00:00.000Z',
  misconceptionIds: [],
  ...overrides,
});

test('student progress preserves unknown mastery and chooses it as the next step', () => {
  const summary = summarizeStudentProgress([
    skill(),
    skill({ skillId: 'fraction-addition', name: 'Add fractions', mastery: null, evidenceCount: 0 }),
    skill({ skillId: 'common-denominator', name: 'Common denominator', mastery: 0.45, evidenceCount: 2 }),
  ]);

  assert.equal(summary.skillCount, 3);
  assert.equal(summary.assessedSkillCount, 2);
  assert.equal(summary.practiceSignalCount, 5);
  assert.equal(summary.nextSkillId, 'fraction-addition');
  assert.equal(summary.averageMastery, (0.75 + 0.45) / 2);
});

test('student progress summary is empty-safe and deterministic', () => {
  assert.deepEqual(summarizeStudentProgress([]), {
    skillCount: 0,
    assessedSkillCount: 0,
    practiceSignalCount: 0,
    averageMastery: null,
    nextSkillId: null,
  });

  const tied = summarizeStudentProgress([
    skill({ skillId: 'zeta', mastery: 0.4 }),
    skill({ skillId: 'alpha', mastery: 0.4 }),
  ]);
  assert.equal(tied.nextSkillId, 'alpha');
});

test('student status labels describe progress without grading language', () => {
  assert.equal(studentSkillStatus(null), 'not_started');
  assert.equal(studentSkillStatus(0.4), 'building');
  assert.equal(studentSkillStatus(0.6), 'practicing');
  assert.equal(studentSkillStatus(0.9), 'strong');
  assert.equal(studentSkillStatusLabel('not_started'), 'Not started yet');
  assert.equal(studentSkillProgressLabel(skill({ mastery: null, evidenceCount: 0 })), 'No practice signal yet');
  assert.equal(studentSkillProgressLabel(skill({ mastery: 0.75, evidenceCount: 1 })), '75% based on 1 practice signal');
});
