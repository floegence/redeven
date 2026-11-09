// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostApplicationOperationSession } from './hostApplicationOperationSession';
const api = vi.hoisted(() => ({ quit: vi.fn(), terminate: vi.fn(), running: vi.fn() }));
vi.mock('./hostApplicationsApi', () => ({ quitHostApplication: api.quit, terminateHostApplication: api.terminate, listRunningHostApplications: api.running }));
const cleanups: (() => void)[] = [];
function session() {
  const [environment, setEnvironment] = createSignal('one');
  const value = createRoot(dispose => { cleanups.push(dispose); return createHostApplicationOperationSession({env_id: environment}); });
  return {value, setEnvironment};
}
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
describe('background host application lifecycle', () => {
  it('keeps delayed admission and observation without any page and never escalates', async () => {
    vi.useFakeTimers(); const {value} = session(); let accept!: () => void;
    api.quit.mockReturnValue(new Promise<void>(resolve => {accept = resolve;}));
    api.running.mockResolvedValue([{application_id: 'app', instances: ['new-instance']}]);
    const pending = value.submit('app', ['original-instance'], false);
    expect(value.operations().app.state).toBe('submitting');
    await value.submit('app', ['original-instance'], false);
    accept(); await pending; expect(value.operations().app.state).toBe('accepted');
    await vi.advanceTimersByTimeAsync(2000);
    expect(value.operations()).toEqual({}); expect(api.quit).toHaveBeenCalledExactlyOnceWith('app', ['original-instance']);
    expect(api.terminate).not.toHaveBeenCalled();
  });
  it('retains pending state while any exact target instance remains', async () => {
    const {value} = session(); await value.submit('app', ['one', 'two'], true);
    value.reconcile([{application_id:'app', instances:['two']}] as Parameters<typeof value.reconcile>[0]);
    expect(value.operations().app.state).toBe('accepted');
    value.reconcile([]); expect(value.operations()).toEqual({});
    expect(api.terminate).toHaveBeenCalledExactlyOnceWith('app', ['one', 'two']); expect(api.quit).not.toHaveBeenCalled();
  });
  it('does not import a delayed receipt into another environment', async () => {
    const {value, setEnvironment} = session(); let accept!: () => void;
    api.quit.mockReturnValue(new Promise<void>(resolve => {accept = resolve;}));
    const pending = value.submit('app', ['one'], false); setEnvironment('two'); accept(); await pending;
    expect(value.operations()).toEqual({}); expect(api.running).not.toHaveBeenCalled();
  });
  it('keeps failed requests explicit without replay or escalation', async () => {
    const {value} = session(); api.quit.mockRejectedValue(new Error('rejected'));
    await expect(value.submit('app', ['one'], false)).rejects.toThrow('rejected');
    expect(value.operations().app.state).toBe('failed'); expect(api.quit).toHaveBeenCalledOnce(); expect(api.terminate).not.toHaveBeenCalled();
  });
});
