import assert from 'node:assert/strict';
import test from 'node:test';

import {
  messageKey,
  normalizeLearner,
  normalizeLearnerList,
  normalizeMessage,
} from '../src/features/learners/client';
import { createStableThreadId } from '../src/hooks/use-learner-session';

test('normalizes only complete learner records and preserves stable ids', () => {
  const learner = normalizeLearner({
    _id: 'convex-id',
    studentId: 'learner-1',
    displayName: 'Ari',
    ownerUserId: 'user-1',
    isSynthetic: false,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
  });
  assert.equal(learner?.studentId, 'learner-1');
  assert.equal(learner?._id, 'convex-id');
  assert.equal(normalizeLearner({ studentId: 'missing-name' }), null);
});

test('normalizes learner lists without allowing malformed rows to leak into UI', () => {
  const rows = normalizeLearnerList([
    { studentId: 'one', displayName: 'One', createdAt: '2026-08-17', updatedAt: '2026-08-17' },
    { studentId: 'invalid' },
    null,
  ]);
  assert.deepEqual(rows.map((row) => row.studentId), ['one']);
});

test('requires explicit message role and creates deterministic fallback keys', () => {
  const message = normalizeMessage({
    _id: 'message-1',
    studentId: 'learner-1',
    threadId: 'thread-1',
    role: 'tutor',
    text: 'Try the first step.',
    annotationIds: ['annotation-1', 42],
    createdAt: '2026-08-17T01:00:00.000Z',
  });
  assert.equal(message?.annotationIds.length, 1);
  assert.equal(messageKey(message!), 'message-1');
  assert.equal(normalizeMessage({ studentId: 'learner-1', threadId: 'thread-1', text: 'No role' }), null);
});

test('filters hidden system kickoffs at the client boundary', () => {
  assert.equal(normalizeMessage({
    _id: 'kickoff-1',
    studentId: 'learner-1',
    threadId: 'worksheet-thread',
    role: 'student',
    text: 'Begin by welcoming the learner.',
    isVisible: false,
    createdAt: '2026-08-17T01:00:00.000Z',
  }), null);
  assert.equal(normalizeMessage({
    _id: 'reply-1',
    studentId: 'learner-1',
    threadId: 'worksheet-thread',
    role: 'tutor',
    text: 'Welcome back.',
    scope: 'worksheet',
    contextKey: 'page:1:revision:2',
    createdAt: '2026-08-17T01:00:01.000Z',
  })?.scope, 'worksheet');
});

test('worksheet thread IDs are stable per learner and context but isolated across contexts', () => {
  const first = createStableThreadId('learner-1', 'page:1:revision:2');
  assert.equal(first, createStableThreadId('learner-1', 'page:1:revision:2'));
  assert.notEqual(first, createStableThreadId('learner-1', 'page:1:revision:3'));
  assert.notEqual(first, createStableThreadId('learner-2', 'page:1:revision:2'));
});
