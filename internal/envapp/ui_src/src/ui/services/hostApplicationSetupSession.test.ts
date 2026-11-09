// @vitest-environment jsdom
import { createRoot, createSignal, type Resource } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostApplicationSetupSession } from './hostApplicationSetupSession';
import type { EnvironmentDetail } from './controlplaneApi';
const api = vi.hoisted(() => ({ start: vi.fn(), upload: vi.fn(), cancel: vi.fn(), plan: vi.fn(), observe: vi.fn(), status: vi.fn(), components: vi.fn() }));
vi.mock('./hostApplicationsApi', async original => ({ ...await original<object>(), startHostApplicationSetup: api.start, uploadHostApplicationSetup: api.upload, cancelHostApplicationSetup: api.cancel, getHostApplicationTransferPlan: api.plan, observeHostApplicationSetup: api.observe, getHostApplicationSetup: api.status }));
const cleanups: (() => void)[] = [];
const plan = {package_digest: 'a'.repeat(64), missing_bytes: 100};
const available = {state: 'available', received_bytes: 0, expected_bytes: 100, can_cancel: false, package: {architecture: 'arm64', size_bytes: 100}};
const receiving = {...available, operation_id: 'upload', state: 'receiving', expected_bytes: 100, can_cancel: true};
const validating = {...receiving, state: 'validating', received_bytes: 100};
function session() {
  const [environment, setEnvironment] = createSignal('one');
  const result = createRoot(dispose => {
    cleanups.push(dispose);
    return createHostApplicationSetupSession({ env_id: environment, env: (() => ({permissions: {can_read: true, can_write: true, can_execute: true}})) as Resource<EnvironmentDetail | null> });
  });
  result.acceptSetup(available as Parameters<typeof result.acceptSetup>[0]);
  return {result, setEnvironment};
}
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.resetAllMocks(); delete window.redevenDesktopShell; });
describe('environment-owned application preparation', () => {
  it('finishes admitted upload after every foreground subscriber leaves', async () => {
    const {result} = session();
    let accept!: (value: unknown) => void;
    api.start.mockReturnValue(new Promise(resolve => {accept = resolve;}));
    api.upload.mockResolvedValue(validating); api.observe.mockReturnValue(new Promise(() => {}));
    const subscriber = vi.fn(); const unsubscribe = result.subscribe(subscriber);
    const pending = result.prepare(new File(['x'.repeat(100)], 'components.tar'));
    unsubscribe(); accept(receiving); await pending;
    expect(api.upload).toHaveBeenCalledExactlyOnceWith('upload', expect.any(File), expect.any(AbortSignal));
    expect(result.setup()?.state).toBe('validating');
    expect(subscriber).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('finishes Desktop acquisition and upload with no page present', async () => {
    const {result} = session();
    api.plan.mockResolvedValue(plan); api.start.mockResolvedValue(receiving); api.upload.mockResolvedValue(validating); api.observe.mockReturnValue(new Promise(() => {}));
    let accept!: (value: unknown) => void;
    api.components.mockImplementation((request: {action: string}) => request.action === 'acquire' ? new Promise(resolve => {accept = resolve;}) : Promise.resolve({ok: true, supports_transfer_plan: true, supports_cache_progress: true}));
    window.redevenDesktopShell = {applicationComponents: api.components} as unknown as typeof window.redevenDesktopShell;
    const pending = result.prepare(undefined, 'desktop');
    await vi.waitFor(() => expect(api.components).toHaveBeenCalledWith(expect.objectContaining({action: 'acquire'})));
    const unsubscribe = result.subscribe(vi.fn()); unsubscribe();
    accept({ok: true, size: 100}); await pending;
    expect(result.setup()?.state).toBe('validating'); expect(api.upload).toHaveBeenCalledTimes(1); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('does not cancel or import a late admission into a different environment', async () => {
    const {result, setEnvironment} = session();
    let accept!: (value: unknown) => void;
    api.start.mockReturnValue(new Promise(resolve => {accept = resolve;}));
    const pending = result.prepare(new File(['x'.repeat(100)], 'components.tar'));
    setEnvironment('two'); accept(receiving); await pending;
    expect(result.setup()).toBeNull(); expect(api.upload).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('keeps cancellation explicit while admission is pending', async () => {
    const {result} = session();
    let accept!: (value: unknown) => void;
    api.start.mockReturnValue(new Promise(resolve => {accept = resolve;}));
    api.cancel.mockResolvedValue({...receiving, state: 'cancelled'});
    const pending = result.prepare(new File(['x'.repeat(100)], 'components.tar'));
    await result.cancelPreparation();
    accept(receiving); await pending;
    expect(api.cancel).toHaveBeenCalledExactlyOnceWith('upload'); expect(api.upload).not.toHaveBeenCalled();
  });
});
