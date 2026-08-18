import { useMutation, useQuery_experimental } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  learnerEnsureSelfRef,
  learnerSelfRef,
  normalizeLearner,
  type LearnerRecord,
} from '@/features/learners/client';

export type StudentProfileStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type StudentProfileState = {
  profile: LearnerRecord | null;
  status: StudentProfileStatus;
  error: Error | null;
  isCreating: boolean;
  createError: Error | null;
  createProfile: (displayName: string) => Promise<LearnerRecord>;
  retry: () => void;
};

/**
 * Direct self-profile adapter for the one-account/one-student shell.
 *
 * Contract: `learners:getSelf` is an authenticated query with no arguments and
 * returns the single student profile (or null for a new account). The
 * `learners:ensureSelf` mutation accepts an optional display name and returns
 * that same profile, creating it idempotently on first use.
 */
export function useStudentProfile(enabled = true): StudentProfileState {
  const [isCreating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);
  const [autoEnsureAttempted, setAutoEnsureAttempted] = useState(false);
  const [ensuredProfile, setEnsuredProfile] = useState<LearnerRecord | null>(null);
  const [, setRetryToken] = useState(0);

  const queryState = useQuery_experimental({
    query: learnerSelfRef,
    args: enabled ? {} : 'skip',
  });
  const ensureSelf = useMutation(learnerEnsureSelfRef);
  const profileData = queryState.status === 'success' ? queryState.data : null;

  const queriedProfile = useMemo(
    () => normalizeLearner(profileData),
    [profileData],
  );
  const profile = queriedProfile ?? ensuredProfile;

  useEffect(() => {
    if (enabled) return;
    setAutoEnsureAttempted(false);
    setEnsuredProfile(null);
    setCreateError(null);
    setCreating(false);
  }, [enabled]);

  // New accounts should land directly in their learning space. The backend
  // derives the display name from the authenticated identity for this
  // idempotent first-run call; the manual name form is only a failure escape
  // hatch when an identity has no name or the mutation cannot complete.
  useEffect(() => {
    if (!enabled || queryState.status !== 'success' || queriedProfile || autoEnsureAttempted || isCreating) return;
    setAutoEnsureAttempted(true);
    setCreating(true);
    setCreateError(null);
    void ensureSelf({})
      .then((value) => {
        const normalized = normalizeLearner(value);
        if (!normalized) throw new Error('Your learning profile could not be created.');
        setEnsuredProfile(normalized);
      })
      .catch((caught) => {
        setCreateError(toError(caught, 'Your learning profile could not be created. Check your connection and try again.'));
      })
      .finally(() => setCreating(false));
  }, [autoEnsureAttempted, enabled, ensureSelf, isCreating, queriedProfile, queryState.status]);

  const error = queryState.status === 'error' ? queryState.error : null;
  const status: StudentProfileStatus = !enabled
    ? 'idle'
    : queryState.status === 'pending' || isCreating
      ? 'loading'
      : error
        ? 'error'
        : profile
          ? 'ready'
          : 'empty';

  const createProfile = useCallback(async (displayName: string) => {
    const normalizedName = displayName.trim();
    if (normalizedName.length < 2) throw new Error('Enter your name to get started.');
    if (normalizedName.length > 200) throw new Error('Names must be 200 characters or fewer.');

    setCreating(true);
    setCreateError(null);
    try {
      const result = normalizeLearner(await ensureSelf({ displayName: normalizedName }));
      if (!result) throw new Error('Your learning profile could not be created.');
      setEnsuredProfile(result);
      return result;
    } catch (caught) {
      const normalized = toError(caught, 'Your learning profile could not be created. Check your connection and try again.');
      setCreateError(normalized);
      throw normalized;
    } finally {
      setCreating(false);
    }
  }, [ensureSelf]);

  return {
    profile,
    status,
    error,
    isCreating,
    createError,
    createProfile,
    retry: () => {
      setRetryToken((token) => token + 1);
      setCreateError(null);
      setAutoEnsureAttempted(false);
    },
  };
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' && value.length > 0 ? value : fallback);
}
