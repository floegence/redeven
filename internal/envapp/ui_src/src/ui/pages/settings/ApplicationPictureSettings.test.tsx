// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApplicationPictureSettings } from './ApplicationPictureSettings';

const state = vi.hoisted(() => ({ fetch: vi.fn(), access: () => ({ phase: 'ready', generation: 0 }) }));
vi.mock('../../services/localApi', () => ({ fetchLocalApiJSON: state.fetch }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => state.access() }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>,
  Select: (props: any) => <select aria-label={props.ariaLabel ?? props['aria-label']} value={props.value} onChange={event => props.onChange(event.currentTarget.value)}>{props.options.map((option: { value: string; label: string }) => <option value={option.value}>{option.label}</option>)}</select>,
}));
let host: HTMLDivElement, dispose: (() => void) | undefined;
let setAccess!: (value: { phase: string; generation: number }) => void;
let setAllowed!: (value: boolean) => void;
const initial = { mode: 'auto', max_dimension: 0, frame_rate: 0 };
const settle = async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.resetAllMocks(); state.fetch.mockResolvedValue(initial); host = document.createElement('div'); document.body.append(host); });
afterEach(() => { dispose?.(); host.remove(); });
async function mount(macOS = true, allowed = true) {
  dispose = render(() => {
    const [access, updateAccess] = createSignal({ phase: 'ready', generation: 0 }); state.access = access; setAccess = updateAccess;
    const [permission, updateAllowed] = createSignal(allowed); setAllowed = updateAllowed;
    return <ApplicationPictureSettings allowed={permission()} macOS={macOS} />;
  }, host); await settle();
}
const button = (name: string) => [...host.querySelectorAll('button')].find(item => item.textContent === name)!;
function change(index: number, value: string) { const select = host.querySelectorAll('select')[index]; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }

it('loads without mutation and saves the complete canonical preference only on explicit save', async () => {
  await mount(); expect(state.fetch).toHaveBeenCalledExactlyOnceWith('/_redeven_proxy/api/host-applications/picture', { method: 'GET' });
  expect(host.querySelectorAll('select')).toHaveLength(3);
  expect([...host.querySelectorAll('select')].map(select => select.getAttribute('aria-label'))).toEqual(['hostApplications.macPicture', 'hostApplications.macPictureResolution', 'hostApplications.macPictureFrameRate']); expect(button('common.actions.save').disabled).toBe(true);
  change(0, 'smooth'); change(1, '2560'); change(2, '60'); await settle();
  expect(state.fetch).toHaveBeenCalledOnce();
  state.fetch.mockResolvedValue({ mode: 'smooth', max_dimension: 2560, frame_rate: 60 }); button('common.actions.save').click(); await settle();
  expect(state.fetch).toHaveBeenLastCalledWith('/_redeven_proxy/api/host-applications/picture', { method: 'PUT', body: JSON.stringify({ mode: 'smooth', max_dimension: 2560, frame_rate: 60 }) });
  expect(button('common.actions.save').disabled).toBe(true);
});

it('keeps native-only limits in the same record while Linux changes only its supported mode', async () => {
  state.fetch.mockResolvedValue({ mode: 'clarity', max_dimension: 3840, frame_rate: 30 }); await mount(false);
  expect(host.querySelectorAll('select')).toHaveLength(1); change(0, 'data'); button('common.actions.save').click(); await settle();
  expect(JSON.parse(state.fetch.mock.lastCall![1].body)).toEqual({ mode: 'data', max_dimension: 3840, frame_rate: 30 });
});

it('preserves a draft on permission loss and rejects programmatic save while disconnected', async () => {
  await mount(); change(0, 'clarity'); setAllowed(false); await settle();
  expect(host.querySelector('fieldset')!.disabled).toBe(true); button('common.actions.save').click(); expect(state.fetch).toHaveBeenCalledOnce();
  setAllowed(true); setAccess({ phase: 'disconnected', generation: 1 }); await settle();
  button('common.actions.save').click(); expect(state.fetch).toHaveBeenCalledOnce();
  expect(host.querySelector('select')!.value).toBe('clarity');
});

it('recovers a failed GET through explicit refresh without submitting a default record', async () => {
  state.fetch.mockRejectedValueOnce(new Error('offline')); await mount();
  expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.querySelector('fieldset')!.disabled).toBe(true);
  state.fetch.mockResolvedValue({ mode: 'data', max_dimension: 0, frame_rate: 0 }); button('common.actions.refresh').click(); await settle();
  expect(host.querySelector('select')!.value).toBe('data'); expect(button('common.actions.save').disabled).toBe(true);
  expect(state.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
});

it('does not duplicate a pending save or replace edits when its old authority response arrives', async () => {
  await mount(); change(0, 'smooth'); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  button('common.actions.save').click(); button('common.actions.save').click(); expect(state.fetch).toHaveBeenCalledTimes(2);
  setAccess({ phase: 'ready', generation: 1 }); await settle(); pending.resolve({ ...initial, mode: 'data' }); await settle();
  expect(host.querySelector('select')!.value).toBe('smooth');
  expect(button('common.actions.save').disabled).toBe(false);
});

it('preserves failed save edits for explicit retry', async () => {
  await mount(); change(0, 'clarity'); state.fetch.mockRejectedValueOnce(new Error('network interrupted'));
  button('common.actions.save').click(); await settle();
  expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.querySelector('select')!.value).toBe('clarity');
  expect(state.fetch).toHaveBeenCalledTimes(2);
});

it('revalidates reads on authority generation changes and ignores a retired initial response', async () => {
  const retired = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(retired.promise); await mount();
  state.fetch.mockResolvedValueOnce({ mode: 'clarity', max_dimension: 1920, frame_rate: 30 });
  setAccess({ phase: 'ready', generation: 1 }); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector('select')!.value).toBe('clarity');
  retired.resolve({ mode: 'data', max_dimension: 1600, frame_rate: 15 }); await settle();
  expect(host.querySelector('select')!.value).toBe('clarity');
  expect(button('common.actions.save').disabled).toBe(true);
});
