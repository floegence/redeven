// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedServiceUpdatePreparation } from './managedServiceUpdatePreparation';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../services/localApi', () => ({ fetchLocalApiJSON: api.fetch }));
const selection = (id: string, serviceID = 'service-a') => ({ serviceID, candidateID: id, identity: id });
const plan = (id: string, expires = Date.now() + 60_000) => ({ schema_version: 4, update_plan_id: id, expires_at_unix_ms: expires });
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

let dispose: (() => void) | undefined;
function setup(initial: ReturnType<typeof selection> | null) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [target, setTarget] = createSignal(initial);
    return { ...createManagedServiceUpdatePreparation(target), setTarget };
  });
}
afterEach(() => { dispose?.(); vi.useRealTimers(); api.fetch.mockReset(); });

describe('managed update preparation', () => {
  it('coalesces rapid selections and rejects a late response from the old selection', async () => {
    let complete: (value: unknown) => void = () => {};
    api.fetch.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; })).mockResolvedValue(plan('latest'));
    const state = setup(selection('first'));
    await flush();
    state.setTarget(selection('skipped'));
    state.setTarget(selection('latest'));
    await flush();
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect((api.fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    complete(plan('first'));
    await flush();
    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(api.fetch.mock.calls[1][1].body)).toEqual({ target_candidate_id: 'latest' });
    expect(state.plan()?.update_plan_id).toBe('latest');
  });

  it('keeps the plan when a candidate is replaced by the same identity', async () => {
    api.fetch.mockResolvedValue(plan('prepared'));
    const state = setup(selection('selected'));
    await flush();
    state.setTarget(selection('selected'));
    await flush();
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(state.plan()?.update_plan_id).toBe('prepared');
  });

  it('discards closed-session results and prepares the newly opened service', async () => {
    let complete: (value: unknown) => void = () => {};
    api.fetch.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; })).mockResolvedValue(plan('other-service'));
    const state = setup(selection('selected'));
    await flush();
    state.setTarget(null);
    await flush();
    expect(state.plan()).toBeNull();
    expect(state.loading()).toBe(false);
    state.setTarget(selection('selected', 'service-b'));
    complete(plan('wrong-service'));
    await flush();
    expect(state.plan()?.update_plan_id).toBe('other-service');
    expect(api.fetch.mock.calls[1][0]).toContain('/service-b/update-plans');
  });

  it('expires a plan in place without creating an update operation', async () => {
    vi.useFakeTimers();
    api.fetch.mockImplementationOnce(async () => plan('old', Date.now() + 1000)).mockImplementation(async () => plan('renewed'));
    const state = setup(selection('selected'));
    await flush();
    expect(state.plan()?.update_plan_id).toBe('old');
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.plan()?.update_plan_id).toBe('renewed');
    expect(api.fetch.mock.calls.every(([url]) => url.endsWith('/update-plans'))).toBe(true);
  });

  it('requires explicit retry after a source failure', async () => {
    api.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(plan('retry'));
    const state = setup(selection('selected'));
    await flush();
    expect(state.error()).toBeInstanceOf(Error);
    expect(state.loading()).toBe(false);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    state.refresh();
    await flush();
    expect(state.plan()?.update_plan_id).toBe('retry');
    expect(state.error()).toBeNull();
  });
});
