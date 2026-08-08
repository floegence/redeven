import { Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, CheckCircle, Download, RefreshIcon } from '@floegence/floe-webapp-core/icons';

import { useI18n, type I18nHelpers } from '../i18n';
import type { PluginReleaseInstallOperation } from '@floegence/redevplugin-ui';

import type { PluginInstallOperationProjection } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS } from './pluginPresentation';

export function PluginInstallStatus(props: {
  projection: PluginInstallOperationProjection;
  pluginName?: string;
  onRetry?: () => void;
  compact?: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const failure = () => props.projection.operation?.failure ?? props.projection.startFailure;
  const retryable = () => props.projection.observation === 'refresh_failed'
    || props.projection.observation === 'activation_failed'
    || failure()?.retryable === true;
  const failed = () => props.projection.operation?.status === 'failed'
    || Boolean(props.projection.startFailure)
    || props.projection.observation === 'activation_failed';
  const active = () => !failed()
    && props.projection.observation !== 'refresh_failed'
    && (props.projection.observation === 'activating' || props.projection.operation?.status !== 'succeeded');
  const progress = () => props.projection.operation?.progress;
  const currentDiagnostic = () => {
    const operation = props.projection.operation;
    if (!operation) return undefined;
    return [...operation.phase_diagnostics].reverse()
      .find((diagnostic) => diagnostic.phase === operation.phase);
  };
  const missingPermissionIDs = () => props.projection.operation?.activation.status === 'needs_attention'
    ? props.projection.operation.activation.missing_permission_ids ?? []
    : [];
  const phaseRows = () => {
    const operation = props.projection.operation;
    if (!operation) return [];
    const diagnostics = new Map<string, PluginReleaseInstallOperation['phase_diagnostics'][number]>();
    for (const diagnostic of operation.phase_diagnostics) {
      diagnostics.set(diagnostic.phase, diagnostic);
    }
    const currentIndex = INSTALL_PHASES.indexOf(operation.phase as InstallPhase);
    return INSTALL_PHASES.map((phase, index) => {
      const diagnostic = diagnostics.get(phase);
      const completingActivation = props.projection.observation === 'activating';
      const complete = !completingActivation && operation.status === 'succeeded'
        || Boolean(diagnostic?.completed_at)
        || (currentIndex >= 0 && index < currentIndex);
      const state = completingActivation && phase === 'enable'
        ? 'active'
        : completingActivation && phase === 'complete'
          ? 'pending'
          : phase === operation.phase && !complete ? 'active' : complete ? 'complete' : 'pending';
      return {
        phase,
        diagnostic,
        state,
      } as const;
    });
  };
  const determinate = () => {
    const value = progress();
    if (!value || value.kind !== 'bytes' || !Number.isFinite(value.total) || value.total <= 0) return undefined;
    const total = Math.max(1, value.total);
    const completed = Number.isFinite(value.completed)
      ? Math.min(total, Math.max(0, value.completed))
      : 0;
    return { ...value, completed, total };
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
  const activePhaseDuration = () => {
    const diagnostic = currentDiagnostic();
    const operation = props.projection.operation;
    if (!diagnostic?.started_at || !operation || diagnostic.completed_at) return undefined;
    const startedAt = Date.parse(diagnostic.started_at);
    const updatedAt = Date.parse(operation.updated_at);
    if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt) || updatedAt < startedAt) return undefined;
    return formatDuration(updatedAt - startedAt, i18n.locale());
  };
  const statusIcon = () => (
    failed() || props.projection.observation === 'refresh_failed'
      ? AlertTriangle
      : props.projection.operation?.status === 'succeeded' && props.projection.observation !== 'activating'
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
          <Show when={active() && missingPermissionIDs().length > 0}>
            <div class="mt-2 rounded border border-border/60 bg-background/60 px-2 py-1.5">
              <p class="text-[11px] font-semibold leading-4">
                {i18n.t('uiCopy.plugin.permissionsTitle', { plugin: props.pluginName ?? i18n.t('uiCopy.plugin.externalPlugin') })}
              </p>
              <ul class="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {missingPermissionIDs().map((permissionID) => (
                  <li data-plugin-install-permission={permissionID}>{humanizePermissionIdentifier(permissionID)}</li>
                ))}
              </ul>
            </div>
          </Show>
          <Show when={(props.projection.operation?.attempt ?? 1) > 1}>
            <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {i18n.t('uiCopy.plugin.installOperation.retryAttempt', {
                attempt: props.projection.operation!.attempt,
              })}
            </p>
          </Show>
          <Show when={active() && activePhaseDuration()}>
            {(duration) => (
              <p data-plugin-install-phase-duration class="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {i18n.t('uiCopy.plugin.installOperation.phaseCompleted', { duration: duration() })}
              </p>
            )}
          </Show>
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
                  <span class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.min(100, Math.max(0, value().completed / value().total * 100))}%` }} />
                </div>
              )}
            </Show>
            <p class="mt-1 text-[11px] text-muted-foreground">{progressLabel()}</p>
          </Show>
          <Show when={phaseRows().length > 0}>
            <ol data-plugin-install-phase-history class="mt-3 space-y-1.5 border-t border-border/60 pt-2">
              {phaseRows().map((row) => (
                <li
                  data-plugin-install-phase={row.phase}
                  data-plugin-install-phase-state={row.state}
                  class={cn(
                    'flex min-w-0 items-center gap-2 text-[11px] leading-4',
                    row.state === 'active' && 'font-semibold text-foreground',
                    row.state === 'pending' && 'text-muted-foreground/60',
                    row.state === 'complete' && 'text-muted-foreground',
                  )}
                >
                  <span
                    aria-hidden="true"
                    class={cn(
                      'h-2 w-2 shrink-0 rounded-full border',
                      row.state === 'active' && 'border-primary bg-primary animate-pulse motion-reduce:animate-none',
                      row.state === 'complete' && 'border-success bg-success',
                      row.state === 'pending' && 'border-muted-foreground/40',
                    )}
                  />
                  <span class="min-w-0 flex-1 truncate">{installPhaseLabel(row.phase, i18n)}</span>
                  <Show when={row.diagnostic?.cache_hit}>
                    <span class="shrink-0 text-[10px] text-muted-foreground">{i18n.t('uiCopy.plugin.installOperation.cacheHit')}</span>
                  </Show>
                  <Show when={row.state !== 'active' && row.diagnostic?.duration_ms !== undefined}>
                    <span class="shrink-0 tabular-nums text-muted-foreground">
                      {i18n.t('uiCopy.plugin.installOperation.phaseCompleted', {
                        duration: formatDuration(row.diagnostic!.duration_ms!, i18n.locale()),
                      })}
                    </span>
                  </Show>
                </li>
              ))}
            </ol>
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
                : props.projection.observation === 'activation_failed'
                  ? i18n.t('uiCopy.plugin.installOperation.retryActivation')
                : i18n.t('common.actions.retry')}
            </button>
          </Show>
        </div>
      </div>
    </section>
  );
}

const INSTALL_PHASES = [
  'queued',
  'fetch_trust_evidence',
  'fetch_release_evidence',
  'download_package',
  'verify_hashes',
  'verify_signatures_ledger',
  'fetch_capability_evidence',
  'commit',
  'enable',
  'complete',
] as const;

type InstallPhase = typeof INSTALL_PHASES[number];

function installPhaseLabel(phase: InstallPhase, i18n: I18nHelpers): string {
  switch (phase) {
    case 'queued':
      return i18n.t('uiCopy.plugin.installOperation.queued');
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
    case 'complete':
      return i18n.t('uiCopy.plugin.installOperation.complete');
  }
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
  if (projection.observation === 'activating') {
    return i18n.t('uiCopy.plugin.installOperation.finishingSetup');
  }
  if (projection.observation === 'activation_failed') {
    return i18n.t('uiCopy.plugin.installOperation.activationFailed');
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
    maximumFractionDigits: amount < 10 ? 1 : 0,
  }).format(amount);
}

function formatDuration(value: number, locale: string): string {
  const bounded = Math.max(0, value);
  if (bounded < 1000) return `${Math.round(bounded)}ms`;
  const seconds = bounded / 1000;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: seconds < 10 ? 2 : 1,
  }).format(seconds)}s`;
}

function humanizePermissionIdentifier(permissionID: string): string {
  const normalized = permissionID
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._:/@-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return permissionID;
  return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
}
