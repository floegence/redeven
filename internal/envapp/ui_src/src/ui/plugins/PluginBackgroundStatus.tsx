import { Show, type JSX } from 'solid-js';
import { RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { useI18n, type I18nHelpers } from '../i18n';
import type { PluginExternalPackageBackgroundSummary, PluginInventoryItem } from './pluginTypes';

export function backgroundScheduleLabel(entry: Pick<PluginExternalPackageBackgroundSummary, 'interval_ms'>, i18n: I18nHelpers): string {
  if (entry.interval_ms === undefined) return i18n.t('uiCopy.plugin.external.backgroundEntry');
  const ms = entry.interval_ms;
  const unit = ms % 3_600_000 === 0 ? 'hour' : ms % 60_000 === 0 ? 'minute' : 'second';
  const value = ms / (unit === 'hour' ? 3_600_000 : unit === 'minute' ? 60_000 : 1_000);
  const interval = i18n.formatNumber(value, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 3 });
  return i18n.t('uiCopy.plugin.interval.every', { interval });
}

export function PluginBackgroundStatus(props: { item: PluginInventoryItem }): JSX.Element {
  const i18n = useI18n();
  const time = (value: string | undefined) => value && Number.isFinite(Date.parse(value))
    ? i18n.formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' }) : undefined;
  const stateLabel = (state: string) => {
    switch (state) {
      case 'scheduled': return i18n.t('uiCopy.plugin.interval.state.scheduled');
      case 'running': return i18n.t('uiCopy.plugin.interval.state.running');
      case 'stopped': return i18n.t('uiCopy.plugin.interval.state.stopped');
      default: return i18n.t('uiCopy.plugin.interval.state.blocked');
    }
  };
  return <Show when={props.item.backgroundInterval}>{(status) => (
    <div data-plugin-background-status={status().state} class="space-y-2 rounded-lg border px-3 py-3">
      <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <RefreshIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
        <span class="font-medium">{backgroundScheduleLabel(status(), i18n)}</span>
        <span class="ml-auto text-muted-foreground">{stateLabel(status().state)}</span>
      </div>
      <Show when={status().last_outcome === 'unknown' || status().last_outcome === 'failed'}>
        <p data-plugin-background-outcome class="text-xs text-destructive">{i18n.t(status().last_outcome === 'unknown' ? 'uiCopy.plugin.interval.unknown' : 'uiCopy.plugin.interval.failed')}</p>
      </Show>
      <Show when={status().state === 'scheduled' && time(status().next_run_at)}>{(next) => <p class="text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.interval.next', { time: next() })}</p>}</Show>
    </div>
  )}</Show>;
}
