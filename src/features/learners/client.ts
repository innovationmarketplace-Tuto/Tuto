import { makeFunctionReference, type FunctionReference } from 'convex/server';

import { api } from '../../../convex/_generated/api';

/**
 * Client-side records used by the product shell.
 *
 * These types deliberately contain no Convex `Doc` types.  The app can stay
 * usable while the generated API changes, and the only place that knows the
 * wire shape is this boundary.
 */
export type LearnerRecord = {
  id?: string;
  _id?: string;
  studentId: string;
  displayName: string;
  ownerUserId?: string;
  isSynthetic?: boolean;
  isSelfOwned?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LearnerListResult = LearnerRecord[];

/** A conversation's product surface. Legacy rows without a scope are chat rows. */
export type LearnerSessionScope = 'chat' | 'worksheet';

export type LearnerSessionRecord = {
  id?: string;
  _id?: string;
  studentId: string;
  ownerUserId?: string;
  threadId: string;
  scope?: LearnerSessionScope;
  /** Stable worksheet/page context used to keep page conversations isolated. */
  contextKey?: string;
  activityId?: string;
  currentProblem?: string;
  currentSkillIds: string[];
  hintsShown: number;
  hintSummaries: string[];
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type LearnerMessageRecord = {
  id?: string;
  _id?: string;
  studentId: string;
  threadId: string;
  role: 'student' | 'tutor';
  text: string;
  annotationIds: string[];
  scope?: LearnerSessionScope;
  contextKey?: string;
  /** System kickoff messages are persisted for auditability but hidden in chat history. */
  isVisible?: boolean;
  isHidden?: boolean;
  createdAt: string;
  isNew?: boolean;
};

export type CreateMessageArgs = {
  studentId: string;
  threadId: string;
  text: string;
  role?: 'student' | 'tutor';
  scope?: LearnerSessionScope;
  contextKey?: string;
  pageId?: string;
  pageRevision?: number;
  idempotencyKey?: string;
};

export type TutorTurnArgs = {
  studentId: string;
  threadId: string;
  message: string;
  idempotencyKey?: string;
  activityId?: string;
  currentProblem?: string;
  currentSkillIds?: string[];
  recentMessages?: Pick<LearnerMessageRecord, 'role' | 'text'>[];
  scope?: LearnerSessionScope;
  contextKey?: string;
  /** A hidden student kickoff is durable but is not returned by messages:list. */
  systemInitiated?: boolean;
  /** Compatibility alias for callers that phrase this as a predicate. */
  isSystemInitiated?: boolean;
  pageId?: string;
  pageRevision?: number;
  activeRegionId?: string;
  activeRegionIds?: string[];
};

export type TutorTurnResult = {
  reply: string;
  annotations?: { id: string; targetRegionId: string }[];
  metadata?: {
    model?: string;
    provider?: string;
    fallbackUsed?: boolean;
  };
};

/** Direct-to-student profile contract. These functions never expose a list. */
export const learnerSelfRef = makeFunctionReference<'query', Record<string, never>, LearnerRecord | null>('learners:getSelf');
export const learnerEnsureSelfRef = makeFunctionReference<'mutation', { displayName?: string }, LearnerRecord>('learners:ensureSelf');

export const messageListRef = makeFunctionReference<
  'query',
  {
    studentId: string;
    threadId: string;
    limit?: number;
    scope?: LearnerSessionScope;
    contextKey?: string;
  },
  LearnerMessageRecord[]
>('messages:list');
export const messageCreateRef = makeFunctionReference<'mutation', CreateMessageArgs, string>('messages:create');
export const tutorTurnRef = makeFunctionReference<'action', TutorTurnArgs, TutorTurnResult>('tutor:turn');

/** Existing, authentication-gated APIs owned by the memory/artifact modules. */
export const sessionListRef = api.memory.listSessions as FunctionReference<
  'query',
  'public',
  { studentId: string; scope?: LearnerSessionScope; contextKey?: string },
  LearnerSessionRecord[]
>;
export const sessionUpsertRef = api.memory.upsertSession as FunctionReference<
  'mutation',
  'public',
  {
    studentId: string;
    threadId: string;
    scope?: LearnerSessionScope;
    contextKey?: string;
    activityId?: string;
    currentProblem?: string;
    currentSkillIds: string[];
    hintsShown?: number;
    hintSummaries?: string[];
    status?: LearnerSessionRecord['status'];
  },
  string
>;
export const artifactMessageCreateRef = api.artifacts.createMessage as FunctionReference<
  'mutation',
  'public',
  { studentId: string; threadId: string; text: string; pageId?: never; pageRevision?: never },
  string
>;

export function learnerKey(learner: Pick<LearnerRecord, 'studentId'>): string {
  return learner.studentId;
}

export function messageKey(message: Pick<LearnerMessageRecord, 'id' | '_id' | 'threadId' | 'createdAt'>): string {
  return message.id ?? message._id ?? `${message.threadId}:${message.createdAt}`;
}

export function normalizeLearner(value: unknown): LearnerRecord | null {
  if (!isRecord(value)) return null;
  const studentId = readNonEmptyString(value.studentId);
  const displayName = readNonEmptyString(value.displayName);
  const createdAt = readNonEmptyString(value.createdAt);
  const updatedAt = readNonEmptyString(value.updatedAt);
  if (!studentId || !displayName || !createdAt || !updatedAt) return null;
  return {
    id: readOptionalString(value.id),
    _id: readOptionalString(value._id),
    studentId,
    displayName,
    ownerUserId: readOptionalString(value.ownerUserId),
    isSynthetic: typeof value.isSynthetic === 'boolean' ? value.isSynthetic : undefined,
    isSelfOwned: typeof value.isSelfOwned === 'boolean' ? value.isSelfOwned : undefined,
    createdAt,
    updatedAt,
  };
}

export function normalizeLearnerList(value: unknown): LearnerListResult {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeLearner).filter((item): item is LearnerRecord => item !== null);
}

export function normalizeMessage(value: unknown): LearnerMessageRecord | null {
  if (!isRecord(value)) return null;
  const studentId = readNonEmptyString(value.studentId);
  const threadId = readNonEmptyString(value.threadId);
  const text = readNonEmptyString(value.text);
  const createdAt = readNonEmptyString(value.createdAt);
  if (!studentId || !threadId || !text || !createdAt) return null;
  const role = value.role === 'tutor' ? 'tutor' : value.role === 'student' ? 'student' : null;
  if (!role) return null;
  // The backend filters these rows too; keep the client boundary defensive so
  // a stale/cache response can never reveal a system kickoff in the UI.
  if (value.isVisible === false || value.isHidden === true) return null;
  const scope = value.scope === 'worksheet' || value.scope === 'chat' ? value.scope : undefined;
  const contextKey = readOptionalString(value.contextKey);
  const annotationIds = Array.isArray(value.annotationIds)
    ? value.annotationIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    id: readOptionalString(value.id),
    _id: readOptionalString(value._id),
    studentId,
    threadId,
    role,
    text,
    annotationIds,
    scope,
    contextKey,
    isVisible: typeof value.isVisible === 'boolean' ? value.isVisible : undefined,
    isHidden: typeof value.isHidden === 'boolean' ? value.isHidden : undefined,
    createdAt,
    isNew: typeof value.isNew === 'boolean' ? value.isNew : undefined,
  };
}

export function normalizeMessageList(value: unknown): LearnerMessageRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMessage).filter((item): item is LearnerMessageRecord => item !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
