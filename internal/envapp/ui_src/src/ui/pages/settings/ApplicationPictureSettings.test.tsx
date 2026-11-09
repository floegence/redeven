// @vitest-environment jsdom
import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApplicationPictureSettings } from './ApplicationPictureSettings';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';

type ButtonProbe = { children: unknown; onClick: () => void; disabled?: boolean };
const state = vi.hoisted(() => ({ fetch: vi.fn(), access: () => ({ phase: 'ready', generation: 0 }), buttons: [] as ButtonProbe[] }));
vi.mock('../../services/localApi', () => ({ fetchLocalApiJSON: state.fetch }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => state.access() }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@floegence/floe-webapp-core/ui', async original => ({
  ...await original<object>(),
  Button: (props: any) => { state.buttons.push(props); return <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>; },
  FeedbackIndicator: (props: any) => <span data-feedback><For each={props.entries}>{(entry: any) => <><span role="alert">{entry.summary}</span>{entry.actions}</>}</For></span>,
  Select: (props: any) => <select disabled={props.disabled} aria-label={props.ariaLabel ?? props['aria-label']} value={props.value} onChange={event => props.onChange(event.currentTarget.value)}>{props.options.map((option: { value: string; label: string }) => <option value={option.value}>{option.label}</option>)}</select>,
}));
let host: HTMLDivElement, dispose: (() => void) | undefined;
let setAccess!: (value: { phase: string; generation: number }) => void;
let setAllowed!: (value: boolean) => void;
let setPresented!: (value: boolean) => void;
const initial = { mode: 'auto', max_dimension: 0, frame_rate: 0 };
const settle = async () => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.resetAllMocks(); state.buttons.length = 0; state.fetch.mockResolvedValue(initial); host = document.createElement('div'); document.body.append(host); });
afterEach(() => { dispose?.(); host.remove(); });
async function mount(macOS = true, allowed = true) {
  dispose = render(() => {
    const [access, updateAccess] = createSignal({ phase: 'ready', generation: 0 }); state.access = access; setAccess = updateAccess;
    const [permission, updateAllowed] = createSignal(allowed); setAllowed = updateAllowed;
    const [presented, updatePresented] = createSignal(true); setPresented = updatePresented;
    return <SettingsPanelContext.Provider value={{ present: presented, target: () => ({ section: 'applications' }), open: () => {}, close: () => updatePresented(false), register: () => () => {} }}><ApplicationPictureSettings allowed={permission()} macOS={macOS} /></SettingsPanelContext.Provider>;
  }, host); await settle();
}
const button = (name: string) => [...host.querySelectorAll('button')].find(item => item.textContent === name)!;
function change(index: number, value: string) { const select = host.querySelectorAll('select')[index]; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }

it('loads without mutation and immediately saves an explicit picture choice without a Save button', async () => {
  await mount(); expect(state.fetch).toHaveBeenCalledExactlyOnceWith('/_redeven_proxy/api/host-applications/picture', { method: 'GET' });
  expect(host.querySelectorAll('select')).toHaveLength(3);
  expect([...host.querySelectorAll('select')].map(select => select.getAttribute('aria-label'))).toEqual(['hostApplications.macPicture', 'hostApplications.macPictureResolution', 'hostApplications.macPictureFrameRate']);
  expect(button('common.actions.save')).toBeUndefined();
  state.fetch.mockResolvedValue({ ...initial, mode: 'smooth' }); change(0, 'smooth'); await settle();
  expect(state.fetch).toHaveBeenLastCalledWith('/_redeven_proxy/api/host-applications/picture', { method: 'PUT', body: JSON.stringify({ ...initial, mode: 'smooth' }) });
  change(0, 'smooth'); await settle(); expect(state.fetch).toHaveBeenCalledTimes(2);
});

it('keeps native-only limits in the same record while Linux changes only its supported mode', async () => {
  state.fetch.mockResolvedValue({ mode: 'clarity', max_dimension: 3840, frame_rate: 30 }); await mount(false);
  expect(host.querySelectorAll('select')).toHaveLength(1); change(0, 'data'); await settle();
  expect(JSON.parse(state.fetch.mock.lastCall![1].body)).toEqual({ mode: 'data', max_dimension: 3840, frame_rate: 30 });
});

it('rejects programmatic changes without current authority', async () => {
  await mount(); setAllowed(false); await settle();
  expect([...host.querySelectorAll('select')].every(select => select.disabled)).toBe(true); change(0, 'clarity'); expect(state.fetch).toHaveBeenCalledOnce();
  setAllowed(true); setAccess({ phase: 'disconnected', generation: 1 }); await settle();
  change(0, 'data'); expect(state.fetch).toHaveBeenCalledOnce();
});

it('recovers a failed GET through explicit refresh without submitting a default record', async () => {
  state.fetch.mockRejectedValueOnce(new Error('offline')); await mount();
  expect(host.querySelector('[role=alert]')).not.toBeNull(); expect([...host.querySelectorAll('select')].every(select => select.disabled)).toBe(true);
  state.fetch.mockResolvedValue({ mode: 'data', max_dimension: 0, frame_rate: 0 }); button('common.actions.refresh').click(); await settle();
  expect(host.querySelector('select')!.value).toBe('data');
  expect(state.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
});

it('serializes rapid choices and never overwrites the newer selection with an earlier acknowledgement', async () => {
  await mount(); const first = deferred<typeof initial>(); const second = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  change(0, 'smooth'); change(1, '2560'); change(2, '60'); expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector('fieldset')!.disabled).toBe(false);
  first.resolve({ ...initial, mode: 'smooth' }); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(state.fetch.mock.lastCall![1].body)).toEqual({ mode: 'smooth', max_dimension: 2560, frame_rate: 60 });
  expect([...host.querySelectorAll('select')].map(select => select.value)).toEqual(['smooth', '2560', '60']);
  second.resolve({ mode: 'smooth', max_dimension: 2560, frame_rate: 60 }); await settle();
  expect(button('common.actions.retry')).toBeUndefined();
});

it('stops after an uncertain failed write and preserves the newest choices for explicit retry', async () => {
  await mount(); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  change(0, 'clarity'); change(2, '60'); pending.reject(new Error('network interrupted')); await settle();
  expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.querySelector('select')!.value).toBe('clarity');
  expect(state.fetch).toHaveBeenCalledTimes(2);
  await settle(); expect(state.fetch).toHaveBeenCalledTimes(2);
  state.fetch.mockResolvedValue({ mode: 'clarity', max_dimension: 0, frame_rate: 60 }); button('common.actions.retry').click(); await settle();
  expect(JSON.parse(state.fetch.mock.lastCall![1].body)).toEqual({ mode: 'clarity', max_dimension: 0, frame_rate: 60 });
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it('clears a coalesced queue when the final choice matches the acknowledged write', async () => {
  await mount(); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  change(0, 'smooth'); change(0, 'clarity'); change(0, 'smooth');
  pending.resolve({ ...initial, mode: 'smooth' }); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(2);
  setPresented(false); await settle(); setPresented(true); await settle();
  expect(host.querySelector('[role=alert]')).toBeNull();
  change(2, '30'); await settle(); expect(state.fetch).toHaveBeenCalledTimes(3);
});

it('does not admit queued writes while hidden or replay them on reopening', async () => {
  await mount(); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  change(0, 'smooth'); change(2, '60'); setPresented(false); await settle();
  pending.resolve({ ...initial, mode: 'smooth' }); await settle();
  change(0, 'data'); expect(state.fetch).toHaveBeenCalledTimes(2);
  setPresented(true); await settle(); expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  button('common.actions.retry').click(); await settle();
  expect(JSON.parse(state.fetch.mock.lastCall![1].body)).toEqual({ mode: 'smooth', max_dimension: 0, frame_rate: 60 });
});

it('retires old authority responses and queues, then merges explicit retry with fresh untouched fields', async () => {
  await mount(); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  change(0, 'smooth'); change(2, '60');
  state.fetch.mockResolvedValueOnce({ mode: 'auto', max_dimension: 3840, frame_rate: 30 });
  setAccess({ phase: 'ready', generation: 1 }); await settle();
  pending.resolve({ mode: 'data', max_dimension: 1600, frame_rate: 15 }); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(3);
  expect([...host.querySelectorAll('select')].map(select => select.value)).toEqual(['smooth', '3840', '60']);
  state.fetch.mockResolvedValue({ mode: 'smooth', max_dimension: 3840, frame_rate: 60 });
  button('common.actions.retry').click(); await settle();
  expect(JSON.parse(state.fetch.mock.lastCall![1].body)).toEqual({ mode: 'smooth', max_dimension: 3840, frame_rate: 60 });
});

it('does not replay pending choices when permission returns', async () => {
  await mount(); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  change(0, 'smooth'); change(2, '60'); setAllowed(false); await settle();
  pending.reject(new Error('retired request')); await settle(); setAllowed(true); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector('select')!.value).toBe('smooth');
});

it('revalidates reads on authority generation changes and ignores a retired initial response', async () => {
  const retired = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(retired.promise); await mount();
  state.fetch.mockResolvedValueOnce({ mode: 'clarity', max_dimension: 1920, frame_rate: 30 });
  setAccess({ phase: 'ready', generation: 1 }); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector('select')!.value).toBe('clarity');
  retired.resolve({ mode: 'data', max_dimension: 1600, frame_rate: 15 }); await settle();
  expect(host.querySelector('select')!.value).toBe('clarity');
  expect(button('common.actions.retry')).toBeUndefined();
});

it('keeps saving and error feedback in the existing picture row without a status footer', async () => {
  await mount(); const pending = deferred<typeof initial>(); state.fetch.mockReturnValueOnce(pending.promise);
  change(0, 'smooth'); await settle();
  expect(host.querySelector('[role=status]')?.closest('.application-picture-row')).not.toBeNull();
  expect(host.querySelector('[data-testid=application-picture-settings]')!.children).toHaveLength(1);
  pending.reject(new Error('unknown outcome')); await settle();
  expect(host.querySelector('[role=alert]')?.closest('.application-picture-row')).not.toBeNull();
  expect(button('common.actions.retry')?.closest('.application-picture-row')).not.toBeNull();
  expect(button('common.actions.save')).toBeUndefined(); expect(state.fetch).toHaveBeenCalledTimes(2);
});

it.each(['retry', 'refresh'] as const)('rejects a captured %s feedback action while hidden and does not replay on reopen', async action => {
  if (action === 'refresh') state.fetch.mockRejectedValueOnce(new Error('failed read'));
  await mount();
  if (action === 'retry') { state.fetch.mockRejectedValueOnce(new Error('unknown outcome')); change(0, 'smooth'); await settle(); }
  const captured = state.buttons.find(props => props.children === `common.actions.${action}`)!;
  expect(captured).toBeDefined(); const requests = state.fetch.mock.calls.length;
  setPresented(false); await settle(); captured.onClick(); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(requests); expect(host.querySelector('[role=alert]')).toBeNull();
  setPresented(true); await settle(); expect(state.fetch).toHaveBeenCalledTimes(requests);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});
