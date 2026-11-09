// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopAuthorizationSettings } from './DesktopAuthorizationSettings';
import type { RemoteDesktopStatus } from '../../services/remoteDesktopApi';

const state = vi.hoisted(() => ({ save: vi.fn(), forget: vi.fn(), refresh: vi.fn(), access: () => ({ phase: 'ready', generation: 0 }) }));
vi.mock('../../services/remoteDesktopApi', () => ({ setRemoteDesktopUnattended: state.save, forgetRemoteDesktopAuthorization: state.forget }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => state.access() }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>,
  Switch: (props: any) => <label>{props.label}<input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.checked)} /></label>,
}));
const ready: RemoteDesktopStatus = { capabilities: { backend: 'wayland', state: 'ready', screen: true, input: true, audio: true, clipboard: true, unattended: true, authorization: 'saved', displays: [] }, unattended: true, control_in_use: false, last_display_id: '' };
let host: HTMLDivElement, dispose: (() => void) | undefined;
let setAccess!: (value: { phase: string; generation: number }) => void;
let setAllowed!: (value: boolean) => void;
let setStatus!: (value: RemoteDesktopStatus) => void;
const settle = async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.resetAllMocks(); state.save.mockResolvedValue({}); state.forget.mockResolvedValue({}); state.refresh.mockResolvedValue(undefined); host = document.createElement('div'); document.body.append(host); });
afterEach(() => { dispose?.(); host.remove(); });
async function mount(status = ready, allowed = true) {
  dispose = render(() => {
    const [access, updateAccess] = createSignal({ phase: 'ready', generation: 0 }); state.access = access; setAccess = updateAccess;
    const [permission, updateAllowed] = createSignal(allowed); setAllowed = updateAllowed;
    const [current, updateStatus] = createSignal(status); setStatus = updateStatus;
    return <DesktopAuthorizationSettings status={current()} allowed={permission()} refresh={state.refresh} />;
  }, host); await settle();
}
const button = (name: string) => [...host.querySelectorAll('button')].find(item => item.textContent === name)!;
const forget = 'remoteDesktop.approvalForget', confirm = 'remoteDesktop.approvalForgetConfirm';

it('does not change system consent on opening and waits for explicit unattended save before refresh', async () => {
  await mount(); expect(state.save).not.toHaveBeenCalled(); expect(state.forget).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
  const pending = deferred(); state.save.mockReturnValueOnce(pending.promise);
  host.querySelector<HTMLInputElement>('[role=switch]')!.click(); await settle();
  expect(state.save).toHaveBeenCalledExactlyOnceWith(false); expect(state.refresh).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('[role=switch]')!.disabled).toBe(true);
  pending.resolve(); await settle(); expect(state.refresh).toHaveBeenCalledOnce();
});

it('forgets only after confirmation, supports cancellation, and never changes unattended preference implicitly', async () => {
  await mount(); button(forget).click(); expect(state.forget).not.toHaveBeenCalled();
  button('common.actions.cancel').click(); expect(button(confirm)).toBeUndefined();
  button(forget).click(); button(confirm).click(); button(forget).click(); await settle();
  expect(state.forget).toHaveBeenCalledOnce(); expect(state.refresh).toHaveBeenCalledOnce(); expect(state.save).not.toHaveBeenCalled();
});

it.each(['reconnect', 'authorization', 'backend'] as const)('invalidates an open confirmation when %s changes', async change => {
  await mount(); button(forget).click(); const stale = button(confirm);
  if (change === 'reconnect') setAccess({ phase: 'ready', generation: 1 });
  else setStatus({ ...ready, capabilities: { ...ready.capabilities, ...(change === 'backend' ? { backend: 'macos' as const } : { authorization: 'needs_consent' as const }) } });
  await settle(); expect(button(confirm)).toBeUndefined(); stale.click();
  expect(state.forget).not.toHaveBeenCalled();
});

it('keeps read-only settings non-mutating and rejects stale clicks after permission revocation', async () => {
  await mount(ready, false); expect(button(forget).disabled).toBe(true); button(forget).click(); expect(button(confirm)).toBeUndefined();
  setAllowed(true); await settle(); button(forget).click(); const stale = button(confirm);
  setAllowed(false); await settle(); stale.click(); expect(state.forget).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});

it('does not refresh a different environment after a late mutation result', async () => {
  await mount(); const pending = deferred(); state.forget.mockReturnValueOnce(pending.promise);
  button(forget).click(); button(confirm).click(); setAccess({ phase: 'ready', generation: 1 }); await settle(); pending.resolve(); await settle();
  expect(state.refresh).not.toHaveBeenCalled();
});

it.each(['macos', 'x11'] as const)('does not offer Wayland persistent consent for %s', async backend => {
  await mount({ ...ready, capabilities: { ...ready.capabilities, backend } });
  expect(host.querySelector('[role=switch]')).toBeNull(); expect(button(forget)).toBeUndefined();
});

it('reports a failed mutation and leaves authorization to the canonical status', async () => {
  await mount(); state.forget.mockRejectedValueOnce(new Error('permission revoked'));
  button(forget).click(); button(confirm).click(); await settle();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('remoteDesktop.settingsFailed');
  expect(state.refresh).not.toHaveBeenCalled(); expect(button(forget)).toBeDefined();
});
