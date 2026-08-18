import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTutorAnnotation,
  normalizeTutorAnnotationList,
} from '../src/hooks/use-tutor-annotations';

test('normalizes persisted annotation IDs and renderer fields for one page revision', () => {
  const annotation = normalizeTutorAnnotation({
    _id: 'annotation-1',
    pageId: 'page-1',
    pageRevision: 3,
    targetRegionId: 'region-1',
    messageId: 'message-1',
    kind: 'highlight',
    label: '  Check the denominator  ',
  }, 'page-1', 3);

  assert.deepEqual(annotation, {
    id: 'annotation-1',
    pageId: 'page-1',
    targetRegionId: 'region-1',
    messageId: 'message-1',
    kind: 'highlight',
    label: 'Check the denominator',
  });
});

test('drops malformed, wrong-revision, and unsupported annotation rows', () => {
  const annotations = normalizeTutorAnnotationList([
    {
      _id: 'valid',
      pageId: 'page-1',
      pageRevision: 2,
      targetRegionId: 'region-1',
      messageId: 'message-1',
      kind: 'circle',
    },
    {
      _id: 'stale',
      pageId: 'page-1',
      pageRevision: 1,
      targetRegionId: 'region-1',
      messageId: 'message-1',
      kind: 'circle',
    },
    {
      _id: 'unsupported',
      pageId: 'page-1',
      pageRevision: 2,
      targetRegionId: 'region-1',
      messageId: 'message-1',
      kind: 'freehand',
    },
    {
      _id: 'missing-target',
      pageId: 'page-1',
      pageRevision: 2,
      messageId: 'message-1',
      kind: 'focus',
    },
  ], 'page-1', 2);

  assert.deepEqual(annotations.map((item) => item.id), ['valid']);
});
