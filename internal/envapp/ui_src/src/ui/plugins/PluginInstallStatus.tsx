import { Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, CheckCircle, Download, RefreshIcon } from '@floegence/floe-webapp-core/icons';

import { useI18n, type I18nHelpers } from '../i18n';
import type { PluginInstallOperationProjection } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS } from './pluginPresentation';

export function PluginInstallStatus(props: {
  projection: PluginInstallOperationProjection;
  onRetry?: () => void;
  compact?: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const failure = () => props.projection.operation?.failure ?? props.projection.startFailure;
  const retryable = () => props.projection.observation === 'refresh_failed' || failure()?.retryable === true;
  const failed = () => props.projection.operation?.status === 'failed' || Boolean(props.projection.startFailure);
  const active = () => !failed()
    && props.projection.observation !== 'refresh_failed'
    && props.projection.operation?.status !== 'succeeded';
  const progress = () => props.projection.operation?.progress;
  const currentDiagnostic = () => {
    const operation = props.projection.operation;
    if (!operation) return undefined;
    return [...operation.phase_diagnostics].reverse()
      .find((diagnostic) => diagnostic.phase === operation.phase);
  };
  const determinate = () => {
    const value = progress();
    return value && value.kind === 'bytes' && value.total > 0 ? value : undefined;
  };
  const label = () => installStatusLabel(props.projection, i18n);
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
      : props.projection.operation?.status === 'succeeded'
        ? CheckCircle
        : progress()?.kind === 'bytes'
          ? Download
          : RefreshIcon
  );

  return (
    <section
      data-plugin-install-operation={props.projection.pluginInstanceID}
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
          active() && 'animate-spin motion-reduce:animate-none',
        )} />
        <div class="min-w-0 flex-1">
          <p class={cn('text-xs font-semibold leading-5', props.compact && 'line-clamp-2')}>{label()}</p>
          <Show when={currentDiagnostic()?.cache_hit}>
            <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {i18n.t('uiCopy.plugin.installOperation.cacheHit')}
            </p>
          </Show>
          <Show when={(props.projection.operation?.attempt ?? 1) > 1}>
            <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {i18n.t('uiCopy.plugin.installOperation.retryAttempt', {
                attempt: props.projection.operation!.attempt,
              })}
            </p>
          </Show>
          <Show when={determinate()}>
            {(value) => (
              <>
                <progress
                  data-plugin-install-progress
                  class="mt-2 block h-1.5 w-full accent-primary"
                  value={value().completed}
                  max={value().total}
                  aria-label={progressLabel()}
                />
                <p class="mt-1 text-[11px] text-muted-foreground">{progressLabel()}</p>
              </>
            )}
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

function installStatusLabel(
  projection: PluginInstallOperationProjection,
  i18n: I18nHelpers,
): string {
  if (projection.observation === 'starting') {
    return i18n.t('uiCopy.plugin.installOperation.starting');
  }
  if (projection.observation === 'reconnecting') {
    return i18n.t('uiCopy.plugin.installOperation.reconnecting');
  }
  if (projection.observation === 'refreshing') {
    return i18n.t('uiCopy.plugin.installOperation.refreshing');
  }
  if (projection.observation === 'refresh_failed') {
    return i18n.t('uiCopy.plugin.installOperation.refreshFailed');
  }
  const operation = projection.operation;
  if (!operation) {
    return projection.startFailure
      ? installFailureLabel(projection.startFailure.code, i18n)
      : i18n.t('uiCopy.plugin.installOperation.starting');
  }
  if (operation.status === 'failed') {
    return installFailureLabel(operation.failure?.code ?? 'PLUGIN_INTERNAL_FAILURE', i18n);
  }
  if (operation.status === 'succeeded') {
    return i18n.t('uiCopy.plugin.installOperation.complete');
  }
  if (operation.status === 'reconciling') {
    return i18n.t('uiCopy.plugin.installOperation.reconciling');
  }
  switch (operation.phase) {
    case 'fetch_trust_evidence':
      return i18n.t('uiCopy.plugin.installOperation.fetchingTrustEvidence');
    case 'fetch_release_evidence':
      return i18n.t('uiCopy.plugin.installOperation.fetchingReleaseEvidence');
    case 'download_package':
      return i18n.t('uiCopy.plugin.installOperation.downloadingPackage');
    case 'verify_hashes':
      return i18n.t('uiCopy.plugin.installOperation.verifyingHashes');
    case 'verify_signatures_ledger':
      return i18n.t('uiCopy.plugin.installOperation.verifyingSignaturesLedger');
    case 'fetch_capability_evidence':
      return i18n.t('uiCopy.plugin.installOperation.fetchingCapabilityEvidence');
    case 'commit':
      return i18n.t('uiCopy.plugin.installOperation.installing');
    case 'enable':
      return i18n.t('uiCopy.plugin.installOperation.enabling');
    default:
      return i18n.t('uiCopy.plugin.installOperation.queued');
  }
}

function installFailureLabel(code: string, i18n: I18nHelpers): string {
  switch (code) {
    case 'PLUGIN_RELEASE_NETWORK':
      return i18n.t('uiCopy.plugin.installOperation.failure.network');
    case 'PLUGIN_RELEASE_TIMEOUT':
      return i18n.t('uiCopy.plugin.installOperation.failure.timeout');
    case 'PLUGIN_RELEASE_ASSET_MISSING':
      return i18n.t('uiCopy.plugin.installOperation.failure.assetMissing');
    case 'PLUGIN_RELEASE_ASSET_INTEGRITY':
      return i18n.t('uiCopy.plugin.installOperation.failure.assetIntegrity');
    case 'PLUGIN_INSTALL_INTERRUPTED':
      return i18n.t('uiCopy.plugin.installOperation.failure.interrupted');
    case 'PLUGIN_INSTALL_STATE_CONFLICT':
      return i18n.t('uiCopy.plugin.installOperation.failure.stateConflict');
    case 'PLUGIN_ACTION_DENIED':
    case 'PLUGIN_PERMISSION_DENIED':
      return i18n.t('uiCopy.plugin.installOperation.failure.denied');
    case 'PLUGIN_RELEASE_REF_VERIFICATION_FAILED':
    case 'PLUGIN_RELEASE_REF_POLICY_DENIED':
    case 'PLUGIN_TRUST_STATE_DENIED':
    case 'PLUGIN_TRUST_VERIFICATION_REQUIRED':
    case 'PLUGIN_TRUST_VERIFICATION_INVALID':
      return i18n.t('uiCopy.plugin.installOperation.failure.trust');
    default:
      return i18n.t('uiCopy.plugin.installOperation.failure.internal');
  }
}

function formatBytes(value: number, locale: string): string {
  const bounded = Math.max(0, value);
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
    maximumFractionDigits: amount < 10 ? 1 : 0,
  }).format(amount);
}
