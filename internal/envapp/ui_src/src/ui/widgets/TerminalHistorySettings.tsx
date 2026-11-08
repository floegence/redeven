import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import type { TerminalHistoryRetentionLimits, TerminalHistoryRetentionState } from '@floegence/floeterm-terminal-web/live';
import { useI18n } from '../i18n';
import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';
import { formatTerminalHistoryMemory, parseTerminalHistoryLimits } from '../services/terminalHistoryRetention';
import type { RedevenTerminalTransport } from '../services/terminalTransport';

type Defaults = { supported: boolean; can_manage: boolean; defaults: TerminalHistoryRetentionLimits };
const endpoint = '/_redeven_proxy/api/terminal/history-retention';

export function TerminalHistorySettings(props: { open: boolean; canManage?: boolean; transport?: RedevenTerminalTransport; sessionId?: string | null }) {
  const i18n = useI18n();
  const [defaults, setDefaults] = createSignal<Defaults | null>(null);
  const [current, setCurrent] = createSignal<TerminalHistoryRetentionState | null>(null);
  const [lines, setLines] = createSignal('');
  const [memory, setMemory] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [failed, setFailed] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [confirmation, setConfirmation] = createSignal<{ sessionId: string; limits: TerminalHistoryRetentionLimits } | null>(null);
  let epoch = 0;
  let disposed = false;
  const limits = createMemo(() => parseTerminalHistoryLimits(lines(), memory()));
  const valid = () => defaults()?.supported && limits() !== null && !loading() && !saving() && !uncertain();
  // IMPORTANT: Retained snapshots do not grant current mutation authority.
  // Revocation disables saves without discarding the user's draft.
  const canManageDefaults = () => props.canManage !== false && defaults()?.can_manage;
  const load = async (sessionId: string | null | undefined) => {
    const request = ++epoch;
    setLoading(true); setFailed(false); setMessage(''); setConfirmation(null); setDefaults(null); setCurrent(null);
    const [saved, session] = await Promise.allSettled([
      fetchLocalApiJSON<Defaults>(endpoint, { method: 'GET' }),
      sessionId && props.transport?.historyRetention ? props.transport.historyRetention(sessionId) : Promise.resolve(null),
    ]);
    if (request !== epoch) return;
    setLoading(false);
    if (saved.status === 'fulfilled' && saved.value.supported) {
      setDefaults(saved.value);
      setLines(saved.value.defaults.max_lines === null ? '' : String(saved.value.defaults.max_lines));
      setMemory(formatTerminalHistoryMemory(saved.value.defaults.max_bytes));
      setUncertain(false);
    } else {
      const error = saved.status === 'rejected' ? saved.reason : null;
      setFailed(true);
      setMessage(i18n.t((saved.status === 'fulfilled' || error instanceof LocalApiError && [404, 501].includes(error.status)) ? 'terminal.settings.historyUnavailable' : 'terminal.settings.historyLoadFailed'));
      return;
    }
    if (session.status === 'fulfilled') setCurrent(session.value);
    else { setFailed(true); setMessage(i18n.t('terminal.settings.historyLoadFailed')); }
  };
  createEffect(() => {
    const open = props.open, id = props.sessionId;
    if (open) void load(id);
    else { epoch += 1; setConfirmation(null); }
  });
  onCleanup(() => { disposed = true; epoch += 1; });
  const save = async (target: 'defaults' | 'current') => {
    const selected = target === 'current' ? confirmation() : null;
    const value = selected?.limits ?? limits();
    if (!valid() || !value || (target === 'defaults' && !canManageDefaults())
      || (target === 'current' && (!current() || !props.transport?.configureHistoryRetention || !selected || selected.sessionId !== props.sessionId))) return;
    const request = epoch;
    setSaving(true); setMessage(''); setFailed(false); setConfirmation(null);
    try {
      if (target === 'defaults') {
        const saved = await fetchLocalApiJSON<TerminalHistoryRetentionLimits>(endpoint, { method: 'PUT', body: JSON.stringify({ limits: value }) });
        if (request === epoch) setDefaults(previous => previous ? { ...previous, defaults: saved } : null);
        else if (!disposed && props.open) await load(props.sessionId);
      } else {
        const result = await props.transport!.configureHistoryRetention!(selected!.sessionId, value);
        if (request === epoch) setCurrent(result);
      }
      if (request === epoch) setMessage(i18n.t(target === 'defaults' ? 'terminal.settings.historySaved' : 'terminal.settings.historyApplied'));
    } catch {
      // A session switch may have read defaults before this mutation settled.
      // Only a new read after the uncertain outcome can permit another change.
      if (!disposed) {
        epoch += 1;
        setLoading(false); setConfirmation(null);
        setFailed(true); setUncertain(true); setMessage(i18n.t('terminal.settings.historyChangeUnknown'));
      }
    } finally { setSaving(false); }
  };
  return <section class="space-y-3" aria-busy={loading() || saving()} data-terminal-history-settings>
    <h3 class="text-[13px] font-medium">{i18n.t('terminal.settings.historyTitle')}</h3>
    <p class="text-xs text-muted-foreground">{i18n.t('terminal.settings.historyDescription')}</p>
    <Show when={defaults()?.supported}>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-xs">{i18n.t('terminal.settings.historyLines')}
          <Input type="text" inputmode="numeric" value={lines()} disabled={saving()} placeholder={i18n.t('terminal.settings.historyDefault')}
            onInput={event => { setLines(event.currentTarget.value); setConfirmation(null); }} aria-invalid={limits() === null} />
        </label>
        <label class="space-y-1 text-xs">{i18n.t('terminal.settings.historyMemory')}
          <Input type="text" inputmode="decimal" value={memory()} disabled={saving()} placeholder={i18n.t('terminal.settings.historyDefault')}
            onInput={event => { setMemory(event.currentTarget.value); setConfirmation(null); }} aria-invalid={limits() === null} />
        </label>
      </div>
      <Show when={limits() === null}><p role="alert" class="text-xs text-destructive">{i18n.t('terminal.settings.historyInvalid')}</p></Show>
      <Show when={current()}>{state => <p class="text-xs text-muted-foreground" data-terminal-history-effective>
        {i18n.t('terminal.settings.historyEffective', { lines: state().effective.max_lines === null ? '∞' : String(state().effective.max_lines), memory: state().effective.max_bytes === null ? '∞' : formatTerminalHistoryMemory(state().effective.max_bytes) })}
      </p>}</Show>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" class="h-auto min-h-8 whitespace-normal text-center" disabled={!valid() || !canManageDefaults()} onClick={() => void save('defaults')}>{i18n.t('terminal.settings.historySaveDefaults')}</Button>
        <Button size="sm" variant="outline" class="h-auto min-h-8 whitespace-normal text-center" disabled={!valid() || !current() || !props.sessionId || !props.transport?.configureHistoryRetention}
          onClick={() => setConfirmation({ sessionId: props.sessionId!, limits: limits()! })}>{i18n.t('terminal.settings.historyApplyCurrent')}</Button>
      </div>
      <Show when={!canManageDefaults()}><p class="text-xs text-muted-foreground">{i18n.t('terminal.settings.historyAdminOnly')}</p></Show>
    </Show>
    <Show when={confirmation()}><div role="alert" class="space-y-2 rounded-md border border-border p-3">
      <p class="text-xs">{i18n.t('terminal.settings.historyConfirm')}</p>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" class="h-auto min-h-8 whitespace-normal text-center" onClick={() => void save('current')}>{i18n.t('terminal.settings.historyApplyCurrent')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmation(null)}>{i18n.t('common.actions.cancel')}</Button>
      </div>
    </div></Show>
    <Show when={message()}><p role={failed() ? 'alert' : 'status'} class="text-xs" classList={{ 'text-destructive': failed() }}>{message()}</p></Show>
    <Show when={failed()}><Button size="sm" variant="outline" disabled={loading() || saving()} onClick={() => void load(props.sessionId)}>{i18n.t('terminal.settings.historyReload')}</Button></Show>
  </section>;
}
