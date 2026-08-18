import type { Skill } from "../domain/skills";
import type { TeachingBrief } from "../domain/tutoring";
import type { DemoStudent } from "../constants/demo-fixtures";
import { DEMO_STUDENTS } from "../constants/demo-fixtures";

export const GOLDEN_SKILLS: Skill[] = [
  {
    id: "fractions-equivalent",
    namespace: "tuto-demo",
    status: "active",
    name: "Recognize equivalent fractions",
    objective: "Recognize equivalent fractions",
    subject: "fractions",
    level: "grade-6",
    aliases: ["equivalent fractions", "scale numerator and denominator together"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "fraction-common-denominator",
    namespace: "tuto-demo",
    status: "active",
    name: "Find a common denominator",
    objective: "Find a common denominator before adding fractions",
    subject: "fractions",
    level: "grade-6",
    aliases: ["common denominator", "make denominators match"],
    version: 1,
    createdBy: "human",
  },
  {
    id: "fraction-addition",
    namespace: "tuto-demo",
    status: "active",
    name: "Add fractions with unlike denominators",
    objective: "Add fractions with unlike denominators",
    subject: "fractions",
    level: "grade-6",
    aliases: ["unlike denominator fraction addition"],
    version: 1,
    createdBy: "human",
  },
];

function briefForStudent(student: DemoStudent): TeachingBrief {
  return {
    currentSkillIds: student.skillStates.map((state) => state.skillId),
    skillStates: student.skillStates,
    prerequisiteGaps: student.skillStates.filter((state) => state.mastery === null || (state.mastery ?? 0) < 0.7),
    activeMisconceptions: student.skillStates.flatMap((state) => state.misconceptionIds),
    relevantEpisodes: student.evidence.map((evidence) => evidence.detail),
  };
}

export const GOLDEN_TEACHING_BRIEFS: Record<string, TeachingBrief> = Object.fromEntries(
  DEMO_STUDENTS.map((student) => [student.id, briefForStudent(student)]),
);

