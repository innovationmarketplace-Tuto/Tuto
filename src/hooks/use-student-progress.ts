import { useQuery_experimental } from 'convex/react';
import { useMemo } from 'react';

import { api } from '../../convex/_generated/api';

const EMPTY_QUERY_DATA: never[] = [];

export type StudentSkillProgress = {
  skillId: string;
  name: string;
  mastery: number | null;
  confidence: number;
  evidenceCount: number;
  lastPracticedAt?: string;
  misconceptionIds: string[];
};

export type StudentMemoryItem = {
  id: string;
  text: string;
  createdAt?: string;
};

export type StudentProgressState = {
  skills: StudentSkillProgress[];
  facts: StudentMemoryItem[];
  episodes: StudentMemoryItem[];
  status: 'loading' | 'ready' | 'error';
  error: Error | null;
};

/**
 * Student-safe read model for progress and memory. The underlying Convex
 * records stay private to the authenticated owner; this hook only exposes
 * language suitable for a learner-facing summary.
 */
export function useStudentProgress(studentId: string | null, enabled = true): StudentProgressState {
  const active = Boolean(enabled && studentId);
  const statesQuery = useQuery_experimental({
    query: api.memory.listStates,
    args: active ? { studentId: studentId! } : 'skip',
  });
  const factsQuery = useQuery_experimental({
    query: api.memory.listFacts,
    args: active ? { studentId: studentId! } : 'skip',
  });
  const episodesQuery = useQuery_experimental({
    query: api.memory.listEpisodes,
    args: active ? { studentId: studentId! } : 'skip',
  });
  const skillsQuery = useQuery_experimental({
    query: api.skills.listActive,
    args: active ? {} : 'skip',
  });

  // Pull successful payloads into stable locals before entering memoized
  // callbacks. Convex's discriminated query result is narrowed here, while
  // dependency arrays remain valid when a query is pending or errored.
  const skillsData = skillsQuery.status === 'success' ? skillsQuery.data : EMPTY_QUERY_DATA;
  const statesData = statesQuery.status === 'success' ? statesQuery.data : EMPTY_QUERY_DATA;
  const factsData = factsQuery.status === 'success' ? factsQuery.data : EMPTY_QUERY_DATA;
  const episodesData = episodesQuery.status === 'success' ? episodesQuery.data : EMPTY_QUERY_DATA;

  const skills = useMemo(() => {
    const skillRows = Array.isArray(skillsData) ? skillsData : [];
    const labels = new Map<string, string>();
    for (const row of skillRows) {
      if (!isRecord(row)) continue;
      const id = asString(row._id ?? row.id);
      const name = asString(row.name);
      if (id && name) labels.set(id, name);
    }

    const stateRows = Array.isArray(statesData) ? statesData : [];
    return stateRows
      .filter(isRecord)
      .map((row) => {
        const skillId = asString(row.skillId);
        const mastery = asNumberOrNull(row.mastery);
        return {
          skillId,
          name: labels.get(skillId) ?? humanizeSkillId(skillId),
          mastery,
          confidence: clamp(asNumber(row.confidence)),
          evidenceCount: Math.max(0, Math.round(asNumber(row.evidenceCount))),
          ...(asString(row.lastPracticedAt) ? { lastPracticedAt: asString(row.lastPracticedAt) } : {}),
          misconceptionIds: Array.isArray(row.misconceptionIds)
            ? row.misconceptionIds.filter((item): item is string => typeof item === 'string')
            : [],
        } satisfies StudentSkillProgress;
      })
      .filter((row) => row.skillId.length > 0)
      .sort((left, right) => (right.lastPracticedAt ?? '').localeCompare(left.lastPracticedAt ?? ''));
  }, [skillsData, statesData]);

  const facts = useMemo(
    () => normalizeMemoryItems(factsData, (row) => {
      const key = asString(row.key);
      const value = asString(row.value);
      return key && value ? `${friendlyFactKey(key)}: ${value}` : value;
    }),
    [factsData],
  );
  const episodes = useMemo(
    () => normalizeMemoryItems(episodesData, (row) => asString(row.summary)),
    [episodesData],
  );

  const queryError = statesQuery.status === 'error'
    ? statesQuery.error
    : factsQuery.status === 'error'
      ? factsQuery.error
      : episodesQuery.status === 'error'
        ? episodesQuery.error
        : skillsQuery.status === 'error'
          ? skillsQuery.error
          : null;
  const pending = active && [statesQuery, factsQuery, episodesQuery, skillsQuery].some((query) => query.status === 'pending');

  return {
    skills,
    facts,
    episodes,
    status: pending ? 'loading' : queryError ? 'error' : 'ready',
    error: queryError,
  };
}

function normalizeMemoryItems(value: unknown, textFor: (row: Record<string, unknown>) => string): StudentMemoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((row, index) => {
      const text = textFor(row).trim();
      if (!text) return null;
      const id = asString(row._id ?? row.id) || `memory-${index}`;
      const createdAt = asString(row.createdAt);
      return { id, text, ...(createdAt ? { createdAt } : {}) };
    })
    .filter((item): item is StudentMemoryItem => item !== null)
    .slice(0, 4);
}

function friendlyFactKey(key: string): string {
  const normalized = key.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return 'Note';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanizeSkillId(skillId: string): string {
  const value = skillId.split(':').pop()?.split('/').pop() ?? skillId;
  const normalized = value.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return 'A skill you are practicing';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
