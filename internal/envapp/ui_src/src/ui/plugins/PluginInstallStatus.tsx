import { Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, CheckCircle, Download, RefreshIcon } from '@floegence/floe-webapp-core/icons';

import { useI18n, type I18nHelpers } from '../i18n';
import type { PluginInstallExecutionProjection } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS } from './pluginPresentation';

type InstallProgress = Readonly<{
  phase?: string;
  kind?: string;
  completed?: number;
  total?: number;
}>;

export function PluginInstallStatus(props: {
  projection: PluginInstallExecutionProjection;
  pluginName?: string;
  onRetry?: () => void;
  compact?: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const execution = () => props.projection.execution;
  const failed = () => Boolean(props.projection.startFailure)
    || execution()?.status === 'failed'
    || execution()?.status === 'canceled'
    || execution()?.status === 'orphaned';
  const active = () => !failed()
    && props.projection.observation !== 'refresh_failed'
    && execution()?.status !== 'completed';
  const retryable = () => props.projection.observation === 'refresh_failed'
    || props.projection.startFailure?.retryable === true
    || retryableFailureCode(execution()?.failure_code);
  const progress = () => latestProgress(props.projection);
  const determinate = () => {
    const value = progress();
    if (value?.kind !== 'bytes' || !Number.isFinite(value.total) || Number(value.total) <= 0) return undefined;
    const total = Math.max(1, Number(value.total));
    const completed = Number.isFinite(value.completed)
      ? Math.min(total, Math.max(0, Number(value.completed)))
      : 0;
    return { completed, total };
  };
  const label = () => installStatusLabel(props.projection, i18n, progress()?.phase);
  const progressLabel = () => {
    const value = determinate();
    if (!value) return label();
    return i18n.t('uiCopy.plugin.installOperation.byteProgress', {
      completed: formatBytes(value.completed, i18n.locale()),
      total: formatBytes(value.total, i18n.locale()),
    });
  };
  const statusIcon = () => (
    failed() || props.projection.observation === 'refresh_failed'
      ? AlertTriangle
      : execution()?.status === 'completed'
        ? CheckCircle
        : progress()?.kind === 'bytes'
          ? Download
          : RefreshIcon
  );

  return (
    <section
      data-plugin-install-execution={props.projection.pluginInstanceID}
      role={failed() || props.projection.observation === 'refresh_failed' ? 'alert' : 'status'}
      aria-live={failed() || props.projection.observation === 'refresh_failed' ? 'assertive' : 'polite'}
      aria-busy={active()}
      class={cn(
        'min-w-0 rounded-md border px-3 py-2.5',
        failed() || props.projection.observation === 'refresh_failed'
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-primary/25 bg-primary/5 text-foreground',
        PLUGIN_ENTER_MOTION_CLASS,
      )}
    >
      <div class="flex min-w-0 items-start gap-2">
        <Dynamic component={statusIcon()} class={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          active() && progress()?.kind !== 'bytes' && 'animate-spin motion-reduce:animate-none',
        )} />
        <div class="min-w-0 flex-1">
          <p class={cn('text-xs font-semibold leading-5', props.compact && 'line-clamp-2')}>{label()}</p>
          <Show when={active()}>
            <Show when={determinate()} fallback={(
              <div
                data-plugin-install-progress
                role="progressbar"
                class="relative mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
                aria-label={progressLabel()}
                aria-valuetext={progressLabel()}
              >
                <span class="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary animate-[plugin-install-progress_1.2s_ease-in-out_infinite] motion-reduce:animate-none" />
              </div>
            )}>
              {(value) => (
                <div
                  data-plugin-install-progress
                  role="progressbar"
                  class="relative mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
                  aria-valuenow={value().completed}
                  aria-valuemin="0"
                  aria-valuemax={value().total}
                  aria-label={progressLabel()}
                  aria-valuetext={progressLabel()}
                >
                  <span
                    class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${Math.min(100, Math.max(0, value().completed / value().total * 100))}%` }}
                  />
                </div>
              )}
            </Show>
            <p class="mt-1 text-[11px] text-muted-foreground">{progressLabel()}</p>
          </Show>
          <Show when={retryable() && props.onRetry}>
            <button
              type="button"
              data-plugin-install-retry
              class={cn(
                'mt-2 min-h-9 cursor-pointer rounded-md border border-current px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                PLUGIN_PRESS_MOTION_CLASS,
              )}
              onClick={() => props.onRetry?.()}
            >
              {props.projection.observation === 'refresh_failed'
                ? i18n.t('uiCopy.plugin.installOperation.retryRefresh')
                : i18n.t('common.actions.retry')}
            </button>
          </Show>
        </div>
      </div>
    </section>
  );
}

function latestProgress(projection: PluginInstallExecutionProjection): InstallProgress | undefined {
  for (let index = projection.events.length - 1; index >= 0; index -= 1) {
    const payload = projection.events[index]?.payload;
    if (!payload || typeof payload !== 'object') continue;
    const progress = payload.progress;
    if (!progress || typeof progress !== 'object') continue;
    const candidate = progress as Record<string, unknown>;
    return {
      ...(typeof payload.phase === 'string' ? { phase: payload.phase } : {}),
      ...(typeof candidate.kind === 'string' ? { kind: candidate.kind } : {}),
      ...(typeof candidate.completed === 'number' ? { completed: candidate.completed } : {}),
      ...(typeof candidate.total === 'number' ? { total: candidate.total } : {}),
    };
  }
  return undefined;
}

function installStatusLabel(
  projection: PluginInstallExecutionProjection,
  i18n: I18nHelpers,
  phase?: string,
): string {
  if (projection.observation === 'starting') return i18n.t('uiCopy.plugin.installOperation.starting');
  if (projection.observation === 'reconnecting') return i18n.t('uiCopy.plugin.installOperation.reconnecting');
  if (projection.observation === 'refreshing') return i18n.t('uiCopy.plugin.installOperation.refreshing');
  if (projection.observation === 'refresh_failed') return i18n.t('uiCopy.plugin.installOperation.refreshFailed');
  const execution = projection.execution;
  if (!execution) {
    return projection.startFailure
      ? installFailureLabel(projection.startFailure.code, i18n)
      : i18n.t('uiCopy.plugin.installOperation.starting');
  }
  if (execution.status === 'failed' || execution.status === 'canceled' || execution.status === 'orphaned') {
    return installFailureLabel(execution.failure_code ?? 'PLUGIN_INTERNAL_FAILURE', i18n);
  }
  if (execution.status === 'completed') return i18n.t('uiCopy.plugin.installOperation.complete');
  switch (phase) {
    case 'fetch_trust_evidence': return i18n.t('uiCopy.plugin.installOperation.fetchingTrustEvidence');
    case 'fetch_release_evidence': return i18n.t('uiCopy.plugin.installOperation.fetchingReleaseEvidence');
    case 'download_package': return i18n.t('uiCopy.plugin.installOperation.downloadingPackage');
    case 'verify_hashes': return i18n.t('uiCopy.plugin.installOperation.verifyingHashes');
    case 'verify_signatures_ledger': return i18n.t('uiCopy.plugin.installOperation.verifyingSignaturesLedger');
    case 'fetch_capability_evidence': return i18n.t('uiCopy.plugin.installOperation.fetchingCapabilityEvidence');
    case 'commit': return i18n.t('uiCopy.plugin.installOperation.installing');
    case 'enable': return i18n.t('uiCopy.plugin.installOperation.enabling');
    default: return i18n.t('uiCopy.plugin.installOperation.queued');
  }
}

function installFailureLabel(code: string, i18n: I18nHelpers): string {
  switch (code) {
    case 'PLUGIN_RELEASE_NETWORK': return i18n.t('uiCopy.plugin.installOperation.failure.network');
    case 'PLUGIN_RELEASE_TIMEOUT': return i18n.t('uiCopy.plugin.installOperation.failure.timeout');
    case 'PLUGIN_RELEASE_ASSET_MISSING': return i18n.t('uiCopy.plugin.installOperation.failure.assetMissing');
    case 'PLUGIN_RELEASE_ASSET_INTEGRITY': return i18n.t('uiCopy.plugin.installOperation.failure.assetIntegrity');
    case 'PLUGIN_INSTALL_INTERRUPTED': return i18n.t('uiCopy.plugin.installOperation.failure.interrupted');
    case 'PLUGIN_INSTALL_STATE_CONFLICT': return i18n.t('uiCopy.plugin.installOperation.failure.stateConflict');
    case 'PLUGIN_ACTION_DENIED':
    case 'PLUGIN_PERMISSION_DENIED': return i18n.t('uiCopy.plugin.installOperation.failure.denied');
    case 'PLUGIN_RELEASE_REF_VERIFICATION_FAILED':
    case 'PLUGIN_RELEASE_REF_POLICY_DENIED':
    case 'PLUGIN_TRUST_STATE_DENIED':
    case 'PLUGIN_TRUST_VERIFICATION_REQUIRED':
    case 'PLUGIN_TRUST_VERIFICATION_INVALID': return i18n.t('uiCopy.plugin.installOperation.failure.trust');
    default: return i18n.t('uiCopy.plugin.installOperation.failure.internal');
  }
}

function retryableFailureCode(code?: string): boolean {
  return code === 'PLUGIN_RELEASE_NETWORK'
    || code === 'PLUGIN_RELEASE_TIMEOUT'
    || code === 'PLUGIN_INSTALL_INTERRUPTED';
}

function formatBytes(value: number, locale: string): string {
  const bounded = Number.isFinite(value) ? Math.max(0, value) : 0;
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let amount = bounded;
  let unit: typeof units[number] = 'byte';
  for (const candidate of units) {
    unit = candidate;
    if (amount < 1024 || candidate === 'gigabyte') break;
    amount /= 1024;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: amount >= 10 || unit === 'byte' ? 0 : 1,
  }).format(amount);
}
