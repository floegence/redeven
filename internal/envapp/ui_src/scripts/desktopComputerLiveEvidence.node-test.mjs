import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodedLiveFramesForTarget } from './desktopComputerLiveEvidence.mjs';

test('live evidence requires distinct decoded images in the same thread and target', () => {
  const frame = { target: 'desktop', thread: 'owner', sha256: 'image', at: 100 };
  const decoded = { ...frame, at: 200 };
  const evidence = { frames: [frame, { ...frame, at: 150 }], decoded: [decoded] };
  assert.equal(decodedLiveFramesForTarget(evidence, 'desktop').length, 1);
  for (const change of [{ target: 'browser' }, { thread: 'other' }, { sha256: 'old' }, { at: 99 }, { at: 2201 }]) {
    assert.equal(decodedLiveFramesForTarget({ frames: [frame], decoded: [{ ...decoded, ...change }] }, 'desktop').length, 0);
  }
  evidence.decoded.push({ ...decoded, at: 250 });
  assert.equal(decodedLiveFramesForTarget(evidence, 'desktop').length, 2);
});
