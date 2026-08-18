import { useAction, useQuery_experimental } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  messageKey,
  messageListRef,
  normalizeMessageList,
  sessionListRef,
  tutorTurnRef,
  type LearnerMessageRecord,
  type LearnerSessionRecord,
  type LearnerSessionScope,
  type TutorTurnArgs,
  type TutorTurnResult,
} from '@/features/learners/client';

export type SessionSendState = 'idle' | 'sending' | 'error';
export type LearnerSessionStatus = 'loading' | 'ready' | 'empty' | 'error';

export type SystemTutorTurnOptions = Pick<
  TutorTurnArgs,
  'idempotencyKey' | 'activityId' | 'currentProblem' | 'currentSkillIds'
>;

export type LearnerSessionState = {
  /** The effective scope after applying the page-context fallback. */
  scope: LearnerSessionScope;
  /** Null for general chat or before a worksheet context is available. */
  contextKey: string | null;
  threadId: string | null;
  /** Sessions already filtered to this learner, scope, and worksheet context. */
  sessions: LearnerSessionRecord[];
  /** Explicit alias for consumers that call the list session history. */
  sessionHistory: LearnerSessionRecord[];
  messages: LearnerMessageRecord[];
  sendState: SessionSendState;
  sendError: Error | null;
  status: LearnerSessionStatus;
  error: Error | null;
  input: string;
  setInput: (value: string) => void;
  sendMessage: (message?: string) => Promise<void>;
  /** Starts a tutor turn without showing its student kickoff in chat history. */
  sendSystemTutorTurn: (prompt: string, options?: SystemTutorTurnOptions) => Promise<void>;
  sendSystemTurn: (prompt: string, options?: SystemTutorTurnOptions) => Promise<void>;
  /** Naming alias for callers that model the operation as starting a turn. */
  startTutorTurn: (prompt: string, options?: SystemTutorTurnOptions) => Promise<void>;
  selectThread: (nextThreadId: string) => void;
  /** Starts a fresh, scoped thread and returns its local ID. */
  newConversation: () => string | null;
  retryMessage: () => void;
  retry: () => void;
};

export type LearnerSessionOptions = {
  studentId: string | null;
  enabled?: boolean;
  scope?: LearnerSessionScope;
  /** Stable key for a worksheet/page. `pageId` is used when omitted. */
  worksheetContextKey?: string;
  /** Short aliases retained for integrations that already call this a context key. */
  contextKey?: string;
  worksheetKey?: string;
  pageContextKey?: string;
  currentSkillIds?: string[];
  activityId?: string;
  currentProblem?: string;
  pageId?: string;
  pageRevision?: number;
  activeRegionIds?: string[];
};

type SessionOptions = LearnerSessionOptions;

/**
 * Restores a learner's latest active session inside one product scope, then
 * keeps its messages live via Convex. Legacy sessions without scope metadata
 * are treated as general chat sessions; worksheet sessions are always keyed by
 * their worksheet/page context.
 */
export function useLearnerSession({
  studentId,
  enabled = true,
  scope: requestedScope,
  worksheetContextKey,
  contextKey: contextKeyAlias,
  worksheetKey,
  pageContextKey,
  currentSkillIds = [],
  activityId,
  currentProblem,
  pageId,
  pageRevision,
  activeRegionIds = [],
}: SessionOptions): LearnerSessionState {
  // Existing callers that provide a page are implicitly worksheet callers. A
  // caller can still opt into a worksheet before a page has loaded by passing
  // scope and worksheetContextKey explicitly.
  const scope: LearnerSessionScope = requestedScope ?? (pageId ? 'worksheet' : 'chat');
  const contextKey = useMemo(
    () => scope === 'worksheet'
      ? normalizeContextKey(worksheetContextKey ?? contextKeyAlias ?? worksheetKey ?? pageContextKey, pageId, pageRevision)
      : null,
    [contextKeyAlias, pageContextKey, pageId, pageRevision, scope, worksheetContextKey, worksheetKey],
  );
  const active = Boolean(enabled && studentId && (scope === 'chat' || contextKey));
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [optimisticMessages, setOptimisticMessages] = useState<LearnerMessageRecord[]>([]);
  const [sendState, setSendState] = useState<SessionSendState>('idle');
  const [sendError, setSendError] = useState<Error | null>(null);
  const [, setRetryToken] = useState(0);

  const sessionsState = useQuery_experimental({
    query: sessionListRef,
    args: active ? {
      studentId: studentId!,
      scope,
      ...(contextKey ? { contextKey } : {}),
    } : 'skip',
  });
  const messagesState = useQuery_experimental({
    query: messageListRef,
    args: active && threadId ? {
      studentId: studentId!,
      threadId,
      limit: 100,
      scope,
      ...(contextKey ? { contextKey } : {}),
    } : 'skip',
  });
  const tutorTurn = useAction(tutorTurnRef);

  const sessions = useMemo(
    () => sessionsState.status === 'success'
      ? normalizeSessionList(sessionsState.data).filter((session) => sessionMatchesScope(session, scope, contextKey))
      : [],
    [contextKey, scope, sessionsState],
  );
  const persistedMessages = useMemo(
    () => messagesState.status === 'success'
      ? normalizeMessageList(messagesState.data).filter((message) => (
        message.threadId === threadId
        && (scope === 'chat'
          ? (message.scope ?? 'chat') === 'chat'
          : message.scope === 'worksheet' && message.contextKey === contextKey)
      ))
      : [],
    [contextKey, messagesState, scope, threadId],
  );

  // A scope/context change must never leave the previous thread selected for a
  // render. This is also what prevents a page from briefly showing chat rows.
  useEffect(() => {
    setInput('');
    setSendState('idle');
    setSendError(null);
    setOptimisticMessages([]);
    setThreadId(null);
  }, [contextKey, scope, studentId]);

  useEffect(() => {
    if (!active) {
      setThreadId(null);
      return;
    }
    // A newly created learner has no persisted session yet. A worksheet gets a
    // deterministic first thread, while general chat preserves legacy latest-
    // session behavior. Keep a manually selected/new thread stable locally.
    if (threadId) return;
    if (sessionsState.status !== 'success') return;
    if (scope === 'worksheet' && contextKey) {
      const stableThreadId = createStableThreadId(studentId!, contextKey);
      const stableSession = sessions.find((session) => session.threadId === stableThreadId);
      const latest = sessions.find((session) => session.status === 'active') ?? sessions[0];
      setThreadId(stableSession?.threadId ?? latest?.threadId ?? stableThreadId);
      return;
    }
    const latest = sessions.find((session) => session.status === 'active') ?? sessions[0];
    setThreadId(latest?.threadId ?? createThreadId(studentId!, scope, contextKey));
  }, [active, contextKey, scope, sessions, sessionsState.status, studentId, threadId]);

  const messages = useMemo(() => {
    const pending = optimisticMessages
      .filter((optimistic) => optimistic.threadId === threadId
        && (scope === 'chat'
          ? (optimistic.scope ?? 'chat') === 'chat'
          : optimistic.scope === 'worksheet' && optimistic.contextKey === contextKey))
      .filter((optimistic) => !persistedMessages.some((persisted) => (
      persisted.role === optimistic.role
      && persisted.text === optimistic.text
      && Math.abs(Date.parse(persisted.createdAt) - Date.parse(optimistic.createdAt)) < 10_000
    )));
    const all = [...persistedMessages, ...pending];
    const byKey = new Map<string, LearnerMessageRecord>();
    for (const message of all) byKey.set(messageKey(message), message);
    return Array.from(byKey.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [contextKey, optimisticMessages, persistedMessages, scope, threadId]);

  const runTutorTurn = useCallback(async (
    rawText: string,
    systemInitiated: boolean,
    options?: SystemTutorTurnOptions,
  ): Promise<void> => {
    const text = rawText.trim();
    if (!text || sendState === 'sending') return;
    if (!studentId || !threadId || !active) {
      setSendError(new Error(scope === 'worksheet' && !contextKey
        ? 'Choose a worksheet before starting its tutor conversation.'
        : 'Your learning space is still getting ready. Try again in a moment.'));
      setSendState('error');
      return;
    }

    const createdAt = new Date().toISOString();
    if (!systemInitiated) {
      const studentMessage: LearnerMessageRecord = {
        id: `optimistic:student:${threadId}:${createdAt}`,
        studentId,
        threadId,
        role: 'student',
        text,
        annotationIds: [],
        scope,
        ...(contextKey ? { contextKey } : {}),
        createdAt,
        isNew: true,
      };
      setOptimisticMessages((current) => [...current, studentMessage]);
      setInput('');
    }
    setSendState('sending');
    setSendError(null);

    try {
      const idempotencyKey = options?.idempotencyKey ?? `turn:${studentId}:${threadId}:${createdAt}`;
      const result = await tutorTurn({
        studentId,
        threadId,
        message: text,
        idempotencyKey,
        scope,
        ...(contextKey ? { contextKey } : {}),
        ...(systemInitiated ? { systemInitiated: true } : {}),
        activityId: options?.activityId ?? activityId,
        currentProblem: options?.currentProblem ?? currentProblem,
        currentSkillIds: Array.from(new Set(options?.currentSkillIds ?? currentSkillIds)),
        ...(pageId && pageRevision !== undefined ? {
          pageId,
          pageRevision,
          activeRegionIds: Array.from(new Set(activeRegionIds)),
        } : {}),
        // The server intentionally ignores this for durable context; it only
        // exists for compatibility with older tutor action clients.
        recentMessages: messages.slice(-10).map(({ role, text: recentText }) => ({ role, text: recentText })),
      });
      const response = normalizeTutorTurn(result);
      const tutorMessage: LearnerMessageRecord = {
        id: `optimistic:tutor:${threadId}:${Date.now()}`,
        studentId,
        threadId,
        role: 'tutor',
        text: response.reply,
        annotationIds: response.annotations?.map((annotation) => annotation.id) ?? [],
        scope,
        ...(contextKey ? { contextKey } : {}),
        createdAt: new Date().toISOString(),
        isNew: true,
      };
      setOptimisticMessages((current) => [...current, tutorMessage]);
      setSendState('idle');
    } catch (error) {
      setSendState('error');
      setSendError(toError(error, 'The tutor could not respond. Check your connection and try again.'));
    }
  }, [active, activeRegionIds, activityId, contextKey, currentProblem, currentSkillIds, messages, pageId, pageRevision, scope, sendState, studentId, threadId, tutorTurn]);

  const sendMessage = useCallback(async (messageOverride?: string) => {
    await runTutorTurn(messageOverride ?? input, false);
  }, [input, runTutorTurn]);

  const sendSystemTutorTurn = useCallback(async (
    prompt: string,
    options?: SystemTutorTurnOptions,
  ) => {
    await runTutorTurn(prompt, true, options);
  }, [runTutorTurn]);

  const selectThread = useCallback((nextThreadId: string) => {
    const candidate = nextThreadId.trim();
    if (!candidate || !sessions.some((session) => session.threadId === candidate)) return;
    setInput('');
    setSendState('idle');
    setSendError(null);
    setOptimisticMessages([]);
    setThreadId(candidate);
  }, [sessions]);

  const newConversation = useCallback((): string | null => {
    if (!studentId || !active) return null;
    const nextThreadId = createThreadId(studentId, scope, contextKey);
    setInput('');
    setSendState('idle');
    setSendError(null);
    setOptimisticMessages([]);
    setThreadId(nextThreadId);
    return nextThreadId;
  }, [active, contextKey, scope, studentId]);

  const sessionsError = sessionsState.status === 'error' ? sessionsState.error : null;
  const messagesError = messagesState.status === 'error' ? messagesState.error : null;
  const error = sessionsError ?? messagesError;
  const status: LearnerSessionStatus = !active
    ? 'empty'
    : sessionsState.status === 'pending' || (threadId !== null && messagesState.status === 'pending')
      ? 'loading'
      : error
        ? 'error'
        : messages.length === 0
          ? 'empty'
          : 'ready';

  return {
    scope,
    contextKey,
    threadId,
    sessions,
    sessionHistory: sessions,
    messages,
    sendState,
    sendError,
    status,
    error,
    input,
    setInput,
    sendMessage,
    sendSystemTutorTurn,
    sendSystemTurn: sendSystemTutorTurn,
    startTutorTurn: sendSystemTutorTurn,
    selectThread,
    newConversation,
    retryMessage: () => {
      setSendState('idle');
      setSendError(null);
    },
    retry: () => setRetryToken((token) => token + 1),
  };
}

function normalizeSessionList(value: unknown): LearnerSessionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LearnerSessionRecord => {
    if (!isRecord(item)) return false;
    return typeof item.studentId === 'string'
      && typeof item.threadId === 'string'
      && typeof item.createdAt === 'string'
      && typeof item.updatedAt === 'string'
      && Array.isArray(item.currentSkillIds)
      && Array.isArray(item.hintSummaries)
      && (item.status === 'active' || item.status === 'completed' || item.status === 'archived')
      && (item.scope === undefined || item.scope === 'chat' || item.scope === 'worksheet')
      && (item.contextKey === undefined || typeof item.contextKey === 'string');
  });
}

function sessionMatchesScope(
  session: LearnerSessionRecord,
  scope: LearnerSessionScope,
  contextKey: string | null,
): boolean {
  const sessionScope = session.scope ?? 'chat';
  if (scope === 'chat') return sessionScope === 'chat';
  return sessionScope === 'worksheet' && Boolean(contextKey) && session.contextKey === contextKey;
}

function normalizeContextKey(
  explicitKey: string | undefined,
  pageId: string | undefined,
  pageRevision: number | undefined,
): string | null {
  const candidate = explicitKey?.trim()
    || (pageId ? `page:${pageId}${pageRevision !== undefined ? `:revision:${pageRevision}` : ''}` : '');
  return candidate ? candidate.slice(0, 300) : null;
}

/** Deterministic first thread for a worksheet context; safe to call on web/native. */
export function createStableThreadId(studentId: string, contextKey: string): string {
  return `thread_worksheet_${stableHash(`${studentId}\u0000${contextKey}`)}`;
}

function createThreadId(
  studentId: string,
  scope: LearnerSessionScope,
  contextKey: string | null,
): string {
  const contextHash = contextKey ? stableHash(`${studentId}\u0000${contextKey}`) : 'general';
  return `thread_${scope}_${contextHash}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTutorTurn(value: TutorTurnResult): TutorTurnResult {
  if (!isRecord(value) || typeof value.reply !== 'string' || value.reply.trim().length === 0) {
    throw new Error('The tutor returned an invalid response.');
  }
  const annotations = Array.isArray(value.annotations)
    ? value.annotations.filter((item): item is { id: string; targetRegionId: string } => (
      isRecord(item) && typeof item.id === 'string' && typeof item.targetRegionId === 'string'
    ))
    : undefined;
  return { reply: value.reply.trim(), annotations, metadata: value.metadata };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' && value.length > 0 ? value : fallback);
}
