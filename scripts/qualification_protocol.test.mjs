import assert from 'node:assert/strict';
import test from 'node:test';
import { qualificationCounter, qualificationResources } from './qualification_protocol.mjs';
test('qualification control counters reject untrusted payloads without echoing them', () => {
  for (const value of ['secret-value', '1', null, {}, [], -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => qualificationCounter(value), { message: 'Invalid qualification counter' });
  }
  for (const value of [0, 1, 500, Number.MAX_SAFE_INTEGER]) assert.equal(qualificationCounter(value), value);
});
test('resource evidence preserves counts and rejects failed or arbitrary process payloads', () => {
  const metrics = { heap_alloc: 1, heap_inuse: 2, sys: 3, goroutines: 4, fixture_pid: 5, fixture_rss_bytes: 6 };
  assert.deepEqual(qualificationResources({ ...metrics, secret: 'must not persist' }), metrics);
  assert.throws(() => qualificationResources({ ...metrics, fixture_rss_error: 'secret error detail' }), { message: 'Qualification process memory unavailable' });
  assert.throws(() => qualificationResources({ ...metrics, heap_alloc: '1' }));
});
