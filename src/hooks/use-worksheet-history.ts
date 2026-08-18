import { useQuery_experimental } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../convex/_generated/api';
import type {
  WorksheetHistoryItem,
  WorksheetHistoryStatus,
} from '@/domain/artifacts';

const EMPTY_HISTORY: WorksheetHistoryItem[] = [];
const historyStatuses = new Set<WorksheetHistoryStatus>([
  'pending',
  'scheduled',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type WorksheetHistoryStateStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UseWorksheetHistoryOptions = {
  enabled?: boolean;
  limit?: number;
  /** Controlled selection. `selectedPageId` and `selectedId` are aliases. */
  selectedWorksheetId?: string | null;
  selectedPageId?: string | null;
  selectedId?: string | null;
  /** Initial selection for the hook's uncontrolled mode. */
  defaultSelectedWorksheetId?: string | null;
  defaultSelectedPageId?: string | null;
  defaultSelectedId?: string | null;
};

export type WorksheetHistoryState = {
  worksheets: WorksheetHistoryItem[];
  /** Alias useful for generic list renderers. */
  items: WorksheetHistoryItem[];
  selectedWorksheet: WorksheetHistoryItem | null;
  selectedItem: WorksheetHistoryItem | null;
  selectedWorksheetId: string | null;
  selectedPageId: string | null;
  selectedId: string | null;
  selectWorksheet: (worksheet: WorksheetHistoryItem | string | null) => void;
  select: (worksheet: WorksheetHistoryItem | string | null) => void;
  status: WorksheetHistoryStateStatus;
  error: Error | null;
  isLoading: boolean;
};

/**
 * Subscribes to the authenticated learner's worksheet history and provides a
 * small controlled/uncontrolled selection adapter for history selectors.
 * The Convex query owns authorization; this hook only normalizes the safe
 * student-facing projection for rendering.
 */
export function useWorksheetHistory(
  studentId: string | null | undefined,
  options: UseWorksheetHistoryOptions = {},
): WorksheetHistoryState {
  const active = Boolean(options.enabled !== false && studentId?.trim());
  const queryState = useQuery_experimental({
    query: api.documentAnalysis.listWorksheetHistory,
    args: active
      ? {
          studentId: studentId!,
          ...(isPositiveLimit(options.limit) ? { limit: Math.floor(options.limit!) } : {}),
        }
      : 'skip',
  });

  const queryData = queryState.status === 'success' ? queryState.data : EMPTY_HISTORY;
  const worksheets = useMemo(
    () => normalizeWorksheetHistoryList(queryData),
    [queryData],
  );

  const controlledSelectedId = firstDefined(
    options.selectedWorksheetId,
    options.selectedPageId,
    options.selectedId,
  );
  const defaultSelectedId = firstDefined(
    options.defaultSelectedWorksheetId,
    options.defaultSelectedPageId,
    options.defaultSelectedId,
  ) ?? null;
  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState<string | null>(defaultSelectedId);
  const isControlled = controlledSelectedId !== undefined;
  const effectiveSelectedId = isControlled ? controlledSelectedId ?? null : uncontrolledSelectedId;

  // Reset an uncontrolled selection when the learner changes, and recover to
  // the newest page when a selected page was removed or a history query first
  // becomes ready. A controlled parent remains the source of truth.
  useEffect(() => {
    if (!active || isControlled) return;
    const selectedStillExists = effectiveSelectedId
      ? worksheets.some((worksheet) => worksheet.pageId === effectiveSelectedId || worksheet.id === effectiveSelectedId)
      : false;
    const nextId = selectedStillExists ? effectiveSelectedId : worksheets[0]?.pageId ?? null;
    if (nextId !== uncontrolledSelectedId) setUncontrolledSelectedId(nextId);
  }, [active, effectiveSelectedId, isControlled, uncontrolledSelectedId, worksheets]);

  const selectedWorksheet = useMemo(
    () => effectiveSelectedId
      ? worksheets.find((worksheet) => worksheet.pageId === effectiveSelectedId || worksheet.id === effectiveSelectedId) ?? null
      : null,
    [effectiveSelectedId, worksheets],
  );

  const selectWorksheet = useCallback((worksheet: WorksheetHistoryItem | string | null) => {
    const nextId = typeof worksheet === 'string'
      ? worksheet
      : worksheet
        ? worksheet.pageId || worksheet.id
        : null;
    if (!isControlled) setUncontrolledSelectedId(nextId);
  }, [isControlled]);

  const queryError = queryState.status === 'error' ? toError(queryState.error) : null;
  const status: WorksheetHistoryStateStatus = !active
    ? 'idle'
    : queryState.status === 'pending'
      ? 'loading'
      : queryError
        ? 'error'
        : 'ready';

  return {
    worksheets,
    items: worksheets,
    selectedWorksheet,
    selectedItem: selectedWorksheet,
    selectedWorksheetId: selectedWorksheet?.pageId ?? null,
    selectedPageId: selectedWorksheet?.pageId ?? null,
    selectedId: selectedWorksheet?.pageId ?? null,
    selectWorksheet,
    select: selectWorksheet,
    status,
    error: queryError,
    isLoading: status === 'loading',
  };
}

export function normalizeWorksheetHistoryList(value: unknown): WorksheetHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeWorksheetHistoryItem(item))
    .filter((item): item is WorksheetHistoryItem => item !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function normalizeWorksheetHistoryItem(value: unknown): WorksheetHistoryItem | null {
  if (!isRecord(value)) return null;
  const pageId = nonEmptyString(value.pageId ?? value.id);
  const artifactId = nonEmptyString(value.artifactId);
  if (!pageId || !artifactId) return null;

  const createdAt = nonEmptyString(value.createdAt ?? value.date)
    ?? nonEmptyString(value.updatedAt)
    ?? new Date(0).toISOString();
  const status = isWorksheetHistoryStatus(value.status) ? value.status : 'pending';
  const kind = isArtifactKind(value.kind) ? value.kind : 'other';
  const title = nonEmptyString(value.title) ?? 'Worksheet';
  const thumbnailValue = value.thumbnailUrl ?? value.imageUrl;
  const thumbnailUrl = typeof thumbnailValue === 'string' && thumbnailValue.trim().length > 0
    ? thumbnailValue
    : null;

  return {
    id: nonEmptyString(value.id) ?? pageId,
    artifactId,
    ...(nonEmptyString(value.artifactRecordId) ? { artifactRecordId: nonEmptyString(value.artifactRecordId)! } : {}),
    pageId,
    pageNumber: positiveInteger(value.pageNumber) ?? 1,
    pageRevision: positiveInteger(value.pageRevision) ?? 1,
    title,
    kind,
    thumbnailUrl,
    createdAt,
    ...(nonEmptyString(value.updatedAt) ? { updatedAt: nonEmptyString(value.updatedAt)! } : {}),
    ...(finitePositiveNumber(value.naturalWidth) ? { naturalWidth: value.naturalWidth as number } : {}),
    ...(finitePositiveNumber(value.naturalHeight) ? { naturalHeight: value.naturalHeight as number } : {}),
    ...(isMimeType(value.mimeType) ? { mimeType: value.mimeType } : {}),
    status,
    ...(nonEmptyString(value.jobId) ? { jobId: nonEmptyString(value.jobId)! } : {}),
    ...(nonEmptyString(value.completedAt) ? { completedAt: nonEmptyString(value.completedAt)! } : {}),
  };
}

function firstDefined(...values: (string | null | undefined)[]): string | null | undefined {
  return values.find((value) => value !== undefined);
}

function isPositiveLimit(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function finitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isWorksheetHistoryStatus(value: unknown): value is WorksheetHistoryStatus {
  return typeof value === 'string' && historyStatuses.has(value as WorksheetHistoryStatus);
}

function isArtifactKind(value: unknown): value is WorksheetHistoryItem['kind'] {
  return value === 'scan' || value === 'pdf' || value === 'photo' || value === 'other';
}

function isMimeType(value: unknown): value is NonNullable<WorksheetHistoryItem['mimeType']> {
  return value === 'image/jpeg' || value === 'image/png' || value === 'application/pdf';
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' && value.length > 0 ? value : 'Worksheet history could not be loaded.');
}
