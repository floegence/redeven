import { describe, expect, it, vi } from 'vitest';
import { BrowserInstallationController, type ComputerRequest } from '../host/browserInstallationController';
import type { BrowserPackageBridge } from '../../../desktop/src/shared/browserPackageIPC';
import type { FlowerBrowserInstallation, FlowerBrowserInstallRequest } from './contracts/flowerSurfaceContracts';
function fixture(acquire?: BrowserPackageBridge['request'], beforeResponse?: (input: FlowerBrowserInstallRequest) => Promise<void>) {
  const pkg = { id: 'chromium-linux-arm64', name: 'Chromium', version: '148', platform: 'linux', architecture: 'arm64', url: 'https://example.test/browser.zip', sha256: 'a'.repeat(64), size_bytes: 300000, installed_bytes: 600000 };
  let state: FlowerBrowserInstallation = { enabled: true, state: 'not_installed', package: pkg, directory: '/private/browser', received_bytes: 0 };
  const calls: FlowerBrowserInstallRequest[] = [];
  const request: ComputerRequest = async <T>(method: string, _path: string, body?: unknown) => {
    if (method === 'PUT') state = { ...state, enabled: (body as { enabled: boolean }).enabled };
    if (method === 'POST') {
      const input = body as FlowerBrowserInstallRequest; calls.push(input);
      if (input.action === 'start') state = { ...state, operation_id: 'runtime-1', state: input.source === 'upload' ? 'uploading' : 'downloading' };
      if (input.action === 'chunk') state = { ...state, received_bytes: input.offset! + atob(input.data!).length };
      if (input.action === 'complete') state = { ...state, state: 'installed' };
      if (input.action === 'cancel') state = { ...state, state: 'cancelled' };
      await beforeResponse?.(input);
    }
    return { ...state } as T;
  };
  const desktop: BrowserPackageBridge = {
    request: vi.fn(acquire ?? (async input => input.action === 'acquire' ? { ok: true, package: pkg, from_cache: true }
      : input.action === 'read' ? { ok: true, data: new Uint8Array(Math.min(262144, pkg.size_bytes - input.offset)) } : { ok: true })),
    subscribe: () => () => undefined,
  };
  const controller = new BrowserInstallationController(request, desktop);
  return { controller, calls, desktop, pkg, start: () => controller.install({ action: 'start', source: 'upload', package_id: pkg.id }) };
}
describe('environment browser installation', () => {
  it('reads without acquisition and uploads exact target bytes only after confirmation', async () => {
    const f = fixture(); await f.controller.load(); expect(f.desktop.request).not.toHaveBeenCalled();
    await f.start(); await vi.waitFor(() => expect(f.controller.snapshot()?.transfer_active).toBe(false));
    expect(f.controller.snapshot()?.state).toBe('installed');
    expect(vi.mocked(f.desktop.request).mock.calls[0][0]).toMatchObject({ action: 'acquire', package: { id: f.pkg.id, sha256: f.pkg.sha256, size_bytes: 300000 } });
    expect(f.calls.map(call => call.action)).toEqual(['start', 'chunk', 'chunk', 'complete']);
    expect(f.calls.filter(call => call.action === 'chunk').map(call => call.offset)).toEqual([0, 262144]); f.controller.dispose();
  });
  it('keeps one operation after observers leave and exposes it to a new panel', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); const f = fixture();
    vi.mocked(f.desktop.request).mockImplementationOnce(async () => { await wait; return { ok: true, package: f.pkg }; });
    const unsubscribe = f.controller.subscribe(vi.fn()); await f.start(); await f.start(); unsubscribe();
    const next = vi.fn(); f.controller.subscribe(next); expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ transfer_active: true }));
    release(); await vi.waitFor(() => expect(f.controller.snapshot()?.state).toBe('installed'));
    expect(vi.mocked(f.desktop.request).mock.calls.filter(([r]) => r.action === 'acquire')).toHaveLength(1);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ transfer_active: false, state: 'installed' })); f.controller.dispose();
  });
  it('cancels acquisition before it can create a Runtime upload', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(async input => { if (input.action === 'acquire') { await wait; return { ok: false }; } if (input.action === 'cancel') release(); return { ok: true }; });
    await f.start(); await vi.waitFor(() => expect(f.desktop.request).toHaveBeenCalled()); await f.controller.cancel();
    expect(f.calls).toEqual([]); expect(f.controller.snapshot()?.transfer_active).toBe(false); expect(f.controller.snapshot()?.desktop_error).toBeUndefined(); f.controller.dispose();
  });
  it('rejects a different package and permits an explicit retry', async () => {
    const f = fixture(); vi.mocked(f.desktop.request).mockResolvedValueOnce({ ok: false, error: 'package_mismatch' });
    await f.start(); await vi.waitFor(() => expect(f.controller.snapshot()?.desktop_error).toBe('package_mismatch')); expect(f.calls).toEqual([]);
    await f.start(); await vi.waitFor(() => expect(f.controller.snapshot()?.state).toBe('installed')); f.controller.dispose();
  });
  it('requires an enabled browser and explicit consent after re-enabling', async () => {
    const f = fixture(); await f.controller.setEnabled(false); await expect(f.start()).rejects.toThrow('unavailable');
    await f.controller.setEnabled(true); expect(f.desktop.request).not.toHaveBeenCalled(); f.controller.dispose();
  });
});

describe('installation cancellation boundaries', () => {
  it('serializes simultaneous starts before the first status load', async () => {
    const f = fixture(); await Promise.all([f.start(), f.start()]);
    await vi.waitFor(() => expect(f.controller.snapshot()?.transfer_active).toBe(false));
    expect(f.calls.filter(call => call.action === 'start')).toHaveLength(1); f.controller.dispose();
  });
  it('cancels an upload whose start response arrives after cancellation', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(undefined, async input => { if (input.action === 'start') await wait; });
    await f.start(); await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    const cancelled = f.controller.cancel(); release(); await cancelled;
    expect(f.calls.map(call => call.action)).toEqual(['start', 'cancel']);
    expect(f.controller.snapshot()).toMatchObject({ state: 'cancelled', transfer_active: false }); f.controller.dispose();
  });
  it('cancels an in-flight chunk without completing the archive', async () => {
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(undefined, async input => { if (input.action === 'chunk') await wait; });
    await f.start(); await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    const cancelled = f.controller.cancel(); release(); await cancelled;
    expect(f.calls.map(call => call.action)).toEqual(['start', 'chunk', 'cancel']); f.controller.dispose();
  });
  for (const action of ['disable', 'dispose'] as const) {
    it(`stops acquisition on ${action} and never starts an upload`, async () => {
      let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
      const f = fixture(async input => {
        if (input.action === 'acquire') { await wait; return { ok: false }; }
        if (input.action === 'cancel') release(); return { ok: true };
      });
      await f.start(); await vi.waitFor(() => expect(f.desktop.request).toHaveBeenCalled());
      if (action === 'disable') await f.controller.setEnabled(false); else f.controller.dispose();
      await vi.waitFor(() => expect(f.controller.snapshot()?.transfer_active).toBe(false));
      expect(f.calls).toEqual([]); f.controller.dispose();
    });
  }
  it('rejects mismatched successful acquisition before uploading', async () => {
    const f = fixture(); vi.mocked(f.desktop.request).mockResolvedValueOnce({ ok: true, package: { ...f.pkg, sha256: 'b'.repeat(64) } });
    await f.start(); await vi.waitFor(() => expect(f.controller.snapshot()?.desktop_error).toBe('package_mismatch'));
    expect(f.calls).toEqual([]); f.controller.dispose();
  });
  it('cancels a short archive without submitting completion', async () => {
    const f = fixture(); const original = f.desktop.request;
    vi.mocked(original).mockResolvedValueOnce({ ok: true, package: f.pkg }).mockResolvedValueOnce({ ok: true, data: new Uint8Array(1) });
    await f.start(); await vi.waitFor(() => expect(f.controller.snapshot()?.desktop_error).toBe('desktop_upload_failed'));
    expect(f.calls.map(call => call.action)).toEqual(['start', 'cancel']); f.controller.dispose();
  });
});

it('dispatches host cancellation immediately when a document closes during a chunk', async () => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(undefined, async input => { if (input.action === 'chunk') await wait; });
  await f.start(); await vi.waitFor(() => expect(f.calls).toHaveLength(2));
  f.controller.dispose();
  expect(f.calls.map(call => call.action)).toEqual(['start', 'chunk', 'cancel']);
  release(); await vi.waitFor(() => expect(f.controller.snapshot()?.transfer_active).toBe(false));
  expect(f.calls.some(call => call.action === 'complete')).toBe(false);
});
