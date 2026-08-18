import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTutorMetadata } from '../../convex/lib/tutor';

test('tutor metadata boundary drops provider secrets and unknown payloads', () => {
  const normalized = normalizeTutorMetadata({
    provider: 'fake',
    model: ' deterministic-tutor-v1 ',
    latencyMs: -12.4,
    usage: { inputTokens: 3.9, outputTokens: Number.POSITIVE_INFINITY, totalTokens: 8 },
    fallbackUsed: true,
    fallbackReason: 'x'.repeat(600),
    rawResponse: { accessKeyId: 'must-not-escape' },
    prompt: 'must-not-escape',
  });

  assert.deepEqual(normalized, {
    provider: 'fake',
    model: 'deterministic-tutor-v1',
    latencyMs: 0,
    fallbackUsed: true,
    fallbackReason: 'x'.repeat(500),
    usage: { inputTokens: 3, totalTokens: 8 },
  });
  assert.equal(JSON.stringify(normalized).includes('must-not-escape'), false);
});

test('tutor metadata boundary rejects unsupported provider names', () => {
  assert.deepEqual(normalizeTutorMetadata({ provider: 'aws', model: 'x' }), { model: 'x' });
  assert.equal(normalizeTutorMetadata({ raw: 'only raw fields' }), undefined);
});

