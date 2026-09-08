import { For, Show, createEffect, createMemo, createSignal, createUniqueId } from 'solid-js';
import { Database } from '@floegence/floe-webapp-core/icons';
import type { AIReadinessController } from '../../flower/aiReadiness';
import { useI18n } from '../../i18n';
import { fetchLocalApiJSON } from '../../services/localApi';
import { SettingRow, SettingsPill } from './SettingsPrimitives';

type FlowerSnapshot = Readonly<{
  id: string;
  created_at: string;
  source_build: string;
  bytes: number;
  kind: 'automatic' | 'before_restore';
  protected: boolean;
  unavailable?: boolean;
}>;

const BUTTON_CLASS = 'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55';

export function FlowerStorageSettings(props: Readonly<{ controller: AIReadinessController; canAdmin?: boolean }>) {
  const i18n = useI18n();
  const panelID = createUniqueId();
  const [snapshots, setSnapshots] = createSignal<readonly FlowerSnapshot[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [selected, setSelected] = createSignal<FlowerSnapshot | null>(null);
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal<'load' | 'restore' | null>(null);
  const [accepted, setAccepted] = createSignal(false);
  const busy = createMemo(() => !['ready', 'degraded', 'blocked'].includes(props.controller.snapshot().state));
  let adminEpoch = 0;
  const hasAccess = (epoch: number): boolean => Boolean(props.canAdmin) && epoch === adminEpoch;

  createEffect(() => {
    if (props.canAdmin) return;
    adminEpoch++;
    setSnapshots(null);
    setSelected(null);
    setLoading(false);
    setPending(false);
    setFailed(null);
    setAccepted(false);
  });

  const load = async (): Promise<void> => {
    if (!props.canAdmin || loading() || pending()) return;
    const epoch = adminEpoch;
    setLoading(true);
    setFailed(null);
    setSelected(null);
    try {
      const result = await fetchLocalApiJSON<{ snapshots: FlowerSnapshot[] }>('/_redeven_proxy/api/ai/maintenance/snapshots', { method: 'GET' });
      if (hasAccess(epoch)) setSnapshots(result.snapshots);
    } catch {
      if (hasAccess(epoch)) setFailed('load');
    } finally {
      if (hasAccess(epoch)) setLoading(false);
    }
  };

  const restore = async (): Promise<void> => {
    const snapshot = selected();
    if (!props.canAdmin || !snapshot || snapshot.unavailable || pending() || busy()) return;
    const epoch = adminEpoch;
    setPending(true);
    setFailed(null);
    setAccepted(false);
    try {
      await fetchLocalApiJSON('/_redeven_proxy/api/ai/maintenance/restore', {
        method: 'POST', body: JSON.stringify({ snapshot_id: snapshot.id, confirmed: true }),
      });
      if (!hasAccess(epoch)) return;
      setSelected(null);
      setAccepted(true);
      await props.controller.refresh();
    } catch {
      if (hasAccess(epoch)) setFailed('restore');
    } finally {
      if (hasAccess(epoch)) setPending(false);
    }
  };

  const date = (snapshot: FlowerSnapshot): string => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(snapshot.created_at));
  const size = (snapshot: FlowerSnapshot): string => new Intl.NumberFormat(i18n.locale(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(snapshot.bytes / 1_000_000);
  const build = (snapshot: FlowerSnapshot): string => snapshot.source_build === 'before-maintenance-baseline'
    ? i18n.t('aiReadiness.storage.unknownBuild')
    : snapshot.source_build.replace(/:([a-f0-9]{64})$/u, (_, hash: string) => ` · ${hash.slice(0, 12)}`);

  return (
    <SettingRow icon={Database} title={i18n.t('aiReadiness.storage.title')} description={i18n.t('aiReadiness.storage.description')}>
      <Show when={props.canAdmin} fallback={<p class="text-xs text-muted-foreground">{i18n.t('aiReadiness.storage.adminOnly')}</p>}>
        <button type="button" class={BUTTON_CLASS} disabled={loading() || pending()} aria-busy={loading() || undefined} aria-expanded={snapshots() !== null} aria-controls={panelID} onClick={() => void load()}>
          {loading() ? i18n.t('aiReadiness.settings.refreshing') : snapshots() ? i18n.t('common.actions.refresh') : i18n.t('aiReadiness.storage.view')}
        </button>
        <Show when={failed()}><p role="alert" class="mt-3 text-xs text-destructive">{failed() === 'load' ? i18n.t('aiReadiness.storage.loadFailed') : i18n.t('aiReadiness.storage.restoreFailed')}</p></Show>
        <Show when={accepted()}><p role="status" class="mt-3 text-xs text-muted-foreground">{i18n.t('aiReadiness.storage.accepted')}</p></Show>
        <div id={panelID}>
          <Show when={snapshots()}>{(items) => (
            <Show when={items().length > 0} fallback={<p class="mt-3 text-xs text-muted-foreground">{i18n.t('aiReadiness.storage.empty')}</p>}>
              <ul class="mt-3 divide-y divide-border border-y border-border" aria-label={i18n.t('aiReadiness.storage.title')}>
                <For each={items()}>{(snapshot) => (
                  <li class="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
                    <div class="min-w-0 space-y-1">
                      <p class="text-xs font-semibold"><Show when={!snapshot.unavailable} fallback={i18n.t('aiReadiness.storage.unavailable')}><time dateTime={snapshot.created_at}>{date(snapshot)}</time></Show></p>
                      <p class="break-all text-xs text-muted-foreground">{snapshot.unavailable ? snapshot.id : `${build(snapshot)} · ${size(snapshot)}`}</p>
                      <div class="flex flex-wrap gap-2">
                        <Show when={!snapshot.unavailable}><SettingsPill>{snapshot.kind === 'before_restore' ? i18n.t('aiReadiness.storage.beforeRestore') : i18n.t('aiReadiness.storage.automatic')}</SettingsPill></Show>
                        <Show when={snapshot.protected}><SettingsPill>{i18n.t('aiReadiness.storage.protected')}</SettingsPill></Show>
                      </div>
                    </div>
                    <button type="button" class={BUTTON_CLASS} disabled={snapshot.unavailable || busy() || pending()} aria-pressed={selected()?.id === snapshot.id} onClick={() => { setSelected(snapshot); setFailed(null); setAccepted(false); }}>
                      {i18n.t('aiReadiness.storage.reviewRestore')}
                    </button>
                  </li>
                )}</For>
              </ul>
            </Show>
          )}</Show>
          <Show when={selected()}>{(snapshot) => (
            <section class="mt-4 rounded-lg border border-border bg-muted/30 p-4" aria-label={i18n.t('aiReadiness.storage.confirmTitle')} onKeyDown={(event) => { if (event.key === 'Escape' && !pending()) setSelected(null); }}>
              <h4 class="text-sm font-semibold">{i18n.t('aiReadiness.storage.confirmTitle')}</h4>
              <p class="mt-1 text-xs font-semibold">{date(snapshot())} · {build(snapshot())}</p>
              <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.storage.scope')}</p>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.storage.executionImpact')}</p>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.storage.externalImpact')}</p>
              <div class="mt-4 flex flex-wrap gap-2">
                <button ref={(button) => queueMicrotask(() => button.focus({ preventScroll: false }))} type="button" class={BUTTON_CLASS} disabled={pending()} onClick={() => setSelected(null)}>{i18n.t('common.actions.cancel')}</button>
                <button type="button" class={`${BUTTON_CLASS} border-destructive/40 text-destructive`} disabled={pending() || busy()} aria-busy={pending() || undefined} onClick={() => void restore()}>{i18n.t('aiReadiness.storage.confirm')}</button>
              </div>
            </section>
          )}</Show>
        </div>
      </Show>
    </SettingRow>
  );
}
