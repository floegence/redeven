import { describe, expect, it, vi } from 'vitest';
import { flowerRequestStallSeconds, flowerRequestWaitSeconds, mapFlowerProviderRequestProgress } from './providerRequestProgress';

const request = { logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1,
  started_at: '2026-10-15T00:00:00Z', estimated_output_tokens: 0 };

describe('provider request waiting age', () => {
  it('preserves elapsed age across delayed samples without trusting the wall clock', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      const first = mapFlowerProviderRequestProgress(request, Date.parse(request.started_at) + 5000);
      now.mockReturnValue(4000);
      const delayed = mapFlowerProviderRequestProgress(request, Date.parse(request.started_at) + 6000, first);
      expect(flowerRequestWaitSeconds(delayed, performance.now())).toBe(8);
      const next = mapFlowerProviderRequestProgress({ ...request, attempt_id: 'next', attempt_epoch: 2 }, Date.parse(request.started_at), first);
      expect(flowerRequestWaitSeconds(next, performance.now())).toBeNull();
    } finally { now.mockRestore(); }
  });
});

it('measures semantic output pauses across reconnects and resets on new progress', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
  try {
    const first = mapFlowerProviderRequestProgress({ ...request, first_output_at: '2026-10-15T00:00:02Z', last_progress_at: '2026-10-15T00:00:03Z', estimated_output_tokens: 42 }, Date.parse(request.started_at) + 18000);
    expect(flowerRequestStallSeconds(first, performance.now())).toBe(15);
    now.mockReturnValue(6000);
    const delayed = mapFlowerProviderRequestProgress({ ...first }, Date.parse(request.started_at) + 20000, first);
    expect(flowerRequestStallSeconds(delayed, performance.now())).toBe(20);
    const resumed = mapFlowerProviderRequestProgress({ ...first, last_progress_at: '2026-10-15T00:00:23Z' }, Date.parse(request.started_at) + 23000, delayed);
    expect(flowerRequestStallSeconds(resumed, performance.now())).toBeNull();
    const next = mapFlowerProviderRequestProgress({ ...request, attempt_id: 'next', attempt_epoch: 2 }, Date.parse(request.started_at), resumed);
    expect(flowerRequestStallSeconds(next, performance.now())).toBeNull();
  } finally { now.mockRestore(); }
});
