import { expect, it, vi } from 'vitest';
import { createThreadDetailLoader, type ThreadDetailTarget } from './threadDetailLoader';
const target = (revision = 1): ThreadDetailTarget => ({ epoch: 1, activityRevision: revision, settingsRevision: 1, runtimeKey: 'idle', source: 'test' });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const requests: { id: string; signal: AbortSignal; finish: (value: string) => void; fail: (error: Error) => void }[] = [];
  const onError = vi.fn(); const onLoading = vi.fn();
  const loader = createThreadDetailLoader<string>({ onError, onLoading, read: (id, _target, signal) => new Promise((finish, fail) => {
    requests.push({ id, signal, finish, fail });
    signal.addEventListener('abort', () => fail(new DOMException('cancelled', 'AbortError')), { once: true });
  }) });
  return { loader, requests, onError, onLoading };
}
it('shares consumers and has one latest successor after a burst of revisions', async () => {
  const { loader, requests } = fixture();
  const first = loader.request('a', target()); await tick();
  const next = loader.request('a', target(2));
  const latest = loader.request('a', target(3));
  expect(requests).toHaveLength(1);
  requests[0]!.finish('first'); expect(await first).toBe('first'); await tick();
  expect(requests).toHaveLength(2); requests[1]!.finish('latest');
  expect(await next).toBe('latest'); expect(await latest).toBe('latest'); await tick();
  expect(loader.size()).toBe(0);
});
it('cancels a navigation consumer without cancelling a command confirmation consumer', async () => {
  const { loader, requests } = fixture(); const navigation = new AbortController();
  const a = loader.request('a', target(), navigation.signal);
  const confirmation = loader.request('a', target()); await tick(); navigation.abort();
  expect(await a).toBeNull(); expect(requests[0]!.signal.aborted).toBe(false);
  requests[0]!.finish('confirmed'); expect(await confirmation).toBe('confirmed');
});
it('requires a read dispatched after command acknowledgement and settles superseded consumers', async () => {
  const { loader, requests } = fixture(); const navigation = new AbortController();
  const a = loader.request('a', target(), navigation.signal); await tick();
  loader.invalidate('a'); const confirmation = loader.request('a', target());
  navigation.abort(); expect(await a).toBeNull(); await tick();
  expect(requests).toHaveLength(2); expect(requests[0]!.signal.aborted).toBe(true);
  requests[1]!.finish('after command'); expect(await confirmation).toBe('after command');
});
it('does not loop on a failed target and allows explicit retry', async () => {
  const { loader, requests, onError } = fixture(); loader.retain(['a']);
  const a = loader.request('a', target()); await tick(); requests[0]!.fail(new Error('offline'));
  expect(await a).toBeNull(); await tick(); expect(await loader.request('a', target())).toBeNull();
  expect(requests).toHaveLength(1); expect(onError).toHaveBeenCalledOnce();
  loader.invalidate('a'); const retry = loader.request('a', target()); await tick();
  requests[1]!.finish('recovered'); expect(await retry).toBe('recovered'); await tick();
  loader.retain([]); expect(loader.size()).toBe(0);
});
it('disposal settles active and pending reads and cannot publish a late response', async () => {
  const { loader, requests, onError } = fixture();
  const a = loader.request('a', target()); await tick(); const b = loader.request('a', target(2));
  loader.dispose(); expect(await a).toBeNull(); expect(await b).toBeNull();
  requests[0]!.finish('late'); await tick(); expect(onError).not.toHaveBeenCalled(); expect(loader.size()).toBe(0);
});
it('observes a lifecycle change even when numeric revisions are unchanged', async () => {
  const { loader, requests } = fixture(); const a = loader.request('a', target()); await tick();
  const b = loader.request('a', { ...target(), runtimeKey: 'running' });
  requests[0]!.finish('idle'); await a; await tick(); expect(requests).toHaveLength(2);
  requests[1]!.finish('running'); expect(await b).toBe('running');
});
it('dispatches a reentrant consumer after the completed batch settles', async () => {
  const { loader, requests } = fixture(); loader.retain(['a']);
  const first = loader.request('a', target()); await tick();
  const next = first.then(() => loader.request('a', target()));
  requests[0]!.finish('first'); await tick();
  expect(requests).toHaveLength(2);
  requests[1]!.finish('second'); expect(await next).toBe('second');
});
it('bounds idle records to retained detail cache entries after many reads', async () => {
  const { loader, requests } = fixture(); loader.retain(['retained']);
  for (let i = 0; i < 30; i++) {
    const read = loader.request('thread-' + i, target()); await tick();
    requests.at(-1)!.fail(new Error('unavailable')); await read; await tick();
  }
  expect(loader.size()).toBe(0);
});
