import type { ArtifactPage } from '@/domain/artifacts';
import type { TutorAnnotation, TutorMessage } from '@/domain/annotations';
import type { PageRegion } from '@/domain/regions';
import type { StudentSkillState } from '@/domain/memory';
import type { NewSkillProposal } from '@/domain/skills';

/**
 * A small, checked-in feature-layer fixture. The UI intentionally consumes
 * these provider-neutral records rather than knowing anything about Convex,
 * an AI provider, or a document analyzer response shape.
 */

export type DemoStudentId = 'maya' | 'jonah';

export type DemoEvidence = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  outcome: 'correct' | 'partial' | 'incorrect' | 'unclear';
  independence: 'independent' | 'hinted' | 'demonstrated';
  skillName: string;
  accent: 'mint' | 'peach' | 'yellow' | 'purple';
};

export type DemoSkillState = StudentSkillState & {
  skillName: string;
  shortName: string;
  statusLabel: string;
  description: string;
};

export type DemoMessage = TutorMessage & {
  role: 'student' | 'tutor';
  createdAt: string;
  isNew?: boolean;
};

export type DemoStudent = {
  id: DemoStudentId;
  name: string;
  firstName: string;
  initials: string;
  grade: string;
  avatarColor: string;
  avatarText: string;
  focus: string;
  streak: number;
  activityCount: number;
  summary: string;
  currentGoal: string;
  teachingApproach: string;
  strengths: string[];
  misconceptions: string[];
  nextStep: string;
  promptSuggestions: string[];
  memoryFacts: { label: string; value: string; detail: string; tone: DemoEvidence['accent'] }[];
  skillStates: DemoSkillState[];
  evidence: DemoEvidence[];
  messages: DemoMessage[];
  firstResponse: string;
};

export const DEMO_PAGE: ArtifactPage = {
  id: 'page-fractions-01',
  artifactId: 'artifact-fractions-demo',
  pageNumber: 1,
  // The demo renderer recognizes this as a deterministic generated page. A
  // production adapter can replace it with the immutable canonical JPEG URL.
  imageUrl: 'generated://tuto/fractions/page-01',
  naturalWidth: 1240,
  naturalHeight: 1754,
  revision: 1,
};

export const DEMO_REGIONS: PageRegion[] = [
  {
    id: 'region-problem',
    pageId: DEMO_PAGE.id,
    revision: 1,
    kind: 'problem',
    polygon: [
      { x: 0.14, y: 0.13 },
      { x: 0.78, y: 0.13 },
      { x: 0.78, y: 0.25 },
      { x: 0.14, y: 0.25 },
    ],
    bounds: { x: 0.14, y: 0.13, width: 0.64, height: 0.12 },
    transcription: 'Add 1/2 + 1/3',
    confidence: 0.99,
    source: 'combined',
  },
  {
    id: 'region-equation',
    pageId: DEMO_PAGE.id,
    revision: 1,
    parentRegionId: 'region-problem',
    kind: 'equation',
    polygon: [
      { x: 0.16, y: 0.28 },
      { x: 0.68, y: 0.28 },
      { x: 0.68, y: 0.43 },
      { x: 0.16, y: 0.43 },
    ],
    bounds: { x: 0.16, y: 0.28, width: 0.52, height: 0.15 },
    transcription: '1/2 + 1/3 = 2/5',
    latex: '\\frac{1}{2}+\\frac{1}{3}=\\frac{2}{5}',
    confidence: 0.94,
    source: 'combined',
  },
  {
    id: 'region-denominator-step',
    pageId: DEMO_PAGE.id,
    revision: 1,
    parentRegionId: 'region-equation',
    kind: 'solution_step',
    polygon: [
      { x: 0.18, y: 0.48 },
      { x: 0.74, y: 0.48 },
      { x: 0.74, y: 0.59 },
      { x: 0.18, y: 0.59 },
    ],
    bounds: { x: 0.18, y: 0.48, width: 0.56, height: 0.11 },
    transcription: 'I added the top and bottom numbers',
    confidence: 0.89,
    source: 'document_analyzer',
  },
  {
    id: 'region-cue',
    pageId: DEMO_PAGE.id,
    revision: 1,
    parentRegionId: 'region-equation',
    kind: 'prose',
    polygon: [
      { x: 0.17, y: 0.68 },
      { x: 0.82, y: 0.68 },
      { x: 0.82, y: 0.78 },
      { x: 0.17, y: 0.78 },
    ],
    bounds: { x: 0.17, y: 0.68, width: 0.65, height: 0.1 },
    transcription: 'Common denominators make equal-sized pieces',
    confidence: 0.86,
    source: 'derived',
  },
];

export const DEMO_ANNOTATIONS: TutorAnnotation[] = [
  {
    id: 'annotation-denominator',
    pageId: DEMO_PAGE.id,
    targetRegionId: 'region-denominator-step',
    messageId: 'maya-tutor-2',
    kind: 'highlight',
    label: 'Look here',
  },
  {
    id: 'annotation-equation',
    pageId: DEMO_PAGE.id,
    targetRegionId: 'region-equation',
    messageId: 'maya-tutor-3',
    kind: 'circle',
    label: 'The equation',
  },
];

const mayaSkillStates: DemoSkillState[] = [
  {
    studentId: 'maya',
    skillId: 'fractions-equivalent',
    skillName: 'Recognize equivalent fractions',
    shortName: 'Equivalent fractions',
    statusLabel: 'Building',
    description: 'Maya can spot equal parts when the visual model is present.',
    mastery: 0.54,
    confidence: 0.88,
    evidenceCount: 5,
    lastPracticedAt: 'Today',
    misconceptionIds: [],
    supportingEvidenceIds: ['maya-evidence-1', 'maya-evidence-2'],
    modelVersion: 'demo-projection-v1',
  },
  {
    studentId: 'maya',
    skillId: 'fraction-common-denominator',
    skillName: 'Find a common denominator',
    shortName: 'Common denominator',
    statusLabel: 'Needs a bridge',
    description: 'The next explanation should connect equal pieces to the number line.',
    mastery: 0.28,
    confidence: 0.93,
    evidenceCount: 4,
    lastPracticedAt: 'Today',
    misconceptionIds: ['add-denominators'],
    supportingEvidenceIds: ['maya-evidence-3'],
    modelVersion: 'demo-projection-v1',
  },
  {
    studentId: 'maya',
    skillId: 'fraction-addition',
    skillName: 'Add fractions with unlike denominators',
    shortName: 'Add unlike denominators',
    statusLabel: 'Not yet assessed',
    description: 'No independent attempt has been recorded for this skill yet.',
    mastery: null,
    confidence: 0.19,
    evidenceCount: 0,
    misconceptionIds: [],
    supportingEvidenceIds: [],
    modelVersion: 'demo-projection-v1',
  },
];

const jonahSkillStates: DemoSkillState[] = [
  {
    studentId: 'jonah',
    skillId: 'fractions-equivalent',
    skillName: 'Recognize equivalent fractions',
    shortName: 'Equivalent fractions',
    statusLabel: 'Secure',
    description: 'Jonah reliably scales numerator and denominator together.',
    mastery: 0.91,
    confidence: 0.96,
    evidenceCount: 8,
    lastPracticedAt: 'Yesterday',
    misconceptionIds: [],
    supportingEvidenceIds: ['jonah-evidence-1', 'jonah-evidence-2'],
    modelVersion: 'demo-projection-v1',
  },
  {
    studentId: 'jonah',
    skillId: 'fraction-common-denominator',
    skillName: 'Find a common denominator',
    shortName: 'Common denominator',
    statusLabel: 'Secure',
    description: 'Jonah names a shared denominator before changing either fraction.',
    mastery: 0.84,
    confidence: 0.91,
    evidenceCount: 7,
    lastPracticedAt: 'Yesterday',
    misconceptionIds: [],
    supportingEvidenceIds: ['jonah-evidence-3'],
    modelVersion: 'demo-projection-v1',
  },
  {
    studentId: 'jonah',
    skillId: 'fraction-addition',
    skillName: 'Add fractions with unlike denominators',
    shortName: 'Add unlike denominators',
    statusLabel: 'Practicing',
    description: 'Jonah knows the procedure; the next check is arithmetic accuracy.',
    mastery: 0.69,
    confidence: 0.75,
    evidenceCount: 6,
    lastPracticedAt: 'Today',
    misconceptionIds: ['arithmetic-slip'],
    supportingEvidenceIds: ['jonah-evidence-4'],
    modelVersion: 'demo-projection-v1',
  },
];

const mayaMessages: DemoMessage[] = [
  {
    id: 'maya-student-1',
    role: 'student',
    text: 'I tried 1/2 + 1/3, but I think I’m mixing up what to add.',
    annotationIds: [],
    createdAt: '10:41 AM',
  },
  {
    id: 'maya-tutor-1',
    role: 'tutor',
    text: 'You noticed the important part: the pieces are not the same size yet. Let’s make the denominators match before we count the pieces.',
    annotationIds: [],
    createdAt: '10:41 AM',
  },
  {
    id: 'maya-tutor-2',
    role: 'tutor',
    text: 'I’m looking at this step first. Adding the denominators (2 + 3) would combine different-sized pieces. What number can both 2 and 3 build?',
    annotationIds: ['annotation-denominator'],
    createdAt: '10:42 AM',
  },
];

const jonahMessages: DemoMessage[] = [
  {
    id: 'jonah-student-1',
    role: 'student',
    text: 'Can you give me a quick check for 1/2 + 1/3?',
    annotationIds: [],
    createdAt: '10:41 AM',
  },
  {
    id: 'jonah-tutor-1',
    role: 'tutor',
    text: 'Sure. You already know the move: find a common denominator, rewrite both fractions, then add only the numerators. What common denominator did you choose?',
    annotationIds: [],
    createdAt: '10:41 AM',
  },
  {
    id: 'jonah-student-2',
    role: 'student',
    text: '6. I rewrote them as 3/6 and 2/6.',
    annotationIds: [],
    createdAt: '10:42 AM',
  },
  {
    id: 'jonah-tutor-2',
    role: 'tutor',
    text: 'Exactly. Now add the numerators and keep the denominator 6. Afterward, do a quick arithmetic check before you simplify.',
    annotationIds: [],
    createdAt: '10:42 AM',
  },
];

export const DEMO_STUDENTS: DemoStudent[] = [
  {
    id: 'maya',
    name: 'Maya Chen',
    firstName: 'Maya',
    initials: 'MC',
    grade: 'Grade 6',
    avatarColor: '#FFE0B8',
    avatarText: '#9A501A',
    focus: 'Fractions · building the bridge',
    streak: 4,
    activityCount: 12,
    summary: 'Maya learns best when the reason comes before the rule.',
    currentGoal: 'Explain why denominators need to match',
    teachingApproach: 'Use a visual model, then name the procedure.',
    strengths: ['Visual models', 'Explaining her thinking'],
    misconceptions: ['Adding denominators directly'],
    nextStep: 'Build equal-sized pieces with a 6-part bar.',
    promptSuggestions: ['Why can’t I add the bottoms?', 'Show me with a picture', 'Give me one hint'],
    memoryFacts: [
      { label: 'Learning preference', value: 'Reason first', detail: 'Maya asks for the “why” before practicing a new rule.', tone: 'purple' },
      { label: 'Current goal', value: 'Equal-sized pieces', detail: 'She is working toward a common-denominator explanation.', tone: 'mint' },
      { label: 'Watch for', value: 'Denominator addition', detail: 'A recent attempt combined 2 + 3 into the denominator.', tone: 'peach' },
    ],
    skillStates: mayaSkillStates,
    evidence: [
      { id: 'maya-evidence-1', title: 'Named equal parts with a visual', detail: 'Correct after one visual hint · equivalent fractions', timestamp: 'Today · 10:18 AM', outcome: 'correct', independence: 'hinted', skillName: 'Equivalent fractions', accent: 'mint' },
      { id: 'maya-evidence-2', title: 'Matched 2/4 and 1/2', detail: 'Independent explanation using a bar model', timestamp: 'Yesterday · 3:04 PM', outcome: 'correct', independence: 'independent', skillName: 'Equivalent fractions', accent: 'mint' },
      { id: 'maya-evidence-3', title: 'Added denominators in a new problem', detail: 'Attempt revealed a misconception · unlike denominators', timestamp: 'Today · 10:34 AM', outcome: 'incorrect', independence: 'independent', skillName: 'Common denominator', accent: 'peach' },
    ],
    messages: mayaMessages,
    firstResponse: 'That’s a thoughtful question. Let’s use the equal-pieces idea you practiced yesterday, then connect it to the rule.',
  },
  {
    id: 'jonah',
    name: 'Jonah Rivera',
    firstName: 'Jonah',
    initials: 'JR',
    grade: 'Grade 6',
    avatarColor: '#D8E5FF',
    avatarText: '#3655A5',
    focus: 'Fractions · check the arithmetic',
    streak: 7,
    activityCount: 19,
    summary: 'Jonah has the strategy down; he benefits from a quick accuracy check.',
    currentGoal: 'Slow down on the final arithmetic step',
    teachingApproach: 'Keep it concise, then ask for a self-check.',
    strengths: ['Common denominators', 'Procedural fluency'],
    misconceptions: ['Occasional arithmetic slips'],
    nextStep: 'Add numerators, then verify the result on a number line.',
    promptSuggestions: ['Check my answer', 'Why do I keep getting 4/6?', 'One more practice problem'],
    memoryFacts: [
      { label: 'Learning preference', value: 'Quick checks', detail: 'Jonah prefers a short prompt and space to try independently.', tone: 'purple' },
      { label: 'Current goal', value: 'Arithmetic accuracy', detail: 'The strategy is secure; the last step is where errors show up.', tone: 'mint' },
      { label: 'Watch for', value: 'Numerator slips', detail: 'A recent correct setup ended with 3 + 2 recorded as 4.', tone: 'yellow' },
    ],
    skillStates: jonahSkillStates,
    evidence: [
      { id: 'jonah-evidence-1', title: 'Scaled both parts of a fraction', detail: 'Independent and correct · equivalent fractions', timestamp: 'Yesterday · 4:22 PM', outcome: 'correct', independence: 'independent', skillName: 'Equivalent fractions', accent: 'mint' },
      { id: 'jonah-evidence-2', title: 'Explained why 6 works', detail: 'Independent explanation · common denominator', timestamp: 'Yesterday · 4:19 PM', outcome: 'correct', independence: 'independent', skillName: 'Common denominator', accent: 'mint' },
      { id: 'jonah-evidence-4', title: 'Set up the equation correctly', detail: 'Arithmetic slip after an independent setup', timestamp: 'Today · 9:56 AM', outcome: 'partial', independence: 'independent', skillName: 'Fraction addition', accent: 'yellow' },
    ],
    messages: jonahMessages,
    firstResponse: 'You already have the strategy. I’ll keep this short: show me your common denominator and we’ll check the final arithmetic together.',
  },
];

export const DEMO_PROPOSAL: NewSkillProposal & { id: string; status: 'proposed' | 'approved' | 'rejected'; createdAt: string } = {
  id: 'proposal-fraction-word-problems',
  suggestedName: 'Translate fraction language into an operation',
  objective: 'Given a fraction word problem, identify whether the situation calls for addition, subtraction, multiplication, or division before calculating.',
  whyExistingSkillsDoNotFit: 'The current graph covers fraction computation, but not choosing an operation from contextual language.',
  prerequisiteCandidateIds: ['fraction-addition'],
  aliases: ['fraction word problems', 'choose a fraction operation', 'fraction operation clues'],
  positiveExamples: ['“Altogether” signals a combining operation.', 'The learner highlights the quantities before choosing a strategy.'],
  sourceMessageIds: ['maya-student-1'],
  status: 'proposed',
  createdAt: 'Today · 10:44 AM',
};

export const DEMO_REGION_BY_ID = Object.fromEntries(DEMO_REGIONS.map((region) => [region.id, region]));
export const DEMO_ANNOTATION_BY_ID = Object.fromEntries(
  DEMO_ANNOTATIONS.map((annotation) => [annotation.id, annotation]),
);

export function getDemoStudent(studentId: DemoStudentId) {
  return DEMO_STUDENTS.find((student) => student.id === studentId) ?? DEMO_STUDENTS[0];
}
