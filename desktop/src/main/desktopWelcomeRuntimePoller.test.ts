import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopWelcomeRuntimePoller } from './desktopWelcomeRuntimePoller';
import { DesktopWelcomeRuntimeHealthStore, type DesktopWelcomeRuntimeHealthTarget } from './desktopWelcomeRuntimeHealth';

afterEach(() => vi.useRealTimers());

describe('DesktopWelcomeRuntimePoller', () => {
  it('keeps automatic probing disabled even when five-second polls force fresh results', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => ({}));
    const target: DesktopWelcomeRuntimeHealthTarget = {
      key: 'remote', environment_id: 'remote', slot: 'runtime_target', auto_refresh_enabled: false,
      checking_health: { status: 'offline', checked_at_unix_ms: 0, source: 'ssh_runtime_probe' }, probe,
    };
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const poller = new DesktopWelcomeRuntimePoller(options => store.refresh([target], { ...options, mode: 'auto' }), async () => undefined);
    const timer = setInterval(() => void poller.poll(), 5_000);
    await vi.advanceTimersByTimeAsync(35_000);
    clearInterval(timer);
    expect(probe).not.toHaveBeenCalled();
    await store.refresh([target], { force: true, mode: 'manual' });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('observes changed addresses on the next five-second tick while Cloud remains pending', async () => {
    vi.useFakeTimers();
    let address = 'http://192.168.100.118:23998/';
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    const probe = vi.fn(async () => ({ health: { status: 'online' as const, checked_at_unix_ms: Date.now(), source: 'local_runtime_probe' as const, local_ui_urls: [address] } }));
    const target: DesktopWelcomeRuntimeHealthTarget = { key: 'local', environment_id: 'local', slot: 'local_environment', auto_refresh_enabled: true, checking_health: { status: 'offline', checked_at_unix_ms: 0, source: 'local_runtime_probe' }, probe };
    let finishCloud!: () => void;
    const cloud = vi.fn(() => new Promise<void>(resolve => { finishCloud = resolve; }));
    const poller = new DesktopWelcomeRuntimePoller(options => store.refresh([target], options), cloud);
    await poller.poll();
    address = 'http://192.168.50.22:23998/';
    const timer = setInterval(() => void poller.poll(), 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(store.snapshot().localRuntimeHealth.local.local_ui_urls).toEqual([address]);
    expect(cloud).toHaveBeenCalledTimes(1);
    clearInterval(timer); finishCloud();
  });

  it('keeps a slow target deduplicated without blocking another target', async () => {
    const store = new DesktopWelcomeRuntimeHealthStore(() => undefined);
    let finish!: () => void;
    const slow = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }).then(() => ({})));
    const fast = vi.fn(async () => ({}));
    const targets: DesktopWelcomeRuntimeHealthTarget[] = [slow, fast].map((probe, index) => ({ key: String(index), environment_id: String(index), slot: 'runtime_target', auto_refresh_enabled: true, checking_health: { status: 'offline', checked_at_unix_ms: 0, source: 'ssh_runtime_probe' }, probe }));
    const poller = new DesktopWelcomeRuntimePoller(options => store.refresh(targets, options), async () => undefined);
    const first = poller.poll();
    await new Promise(resolve => setImmediate(resolve));
    const second = poller.poll();
    expect(slow).toHaveBeenCalledTimes(1); expect(fast).toHaveBeenCalledTimes(2);
    finish(); await Promise.all([first, second]);
  });
});
