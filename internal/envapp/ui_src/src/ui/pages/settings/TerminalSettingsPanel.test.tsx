// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TerminalSettingsPanel } from './TerminalSettingsPanel';
import { TerminalSettingsAttachmentsProvider, terminalSettingsResource, useTerminalSettingsAttachments, type TerminalSettingsAttachment, type TerminalSettingsTarget } from '../../services/terminalSettingsTargets';
import type { RuntimeWorkbenchLayoutSnapshot, RuntimeWorkbenchWidgetState, RuntimeWorkbenchLayoutEvent } from '../../workbench/runtimeWorkbenchLayout';
import type { TerminalSettingsDialog } from '../../widgets/TerminalSettingsDialog';
import type { EnvResourceCacheAccess } from '../../services/envResourceCache';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import type { SettingsTarget } from '../../../../../../settings_ui/src/settingsSession';

type EditorProps = Parameters<typeof TerminalSettingsDialog>[0];
const state = vi.hoisted(() => ({
  snapshot: vi.fn(), put: vi.fn(), stream: vi.fn(), open: vi.fn(), refresh: vi.fn(),
  access: () => ({ phase: 'ready', generation: 0 }), permission: () => true,
  sessions: () => [{ id: 'session-a', name: 'Session A' }, { id: 'session-b', name: 'Session B' }],
  editors: [] as EditorProps[],
  preferences: { userTheme: () => 'system', fontSize: () => 12, fontFamilyId: () => 'jetbrains', mobileInputMode: () => 'floe', followInput: () => true, workIndicatorEnabled: () => true,
    setUserTheme: vi.fn(), setFontSize: vi.fn(), setFontFamily: vi.fn(), setMobileInputMode: vi.fn(), setFollowInput: vi.fn(), setWorkIndicatorEnabled: vi.fn() },
}));
vi.mock('@floegence/floe-webapp-core', () => ({ useResolvedFloeConfig: () => ({ persist: {} }), useTheme: () => ({ resolvedTheme: () => 'light' }) }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>,
  Select: (props: any) => <select aria-label={props.ariaLabel ?? props['aria-label']} value={props.value} onChange={event => props.onChange(event.currentTarget.value)}>{props.options.map((option: any) => <option value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { number: number }) => values ? `${key} ${values.number}` : key }) }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => state.access(), env: () => ({ permissions: { can_read: true, can_write: state.permission(), can_execute: true } }), openSettings: state.open }) }));
vi.mock('./EnvSettingsPageContext', () => ({ useEnvSettingsPage: () => ({ canInteract: () => state.access().phase === 'ready', canAdmin: () => state.permission() }) }));
vi.mock('./SettingsPrimitives', () => ({ SettingsResourceToolbar: (props: { label: string; children: import('solid-js').JSX.Element; actions?: import('solid-js').JSX.Element }) => <div aria-label={props.label}>{props.children}{props.actions}</div> }));
vi.mock('../../services/terminalSessionCatalog', () => ({ useTerminalSessionCatalog: () => ({ sessions: () => state.sessions(), refresh: state.refresh }) }));
vi.mock('../../services/terminalPreferences', () => ({ ensureTerminalPreferencesInitialized: () => {}, useTerminalPreferences: () => state.preferences, TERMINAL_MIN_FONT_SIZE: 10, TERMINAL_MAX_FONT_SIZE: 20 }));
vi.mock('../../services/workbenchLayoutApi', () => ({ getWorkbenchLayoutSnapshot: state.snapshot, putWorkbenchWidgetState: state.put, connectWorkbenchLayoutEventStream: state.stream }));
vi.mock('../../widgets/TerminalSettingsDialog', () => ({ TerminalSettingsDialog: (props: EditorProps) => {
  const index = state.editors.push(props) - 1;
  return <div data-editor={index}><input aria-label="retained draft" /><output data-font-size>{props.fontSize}</output><output data-session>{props.retentionSessionId}</output></div>;
} }));

const widget = (id = 'widget-a') => ({ widget_id: id, widget_type: 'redeven.terminal', x: 0, y: 0, width: 10, height: 10, z_index: 1, created_at_unix_ms: 1 });
const widgetState = (revision = 1, sessions = ['session-a'], fontSize = 12): RuntimeWorkbenchWidgetState => ({ widget_id: 'widget-a', widget_type: 'redeven.terminal', revision, updated_at_unix_ms: revision, state: { kind: 'terminal', session_ids: sessions, font_size: fontSize, font_family_id: 'jetbrains' } });
const snapshot = (seq = 1): RuntimeWorkbenchLayoutSnapshot => ({ seq, revision: seq, updated_at_unix_ms: seq, widgets: [widget()], widget_states: [widgetState()], sticky_notes: [], annotations: [], background_layers: [] });
let host: HTMLDivElement, dispose: (() => void) | undefined, registry: NonNullable<ReturnType<typeof useTerminalSettingsAttachments>>;
let setTarget!: (target: string | undefined) => void, setAccess!: (access: EnvResourceCacheAccess) => void;
let setPresented!: (present: boolean) => void, setHostTarget!: (target: SettingsTarget | null) => void;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); state.editors.length = 0; state.permission = () => true;
  state.sessions = () => [{ id: 'session-a', name: 'Session A' }, { id: 'session-b', name: 'Session B' }];
  state.snapshot.mockResolvedValue(snapshot()); state.put.mockResolvedValue(widgetState(2, ['session-a'], 16));
  state.stream.mockImplementation(() => new Promise<void>(() => {}));
  host = document.createElement('div'); document.body.append(host);
});
afterEach(() => { dispose?.(); host.remove(); });
async function mount(target?: TerminalSettingsTarget | string) {
  const Harness = () => {
    const [access, updateAccess] = createSignal<EnvResourceCacheAccess>({ phase: 'ready', generation: 0 }); state.access = access; setAccess = updateAccess;
    const initial = typeof target === 'string' ? target : target ? terminalSettingsResource(target) : undefined;
    const [resource, updateTarget] = createSignal(initial);
    const [present, updatePresent] = createSignal(true); setPresented = updatePresent;
    const [presentedTarget, updateHostTarget] = createSignal<SettingsTarget | null>({ section: 'terminal', resource: initial }); setHostTarget = updateHostTarget;
    setTarget = next => { updateTarget(next); updateHostTarget({ section: 'terminal', resource: next }); };
    registry = useTerminalSettingsAttachments()!;
    return <SettingsPanelContext.Provider value={{ present, target: presentedTarget, open: updateHostTarget, close: () => updateHostTarget(null), register: () => () => {} }}><TerminalSettingsPanel resource={resource()} /></SettingsPanelContext.Provider>;
  };
  dispose = render(() => <TerminalSettingsAttachmentsProvider><Harness /></TerminalSettingsAttachmentsProvider>, host); await settle();
}
const editorElement = () => [...host.querySelectorAll<HTMLElement>('[data-editor]')].find(element => !element.closest('[hidden]'))!;
const editor = () => state.editors[Number(editorElement().dataset.editor)];
const targetSelect = () => host.querySelector<HTMLSelectElement>('select[aria-label="terminal.settings.target"]')!;
function emit(seq: number, payload: RuntimeWorkbenchLayoutEvent['payload']) { state.stream.mock.lastCall![0].onEvent({ seq, type: 'fixture', created_at_unix_ms: seq, payload }); }
function owner(widgetID: string | null = null, session = 'session-a') {
  const [controllers, setControllers] = createSignal<ReadonlyMap<string, string>>(new Map([[session, 'authority-a']]));
  const [ready, setReady] = createSignal(true);
  const configure = vi.fn().mockResolvedValue({}), attach = vi.fn(), takeover = vi.fn();
  const entry = { widgetID, controllers, ready, sessions: () => [{ id: session, name: session === 'exec-a' ? 'Container Exec' : 'Attached terminal' }],
    transport: { historyRetention: vi.fn(), configureHistoryRetention: configure, attach, attachWithPresentation: attach, takeover } } as unknown as TerminalSettingsAttachment;
  const unregister = registry.register(entry); return { entry, configure, attach, takeover, setControllers, setReady, unregister };
}
const limits = { max_lines: 5000, max_bytes: 1024 * 1024 };

it('discovers catalog sessions, Workbench widgets and controlled container exec without attaching', async () => {
  await mount(); const exec = owner(null, 'exec-a'); await settle();
  const values = [...targetSelect().options].map(option => option.value);
  expect(values).toEqual(['', terminalSettingsResource({ kind: 'session', id: 'session-a' }), terminalSettingsResource({ kind: 'session', id: 'session-b' }), terminalSettingsResource({ kind: 'session', id: 'exec-a' }), terminalSettingsResource({ kind: 'widget', id: 'widget-a' })]);
  setTarget(terminalSettingsResource({ kind: 'session', id: 'exec-a' })); await settle();
  expect(editor().retentionSessionId).toBe('exec-a'); expect(editor().retentionTransport).toBeDefined();
  expect(exec.attach).not.toHaveBeenCalled(); expect(exec.takeover).not.toHaveBeenCalled(); expect(state.put).not.toHaveBeenCalled();
  await editor().retentionTransport!.configureHistoryRetention!('exec-a', limits); expect(exec.configure).toHaveBeenCalledExactlyOnceWith('exec-a', limits);
});

it('does not manufacture current-session authority for unattached or ambiguous sessions', async () => {
  await mount({ kind: 'session', id: 'session-a' }); expect(editor().retentionTransport).toBeUndefined();
  const first = owner(); await settle(); expect(editor().retentionTransport).toBeDefined();
  const second = owner(); await settle(); expect(editor().retentionTransport).toBeUndefined();
  second.unregister(); await settle(); expect(editor().retentionTransport).toBeDefined();
  expect(first.attach).not.toHaveBeenCalled(); expect(second.attach).not.toHaveBeenCalled();
});

it('keeps stale resource targets unavailable without changing the requested target', async () => {
  await mount('{"kind":"widget","id":"deleted"}'); expect(editorElement()).toBeUndefined(); expect(host.textContent).toContain('settings.targetUnavailable');
  expect(state.open).not.toHaveBeenCalled(); expect(state.put).not.toHaveBeenCalled();
});

it('updates font for an existing empty widget with CAS zero and no session creation', async () => {
  state.snapshot.mockResolvedValue({ ...snapshot(), widget_states: [] }); state.put.mockResolvedValue(widgetState(1, [], 16));
  await mount({ kind: 'widget', id: 'widget-a' }); editor().onFontSizeChange(16); await settle();
  expect(state.put).toHaveBeenCalledExactlyOnceWith('widget-a', { base_revision: 0, widget_type: 'redeven.terminal', state: { kind: 'terminal', session_ids: [], font_size: 16 } });
  expect(editor().fontSize).toBe(16);
});

it('rejects a widget deleted before font persistence instead of recreating it', async () => {
  await mount({ kind: 'widget', id: 'widget-a' }); const captured = editor(); state.snapshot.mockResolvedValue({ ...snapshot(2), widgets: [], widget_states: [] });
  captured.onFontSizeChange(16); await settle(); expect(state.put).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toContain('settings.targetUnavailable');
});

it('checks exact widget membership immediately before retention mutation', async () => {
  await mount({ kind: 'widget', id: 'widget-a', sessionId: 'session-a' }); const live = owner('widget-a'); await settle();
  const transport = editor().retentionTransport!; expect(transport).toBeDefined();
  state.snapshot.mockResolvedValue({ ...snapshot(2), widget_states: [widgetState(2, ['session-b'])] });
  await expect(transport.configureHistoryRetention!('session-a', limits)).rejects.toThrow('settings.targetUnavailable');
  expect(live.configure).not.toHaveBeenCalled(); expect(live.attach).not.toHaveBeenCalled();
});

it('fences a captured retention action after ownership, connection, or session identity changes', async () => {
  await mount({ kind: 'session', id: 'session-a' }); const live = owner(); await settle();
  const first = editor().retentionTransport!, authority = editor().retentionAuthority;
  live.setControllers(new Map([['session-a', 'authority-b']])); await settle(); expect(editor().retentionAuthority).not.toBe(authority);
  await expect(first.configureHistoryRetention!('session-a', limits)).rejects.toThrow('settings.targetUnavailable');
  const second = editor().retentionTransport!;
  await expect(second.configureHistoryRetention!('session-b', limits)).rejects.toThrow('settings.targetUnavailable');
  setAccess({ phase: 'ready', generation: 1 }); await settle();
  await expect(second.configureHistoryRetention!('session-a', limits)).rejects.toThrow('settings.targetUnavailable');
  expect(live.configure).not.toHaveBeenCalled(); expect(live.takeover).not.toHaveBeenCalled();
});

it('retains a single event stream across updates and ignores older event sequences', async () => {
  await mount({ kind: 'widget', id: 'widget-a' }); expect(state.stream).toHaveBeenCalledOnce(); const signal = state.stream.mock.calls[0][0].signal;
  emit(2, widgetState(2, ['session-a'], 14)); await settle(); emit(3, widgetState(3, ['session-a'], 18)); await settle();
  expect(state.stream).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false); expect(editor().fontSize).toBe(18);
  emit(2, widgetState(2, ['session-a'], 14)); await settle(); expect(editor().fontSize).toBe(18);
  dispose?.(); dispose = undefined; expect(signal.aborted).toBe(true);
});

it('does not roll back newer stream state when an older font response arrives', async () => {
  await mount({ kind: 'widget', id: 'widget-a' }); const pending = deferred<RuntimeWorkbenchWidgetState>(); state.put.mockReturnValueOnce(pending.promise);
  editor().onFontSizeChange(16); await settle(); expect(state.put).toHaveBeenCalledOnce();
  emit(5, widgetState(5, ['session-a', 'session-b'], 19)); await settle(); expect(editor().fontSize).toBe(19);
  pending.resolve(widgetState(2, ['session-a'], 16)); await settle(); expect(editor().fontSize).toBe(19); expect(state.stream).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="terminal.settings.sessionTarget"]')!.options.length).toBe(3);
});

it.each([false, true])('keeps a saved font when a delayed full layout snapshot has older widget state (missing=%s)', async missing => {
  await mount({ kind: 'widget', id: 'widget-a' });
  editor().onFontSizeChange(16); await settle(); expect(editor().fontSize).toBe(16);
  const second = { ...widgetState(1, ['session-b'], 18), widget_id: 'widget-b' };
  emit(2, { ...snapshot(2), widgets: [widget(), widget('widget-b')], widget_states: [...(missing ? [] : [widgetState()]), second] });
  await settle();
  expect(editor().fontSize).toBe(16);
  expect([...targetSelect().options].some(option => option.value.includes('widget-b'))).toBe(true);
  // The replacement layout and its sequence still advance, even though one
  // independently revisioned widget state came from the earlier save response.
  emit(2, widgetState(99, ['session-a'], 20)); await settle(); expect(editor().fontSize).toBe(16);
  setTarget(terminalSettingsResource({ kind: 'widget', id: 'widget-b' })); await settle(); expect(editor().fontSize).toBe(18);
  expect(state.put).toHaveBeenCalledOnce(); expect(state.stream).toHaveBeenCalledOnce();
});

it('preserves a just-saved revision across an equal-sequence explicit refresh', async () => {
  await mount({ kind: 'widget', id: 'widget-a' });
  editor().onFontSizeChange(16); await settle(); expect(editor().fontSize).toBe(16);
  host.querySelector<HTMLButtonElement>('button')!.click(); await settle();
  expect(editor().fontSize).toBe(16); expect(state.put).toHaveBeenCalledOnce();
});

it('keeps a confirmed PUT when an already-running refresh completes at the same event sequence', async () => {
  await mount({ kind: 'widget', id: 'widget-a' });
  const refreshing = deferred<RuntimeWorkbenchLayoutSnapshot>(); state.snapshot.mockReturnValueOnce(refreshing.promise);
  host.querySelector<HTMLButtonElement>('button')!.click(); await settle();
  editor().onFontSizeChange(16); await settle(); expect(editor().fontSize).toBe(16);
  refreshing.resolve(snapshot()); await settle();
  expect(editor().fontSize).toBe(16); expect(state.put).toHaveBeenCalledOnce();
});

it('drops saved state for widgets removed by a full layout and never reuses it for a new widget', async () => {
  await mount({ kind: 'widget', id: 'widget-a' });
  editor().onFontSizeChange(16); await settle(); expect(editor().fontSize).toBe(16);
  emit(2, { ...snapshot(2), widgets: [widget('widget-b')], widget_states: [] }); await settle();
  expect(editorElement()).toBeUndefined(); expect(host.textContent).toContain('settings.targetUnavailable');
  expect([...targetSelect().options].some(option => option.value.includes('widget-a'))).toBe(false);
  emit(3, { ...snapshot(3), widgets: [widget(), widget('widget-b')], widget_states: [] }); await settle();
  expect(editor().fontSize).toBe(12);
  emit(4, { ...snapshot(4), widget_states: [widgetState(3, ['session-a'], 19)] }); await settle();
  expect(editor().fontSize).toBe(19);
});

it('does not resurrect a removed widget from a late successful font response', async () => {
  await mount({ kind: 'widget', id: 'widget-a' }); const pending = deferred<RuntimeWorkbenchWidgetState>(); state.put.mockReturnValueOnce(pending.promise);
  editor().onFontSizeChange(16); await settle(); emit(3, { ...snapshot(3), widgets: [], widget_states: [] }); await settle();
  pending.resolve(widgetState(2, ['session-a'], 16)); await settle(); expect(editorElement()).toBeUndefined(); expect(host.textContent).toContain('settings.targetUnavailable');
  expect([...targetSelect().options].some(option => option.value.includes('widget-a'))).toBe(false);
});

it('retains the same editor and input drafts while switching stable settings targets', async () => {
  await mount({ kind: 'session', id: 'session-a' }); const first = editorElement(), draft = first.querySelector<HTMLInputElement>('input')!; draft.value = 'unfinished retention draft';
  setTarget(terminalSettingsResource({ kind: 'session', id: 'session-b' })); await settle(); const second = editorElement(); expect(second).not.toBe(first);
  second.querySelector<HTMLInputElement>('input')!.value = 'second draft'; setTarget(terminalSettingsResource({ kind: 'session', id: 'session-a' })); await settle();
  expect(editorElement()).toBe(first); expect(draft.value).toBe('unfinished retention draft');
  expect(state.put).not.toHaveBeenCalled();
});

it('keeps the retention transport stable while unrelated Workbench events arrive', async () => {
  await mount({ kind: 'widget', id: 'widget-a', sessionId: 'session-a' }); owner('widget-a'); await settle();
  const transport = editor().retentionTransport, authority = editor().retentionAuthority;
  emit(2, widgetState(2, ['session-a'], 16)); await settle(); emit(3, widgetState(3, ['session-a', 'session-b'], 18)); await settle();
  expect(editor().retentionTransport).toBe(transport); expect(editor().retentionAuthority).toBe(authority); expect(state.stream).toHaveBeenCalledOnce();
});

it('renders stream loss and restores exactly one subscription through explicit refresh', async () => {
  const stream = deferred<void>(); state.stream.mockReturnValueOnce(stream.promise); await mount({ kind: 'widget', id: 'widget-a' });
  const original = state.stream.mock.calls[0][0].signal; stream.reject(new Error('connection lost')); await settle();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('settings.targetUnavailable');
  host.querySelector<HTMLButtonElement>('button')!.click(); await settle();
  expect(state.stream).toHaveBeenCalledTimes(2); expect(original.aborted).toBe(true); expect(state.stream.mock.lastCall![0].signal.aborted).toBe(false);
  expect(state.refresh).toHaveBeenCalledOnce();
});

it('uses the latest widget revision while preserving its existing session placement', async () => {
  await mount({ kind: 'widget', id: 'widget-a' }); state.snapshot.mockResolvedValue({ ...snapshot(4), widget_states: [widgetState(4, ['session-a', 'session-b'], 14)] });
  editor().onFontFamilyChange('iosevka'); await settle();
  expect(state.put).toHaveBeenCalledExactlyOnceWith('widget-a', { base_revision: 4, widget_type: 'redeven.terminal', state: { kind: 'terminal', session_ids: ['session-a', 'session-b'], font_size: 14, font_family_id: 'iosevka' } });
});

it.each(['resource', 'category', 'closed'] as const)('rejects retained widget callbacks after %s presentation changes', async change => {
  await mount({ kind: 'widget', id: 'widget-a' }); const stale = editor();
  if (change === 'resource') setTarget(undefined);
  else if (change === 'category') setHostTarget({ section: 'logging' });
  else setPresented(false);
  await settle(); const reads = state.snapshot.mock.calls.length;
  stale.onFontSizeChange(16); stale.onFontFamilyChange('iosevka'); await settle();
  expect(state.snapshot).toHaveBeenCalledTimes(reads); expect(state.put).not.toHaveBeenCalled();
});

it.each([false, true])('cancels an unsubmitted font preflight after navigation (return=%s)', async returnToTarget => {
  const target = { kind: 'widget', id: 'widget-a' } as const;
  await mount(target); const pending = deferred<RuntimeWorkbenchLayoutSnapshot>(); state.snapshot.mockReturnValueOnce(pending.promise);
  editor().onFontSizeChange(16); setTarget(undefined); await settle();
  if (returnToTarget) { setTarget(terminalSettingsResource(target)); await settle(); }
  pending.resolve(snapshot()); await settle(); expect(state.put).not.toHaveBeenCalled();
});

it.each(['resource', 'category', 'closed'] as const)('rejects a retained history transport after %s presentation changes', async change => {
  await mount({ kind: 'session', id: 'session-a' }); const live = owner(); await settle();
  const stale = editor().retentionTransport!;
  if (change === 'resource') setTarget(undefined);
  else if (change === 'category') setHostTarget({ section: 'logging' });
  else setPresented(false);
  await settle();
  await expect(stale.configureHistoryRetention!('session-a', limits)).rejects.toThrow('settings.targetUnavailable');
  expect(live.configure).not.toHaveBeenCalled(); expect(live.attach).not.toHaveBeenCalled();
});

it.each([false, true])('cancels an unsubmitted retention preflight after navigation (return=%s)', async returnToTarget => {
  const target = { kind: 'widget', id: 'widget-a', sessionId: 'session-a' } as const;
  await mount(target); const live = owner('widget-a'); await settle();
  const transport = editor().retentionTransport!; const pending = deferred<RuntimeWorkbenchLayoutSnapshot>(); state.snapshot.mockReturnValueOnce(pending.promise);
  const result = transport.configureHistoryRetention!('session-a', limits);
  const rejected = expect(result).rejects.toThrow('settings.targetUnavailable');
  setTarget(undefined); await settle();
  if (returnToTarget) { setTarget(terminalSettingsResource(target)); await settle(); }
  pending.resolve(snapshot()); await rejected;
  expect(live.configure).not.toHaveBeenCalled(); expect(live.takeover).not.toHaveBeenCalled();
});

it.each(['resource', 'category', 'closed'] as const)('rejects retained local preferences and default retention after %s presentation changes', async change => {
  await mount(); const stale = editor();
  if (change === 'resource') setTarget(terminalSettingsResource({ kind: 'session', id: 'session-a' }));
  else if (change === 'category') setHostTarget({ section: 'logging' });
  else setPresented(false);
  await settle();
  expect(stale.onThemeChange('light')).toBe(false); stale.onFontSizeChange(18); stale.onFontFamilyChange('iosevka');
  stale.onFollowInputChange?.(false); stale.onMobileInputModeChange('system'); stale.onWorkIndicatorEnabledChange(false);
  expect(stale.retentionCanManage).toBe(false);
  for (const value of Object.values(state.preferences)) if (vi.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
});

it('settles an accepted widget PUT after navigation without replaying it', async () => {
  const target = { kind: 'widget', id: 'widget-a' } as const; await mount(target); const first = editorElement();
  const pending = deferred<RuntimeWorkbenchWidgetState>(); state.put.mockReturnValueOnce(pending.promise);
  editor().onFontSizeChange(16); await settle(); expect(state.put).toHaveBeenCalledOnce();
  setTarget(undefined); await settle(); pending.resolve(widgetState(2, ['session-a'], 16)); await settle();
  setTarget(terminalSettingsResource(target)); await settle();
  expect(editorElement()).toBe(first); expect(editor().fontSize).toBe(16); expect(state.put).toHaveBeenCalledOnce();
});

it('keeps active local preference actions available and retires them on disposal', async () => {
  await mount(); const current = editor(); expect(current.retentionCanManage).toBe(true);
  expect(current.onThemeChange('light')).toBe(true); current.onFontSizeChange(18); current.onFontFamilyChange('iosevka');
  current.onFollowInputChange?.(false); current.onMobileInputModeChange('system'); current.onWorkIndicatorEnabledChange(false);
  for (const value of Object.values(state.preferences)) if (vi.isMockFunction(value)) expect(value).toHaveBeenCalledOnce();
  dispose?.(); dispose = undefined;
  expect(current.onThemeChange('dark')).toBe(false); current.onFontSizeChange(12); current.onFontFamilyChange('jetbrains');
  current.onFollowInputChange?.(true); current.onMobileInputModeChange('floe'); current.onWorkIndicatorEnabledChange(true);
  for (const value of Object.values(state.preferences)) if (vi.isMockFunction(value)) expect(value).toHaveBeenCalledOnce();
});

it('settles accepted retention while preserving read identity and the retained draft', async () => {
  const target = { kind: 'widget', id: 'widget-a', sessionId: 'session-a' } as const;
  await mount(target); const live = owner('widget-a'); await settle();
  const transport = editor().retentionTransport!, input = editorElement().querySelector('input')!; input.value = 'unfinished draft';
  const pending = deferred<object>(); live.configure.mockReturnValueOnce(pending.promise);
  const result = transport.configureHistoryRetention!('session-a', limits); await settle(); expect(live.configure).toHaveBeenCalledOnce();
  setHostTarget({ section: 'logging' }); await settle();
  expect(editor().retentionTransport).toBe(transport); expect(input.value).toBe('unfinished draft');
  pending.resolve({ accepted: true }); await expect(result).resolves.toEqual({ accepted: true });
  setHostTarget({ section: 'terminal', resource: terminalSettingsResource(target) }); await settle();
  expect(editor().retentionTransport).toBe(transport); expect(input.value).toBe('unfinished draft'); expect(live.configure).toHaveBeenCalledOnce();
});

it.each(['closed', 'category'] as const)('retires a font preflight across a %s presentation roundtrip', async change => {
  const target = { kind: 'widget', id: 'widget-a' } as const; await mount(target);
  const pending = deferred<RuntimeWorkbenchLayoutSnapshot>(); state.snapshot.mockReturnValueOnce(pending.promise); editor().onFontSizeChange(16);
  if (change === 'closed') setPresented(false); else setHostTarget({ section: 'logging' });
  await settle();
  if (change === 'closed') setPresented(true); else setHostTarget({ section: 'terminal', resource: terminalSettingsResource(target) });
  await settle(); pending.resolve(snapshot()); await settle(); expect(state.put).not.toHaveBeenCalled();
});
