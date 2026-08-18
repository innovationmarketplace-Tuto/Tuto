import { useQuery_experimental } from 'convex/react';
import { useMemo } from 'react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { TutorAnnotation } from '../domain/annotations';

const annotationKinds = new Set<TutorAnnotation['kind']>([
  'highlight',
  'circle',
  'underline',
  'arrow',
  'focus',
  'label',
]);

export type TutorAnnotationsOptions = {
  pageId: string | null | undefined;
  pageRevision: number | null | undefined;
  enabled?: boolean;
};

export type TutorAnnotationsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type TutorAnnotationsState = {
  annotations: TutorAnnotation[];
  status: TutorAnnotationsStatus;
  error: Error | null;
};

/**
 * Keeps the worksheet overlay subscribed to the persisted annotations for
 * exactly one displayed page revision. Convex re-runs this query whenever a
 * tutor turn persists or changes an annotation; no local fixture is involved.
 */
export function useTutorAnnotations({
  pageId,
  pageRevision,
  enabled = true,
}: TutorAnnotationsOptions): TutorAnnotationsState {
  const revision = isPositiveInteger(pageRevision) ? pageRevision : null;
  const active = Boolean(enabled && pageId?.trim() && revision !== null);
  const queryState = useQuery_experimental({
    query: api.artifacts.listAnnotations,
    args: active
      ? { pageId: pageId as Id<'artifactPages'>, pageRevision: revision! }
      : 'skip',
  });

  const data = queryState.status === 'success' ? queryState.data : null;
  const annotations = useMemo(
    () => normalizeTutorAnnotationList(data, active ? pageId! : undefined, active ? revision! : undefined),
    [active, data, pageId, revision],
  );
  const error = queryState.status === 'error' ? queryState.error : null;
  const status: TutorAnnotationsStatus = !active
    ? 'idle'
    : queryState.status === 'pending'
      ? 'loading'
      : error
        ? 'error'
        : 'ready';

  return { annotations, status, error };
}

/**
 * Converts a Convex annotation row (`_id`) into the shared renderer contract
 * (`id`) while dropping malformed or cross-revision rows at the client edge.
 */
export function normalizeTutorAnnotation(
  value: unknown,
  expectedPageId?: string,
  expectedPageRevision?: number,
): TutorAnnotation | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id ?? value._id);
  const pageId = nonEmptyString(value.pageId);
  const targetRegionId = nonEmptyString(value.targetRegionId);
  const messageId = nonEmptyString(value.messageId);
  const kind = value.kind;
  if (!id || !pageId || !targetRegionId || !messageId || !isAnnotationKind(kind)) return null;
  if (expectedPageId !== undefined && pageId !== expectedPageId) return null;
  if (expectedPageRevision !== undefined && value.pageRevision !== expectedPageRevision) return null;
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  return {
    id,
    pageId,
    targetRegionId,
    messageId,
    kind,
    ...(label ? { label } : {}),
  };
}

export function normalizeTutorAnnotationList(
  value: unknown,
  expectedPageId?: string,
  expectedPageRevision?: number,
): TutorAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeTutorAnnotation(item, expectedPageId, expectedPageRevision))
    .filter((item): item is TutorAnnotation => item !== null);
}

function isAnnotationKind(value: unknown): value is TutorAnnotation['kind'] {
  return typeof value === 'string' && annotationKinds.has(value as TutorAnnotation['kind']);
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
