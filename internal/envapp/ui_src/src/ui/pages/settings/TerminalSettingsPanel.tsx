import type { RuntimeWorkbenchLayoutSnapshot } from '../../workbench/runtimeWorkbenchLayout';
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, on, untrack } from 'solid-js';
import { useResolvedFloeConfig, useTheme } from '@floegence/floe-webapp-core';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../../i18n';
import { useEnvContext } from '../EnvContext';
import { useEnvSettingsPage } from './EnvSettingsPageContext';
import { useTerminalSessionCatalog } from '../../services/terminalSessionCatalog';
import { parseTerminalSettingsResource, terminalSettingsResource, useTerminalSettingsAttachments, type TerminalSettingsTarget } from '../../services/terminalSettingsTargets';
import { TerminalSettingsDialog } from '../../widgets/TerminalSettingsDialog';
import { useTerminalPreferences, ensureTerminalPreferencesInitialized, TERMINAL_MIN_FONT_SIZE, TERMINAL_MAX_FONT_SIZE } from '../../services/terminalPreferences';
import { normalizeTerminalFontSize, normalizeTerminalFontFamilyId } from '../../services/terminalGeometry';
import { connectWorkbenchLayoutEventStream, getWorkbenchLayoutSnapshot, putWorkbenchWidgetState } from '../../services/workbenchLayoutApi';
import { createEnvResourceCollection } from '../../services/envResourceCache';

function reconcileTerminalSettingsSnapshot(previous: RuntimeWorkbenchLayoutSnapshot | undefined, next: RuntimeWorkbenchLayoutSnapshot): RuntimeWorkbenchLayoutSnapshot {
  if (!previous) return next;
  if (previous.seq > next.seq) return previous;
  const previousWidgets = new Map(previous.widgets.map(widget => [widget.widget_id, widget.widget_type]));
  const previousStates = new Map(previous.widget_states.map(state => [state.widget_id, state]));
  const nextStates = new Map(next.widget_states.map(state => [state.widget_id, state]));
  // IMPORTANT: A successful widget PUT may precede its SSE event. Full layout
  // snapshots advance layout/sequence, but cannot roll back a surviving widget's
  // independently revisioned state. Deleted/replaced widgets never inherit it.
  const widget_states = next.widgets.flatMap(widget => {
    const incoming = nextStates.get(widget.widget_id);
    const retained = previousWidgets.get(widget.widget_id) === widget.widget_type ? previousStates.get(widget.widget_id) : undefined;
    const state = retained?.widget_type === widget.widget_type && (!incoming || retained.revision > incoming.revision) ? retained : incoming;
    return state?.widget_type === widget.widget_type ? [state] : [];
  }).sort((left, right) => left.widget_id.localeCompare(right.widget_id));
  return { ...next, widget_states };
}

export function TerminalSettingsPanel(props: { resource?: string }) {
  const i18n = useI18n(), env = useEnvContext(), ctx = useEnvSettingsPage();
  const catalog = useTerminalSessionCatalog();
  const attachments = useTerminalSettingsAttachments();
  const resources = createEnvResourceCollection(env);
  const preferences = useTerminalPreferences(), theme = useTheme();
  ensureTerminalPreferencesInitialized(useResolvedFloeConfig().persist);
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const capture = () => { const generation = resources.access().generation; return () => !disposed && resources.ready() && resources.access().generation === generation; };
  const [streamError, setStreamError] = createSignal('');
  const [streamRestart, setStreamRestart] = createSignal(0);
  const [snapshot, { refetch, mutate }] = createResource(() => resources.ready() && ctx.canInteract() ? resources.access().generation + 1 : false, async (): Promise<RuntimeWorkbenchLayoutSnapshot> => {
    const current = capture(); const value = await getWorkbenchLayoutSnapshot();
    if (!current()) throw new DOMException('Settings authority changed', 'AbortError');
    const previous = untrack(() => snapshot.error ? undefined : snapshot());
    return reconcileTerminalSettingsSnapshot(previous, value);
  });
  const snapshotData = () => snapshot.error ? undefined : snapshot();
  const streamKey = createMemo(() => JSON.stringify([resources.ready(), resources.access().generation, streamRestart(), Boolean(snapshotData())]));
  createEffect(on(streamKey, () => {
    const value = untrack(snapshotData);
    if (!resources.ready() || !value) return;
    const controller = new AbortController(), current = capture();
    setStreamError('');
    // IMPORTANT: One stream per authority, independent of snapshot mutations.
    // Event sequence and state revision cannot move backwards after a save.
    void connectWorkbenchLayoutEventStream({ afterSeq: value.seq, signal: controller.signal, onEvent: event => {
      if (!current()) return;
      mutate(previous => {
        if (!previous || event.seq <= previous.seq) return previous;
        if ('widgets' in event.payload) return reconcileTerminalSettingsSnapshot(previous, { ...event.payload, seq: event.seq });
        const next = event.payload;
        const existing = previous.widget_states.find(state => state.widget_id === next.widget_id);
        return { ...previous, seq: event.seq, widget_states: existing && existing.revision > next.revision ? previous.widget_states : [...previous.widget_states.filter(state => state.widget_id !== next.widget_id), next] };
      });
    } }).then(() => { if (current() && !controller.signal.aborted) setStreamError(i18n.t('settings.targetUnavailable')); }, () => { if (current() && !controller.signal.aborted) setStreamError(i18n.t('settings.targetUnavailable')); });
    onCleanup(() => controller.abort());
  }));
  const widgets = () => snapshotData()?.widgets.filter(widget => widget.widget_type === 'redeven.terminal') ?? [];
  const sessions = () => [...new Map([
    ...(catalog?.sessions() ?? []).map(session => [session.id, session] as const),
    ...(attachments?.entries() ?? []).flatMap(owner => (owner.sessions?.() ?? []).map(session => [session.id, session] as const)),
  ]).values()];
  const widgetState = (id: string) => snapshotData()?.widget_states.find(state => state.widget_id === id && state.state.kind === 'terminal');
  const target = () => parseTerminalSettingsResource(props.resource);
  const available = (value: TerminalSettingsTarget | null) => !value || (value.kind === 'session' ? sessions().some(session => session.id === value.id)
    : widgets().some(widget => widget.widget_id === value.id) && (!value.sessionId || (() => { const state = widgetState(value.id)?.state; return state?.kind === 'terminal' && state.session_ids.includes(value.sessionId); })()));
  const valid = () => (!props.resource || !!target()) && available(target());
  const [visited, setVisited] = createSignal<string[]>(['']);
  createEffect(() => { const key = props.resource ?? ''; if (valid()) setVisited(old => old.includes(key) ? old : [...old, key]); });
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal('');
  const updateFont = async (id: string, patch: { font_size?: number; font_family_id?: string }) => {
    if (busy() || !ctx.canInteract() || !env.env()?.permissions?.can_write || !resources.ready()) return;
    const current = capture(); setBusy(true); setError('');
    try {
      // IMPORTANT: Refresh and CAS only the exact widget's font fields. Never
      // attach a terminal, recreate a missing widget, or overwrite session IDs.
      const latest = await getWorkbenchLayoutSnapshot();
      if (!current() || !ctx.canInteract() || !env.env()?.permissions?.can_write) return;
      const saved = latest.widget_states.find(state => state.widget_id === id && state.state.kind === 'terminal');
      if (!latest.widgets.some(widget => widget.widget_id === id && widget.widget_type === 'redeven.terminal') || saved && saved.state.kind !== 'terminal') throw new Error(i18n.t('settings.targetUnavailable'));
      const next = await putWorkbenchWidgetState(id, { base_revision: saved?.revision ?? 0, widget_type: 'redeven.terminal', state: { ...(saved?.state ?? { kind: 'terminal', session_ids: [] }), ...patch } });
      if (current()) mutate(previous => {
        const base = reconcileTerminalSettingsSnapshot(previous, latest);
        const existing = base.widget_states.find(state => state.widget_id === id);
        if (!base.widgets.some(widget => widget.widget_id === id) || existing && existing.revision >= next.revision) return base;
        return { ...base, widget_states: [...base.widget_states.filter(state => state.widget_id !== id), next] };
      });
    } catch (cause) { if (current()) setError(String(cause)); }
    finally { if (!disposed) setBusy(false); }
  };
  const Editor = (entry: { resource: string }) => {
    const selected = parseTerminalSettingsResource(entry.resource);
    const sessionID = () => selected?.kind === 'session' ? selected.id : selected?.sessionId;
    const controller = createMemo(() => {
      const owners = attachments?.entries().filter(owner => owner.ready() && owner.controllers().has(sessionID() ?? '') && (selected?.kind !== 'widget' || owner.widgetID === selected.id)) ?? [];
      return owners.length === 1 ? owners[0] : undefined;
    });
    const transport = createMemo(() => {
      const owner = controller(); const id = sessionID();
      if (!owner || !id) return undefined;
      const authority = owner.controllers().get(id); const current = capture();
      return { historyRetention: owner.transport.historyRetention, configureHistoryRetention: async (session: string, limits: Parameters<NonNullable<typeof owner.transport.configureHistoryRetention>>[1]) => {
        if (!current() || !available(selected) || session !== id || !owner.ready() || owner.controllers().get(id) !== authority) throw new Error(i18n.t('settings.targetUnavailable'));
        if (selected?.kind === 'widget') {
          const latest = await getWorkbenchLayoutSnapshot();
          const state = latest.widget_states.find(item => item.widget_id === selected.id)?.state;
          if (!current() || !owner.ready() || owner.controllers().get(id) !== authority || !latest.widgets.some(widget => widget.widget_id === selected.id) || state?.kind !== 'terminal' || !state.session_ids.includes(id)) throw new Error(i18n.t('settings.targetUnavailable'));
        }
        return owner.transport.configureHistoryRetention!(session, limits);
      } };
    });
    const geometry = () => selected?.kind === 'widget' ? widgetState(selected.id)?.state : null;
    const shared = () => geometry()?.kind === 'terminal' ? geometry() as Extract<NonNullable<ReturnType<typeof geometry>>, { kind: 'terminal' }> : null;
    return <fieldset disabled={busy() || !available(selected)} class="min-w-0">
      <TerminalSettingsDialog embedded open retentionCanManage={ctx.canInteract() && ctx.canAdmin()} retentionTransport={transport()} retentionAuthority={controller()?.controllers().get(sessionID() ?? '')} retentionSessionId={sessionID()}
        userTheme={preferences.userTheme()} fontSize={selected?.kind === 'widget' ? normalizeTerminalFontSize(shared()?.font_size) : preferences.fontSize()}
        fontFamilyId={selected?.kind === 'widget' ? normalizeTerminalFontFamilyId(shared()?.font_family_id) : preferences.fontFamilyId()} fontScope={selected?.kind === 'widget' ? 'shared-workbench' : 'local'}
        mobileInputMode={preferences.mobileInputMode()} systemAppearance={theme.resolvedTheme()} followInput={preferences.followInput()} onFollowInputChange={preferences.setFollowInput}
        workIndicatorEnabled={preferences.workIndicatorEnabled()} minFontSize={TERMINAL_MIN_FONT_SIZE} maxFontSize={TERMINAL_MAX_FONT_SIZE} onOpenChange={() => {}}
        onThemeChange={value => { preferences.setUserTheme(value); return true; }}
        onFontSizeChange={value => { if (selected?.kind === 'widget') void updateFont(selected.id, { font_size: normalizeTerminalFontSize(value) }); else preferences.setFontSize(value); }}
        onFontFamilyChange={value => { if (selected?.kind === 'widget') void updateFont(selected.id, { font_family_id: normalizeTerminalFontFamilyId(value) }); else preferences.setFontFamily(value); }}
        onMobileInputModeChange={preferences.setMobileInputMode} onWorkIndicatorEnabledChange={preferences.setWorkIndicatorEnabled} />
    </fieldset>;
  };
  const selection = () => target()?.kind === 'widget' ? terminalSettingsResource({ kind: 'widget', id: target()!.id }) : props.resource ?? '';
  return <div class="space-y-4" data-testid="terminal-settings-panel">
    <div class="flex gap-2"><Select ariaLabel={i18n.t('terminal.settings.target')} value={selection()} options={[
      { value: '', label: i18n.t('terminal.settings.defaultsTarget') },
      ...sessions().map(session => ({ value: terminalSettingsResource({ kind: 'session', id: session.id }), label: session.name || session.id })),
      ...widgets().map((widget, index) => ({ value: terminalSettingsResource({ kind: 'widget', id: widget.widget_id }), label: i18n.t('terminal.settings.widgetTarget', { number: index + 1 }) })),
    ]} onChange={resource => env.openSettings('terminal', { resource: resource || undefined })} />
    <Button variant="ghost" onClick={() => { void catalog?.refresh(); void Promise.resolve(refetch()).then(() => setStreamRestart(value => value + 1)); }} disabled={snapshot.loading}>{i18n.t('common.actions.refresh')}</Button></div>
    <Show when={target()?.kind === 'widget'}><Select ariaLabel={i18n.t('terminal.settings.sessionTarget')} value={target()?.sessionId ?? ''} options={[
      { value: '', label: i18n.t('terminal.settings.defaultsTarget') },
      ...sessions().filter(session => { const state = widgetState(target()!.id)?.state; return state?.kind === 'terminal' && state.session_ids.includes(session.id); }).map(session => ({ value: session.id, label: session.name || session.id })),
    ]} onChange={sessionId => env.openSettings('terminal', { resource: terminalSettingsResource({ kind: 'widget', id: target()!.id, ...(sessionId ? { sessionId } : {}) }) })} /></Show>
    <Show when={streamError()}><p role="alert">{streamError()}</p></Show>
    <Show when={snapshot.error || error()}><p role="alert">{error() || String(snapshot.error)}</p></Show>
    <Show when={!valid()}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
    <For each={visited()}>{resource => <div hidden={!valid() || (props.resource ?? '') !== resource} inert={!valid() || (props.resource ?? '') !== resource}><Editor resource={resource} /></div>}</For>
  </div>;
}
