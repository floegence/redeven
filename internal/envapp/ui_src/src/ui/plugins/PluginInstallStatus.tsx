import { For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, CheckCircle, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import type { PluginReleaseInstallProgressEvent } from '@floegence/redevplugin-ui';

import { useI18n, type I18nHelpers } from '../i18n';
import { pluginFailureCategory } from './pluginInstallFailure';
import type { PluginInstallExecutionProjection } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS } from './pluginPresentation';

type InstallStage = PluginReleaseInstallProgressEvent['stage'];
type InstallProgress = Pick<PluginReleaseInstallProgressEvent, 'stage' | 'status'>
  & Partial<Pick<PluginReleaseInstallProgressEvent, 'completed' | 'total'>>;
const INSTALL_STAGES: readonly InstallStage[] = ['download', 'verify', 'install', 'enable'];

export function PluginInstallStatus(props: {
  projection: PluginInstallExecutionProjection;
  pluginName?: string;
  onRetry?: () => void;
  onReviewAgain?: () => void;
  onResolveRetainedData?: () => void;
  compact?: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const execution = () => props.projection.execution;
  const failed = () => Boolean(props.projection.failure)
    || execution()?.status === 'failed'
    || execution()?.status === 'canceled'
    || execution()?.status === 'orphaned';
  const active = () => !failed()
    && props.projection.observation !== 'refresh_failed'
    && props.projection.observation !== 'activation_failed'
    && (
      props.projection.observation === 'finalizing'
      || props.projection.observation === 'reconnecting'
      || execution()?.status !== 'completed'
    );
  const recovery = () => props.projection.failure?.recovery ?? 'none';
  const progress = () => latestProgress(props.projection);
  const label = () => installStatusLabel(props.projection, i18n, progress());
  const statusIcon = () => (
    failed() || props.projection.observation === 'refresh_failed' || props.projection.observation === 'activation_failed'
      ? AlertTriangle
      : props.projection.observation === 'finalizing'
        || props.projection.observation === 'reconnecting'
        ? RefreshIcon
      : execution()?.status === 'completed'
        ? CheckCircle
        : RefreshIcon
  );

  return (
    <section
      data-plugin-install-execution={props.projection.pluginInstanceID}
      role={failed() || props.projection.observation === 'refresh_failed' || props.projection.observation === 'activation_failed' ? 'alert' : 'status'}
      aria-live={failed() || props.projection.observation === 'refresh_failed' || props.projection.observation === 'activation_failed' ? 'assertive' : 'polite'}
      aria-busy={active()}
      class={cn(
        'min-w-0 rounded-md border px-3 py-2.5',
        failed() || props.projection.observation === 'refresh_failed' || props.projection.observation === 'activation_failed'
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-primary/25 bg-primary/5 text-foreground',
        PLUGIN_ENTER_MOTION_CLASS,
      )}
    >
      <div class="flex min-w-0 items-start gap-2">
        <Dynamic component={statusIcon()} class={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          active()
            && props.projection.observation !== 'refresh_failed'
            && 'animate-spin motion-reduce:animate-none',
        )} />
        <div class="min-w-0 flex-1">
          <p class={cn('text-xs font-semibold leading-5', props.compact && 'line-clamp-2')}>{label()}</p>
          <PluginInstallSteps
            projection={props.projection}
            action={recovery()}
            actionLabel={props.projection.observation === 'refresh_failed'
              ? i18n.t('uiCopy.plugin.installOperation.retryRefresh')
              : props.projection.observation === 'activation_failed'
                ? i18n.t('uiCopy.plugin.installOperation.retryActivation')
                : recovery() === 'review_again'
                  ? i18n.t('uiCopy.plugin.installOperation.reviewAgain')
                : i18n.t('common.actions.retry')}
            onRetry={props.onRetry}
            onReviewAgain={props.onReviewAgain}
            onResolveRetainedData={props.onResolveRetainedData}
          />
        </div>
      </div>
    </section>
  );
}

function latestProgress(projection: PluginInstallExecutionProjection): InstallProgress | undefined {
  return projection.progress.at(-1);
}

function installStatusLabel(
  projection: PluginInstallExecutionProjection,
  i18n: I18nHelpers,
  progress?: InstallProgress,
): string {
  if (projection.observation === 'starting') return i18n.t('uiCopy.plugin.installOperation.starting');
  if (projection.observation === 'reconnecting') return i18n.t('uiCopy.plugin.installOperation.reconnecting');
  if (projection.observation === 'finalizing') return i18n.t('uiCopy.plugin.installOperation.finalizing');
  if (projection.observation === 'activation_failed') return i18n.t('uiCopy.plugin.installOperation.activationFailed');
  if (projection.observation === 'refresh_failed') return i18n.t('uiCopy.plugin.installOperation.refreshFailed');
  const execution = projection.execution;
  if (!execution) {
    return projection.failure
      ? installFailureLabel(projection.failure.code, i18n)
      : i18n.t('uiCopy.plugin.installOperation.starting');
  }
  if (execution.status === 'failed' || execution.status === 'canceled' || execution.status === 'orphaned') {
    return installFailureLabel(execution.failure_code ?? 'PLUGIN_INTERNAL_FAILURE', i18n);
  }
  if (execution.status === 'completed') return i18n.t('uiCopy.plugin.installOperation.complete');
  if (!progress) return i18n.t('uiCopy.plugin.installOperation.starting');
  return i18n.t(`uiCopy.plugin.installOperation.stage.${progress.stage}`);
}

export function PluginInstallSteps(props: {
  projection?: PluginInstallExecutionProjection;
  action?: NonNullable<PluginInstallExecutionProjection['failure']>['recovery'];
  actionLabel?: string;
  onRetry?: () => void;
  onReviewAgain?: () => void;
  onResolveRetainedData?: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const states = () => stageStates(props.projection);
  const current = () => states().findIndex((stage) => stage.status === 'running' || stage.status === 'failed');
  const position = () => {
    const activeIndex = current();
    if (activeIndex >= 0) return activeIndex + 1;
    return states().filter((stage) => stage.status === 'completed').length;
  };
  const byteProgress = () => {
    const stage = states().find((candidate) => candidate.status === 'running' && candidate.stage === 'download');
    if (!stage || stage.completed === undefined || stage.total === undefined || stage.total <= 0) return undefined;
    return { completed: stage.completed, total: stage.total };
  };
  return (
    <section class="mt-3 space-y-3" data-plugin-install-steps aria-label={i18n.t('uiCopy.plugin.installOperation.progressLabel')}>
      <div class="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
        <span>{i18n.t('uiCopy.plugin.installOperation.progressLabel')}</span>
        <span>{position()} / {INSTALL_STAGES.length}</span>
      </div>
      <div role="progressbar" data-plugin-install-progress class="relative h-1.5 overflow-hidden rounded-full bg-primary/15" aria-valuemin="0" aria-valuemax={INSTALL_STAGES.length} aria-valuenow={position()}>
        <span class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200" style={{ width: `${position() / INSTALL_STAGES.length * 100}%` }} />
      </div>
      <ol class="space-y-2">
        <For each={states()}>{(stage) => (
          <li class="flex min-h-6 items-center gap-2 text-xs" data-plugin-install-stage={stage.stage} data-plugin-install-stage-status={stage.status}>
            <Show when={stage.status === 'completed'} fallback={(
              <Show when={stage.status === 'failed'} fallback={(
                <Show when={stage.status === 'running'} fallback={<span class="w-4 text-center text-muted-foreground" aria-hidden="true">○</span>}>
                  <RefreshIcon class="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
                </Show>
              )}>
                <AlertTriangle class="h-4 w-4 text-destructive" />
              </Show>
            )}><CheckCircle class="h-4 w-4 text-primary" /></Show>
            <span class={cn(stage.status === 'pending' && 'text-muted-foreground', stage.status === 'running' && 'font-semibold text-foreground', stage.status === 'failed' && 'font-semibold text-destructive')}>
              {i18n.t(`uiCopy.plugin.installOperation.stage.${stage.stage}`)}
            </span>
            <Show when={stage.status === 'running'}>
              <span class="ml-auto text-[11px] text-muted-foreground">{i18n.t(`uiCopy.plugin.installOperation.stageStatus.${stage.stage}`)}</span>
            </Show>
            <Show when={stage.stage === 'download' && stage.status === 'running' && byteProgress()}>
              {(value) => <span class="ml-auto text-[11px] text-muted-foreground">{formatBytes(value().completed, i18n.locale())} / {formatBytes(value().total, i18n.locale())}</span>}
            </Show>
          </li>
        )}</For>
      </ol>
      <Show when={(
        props.action === 'replay_submission'
        || props.action === 'retry_install'
        || props.action === 'refresh_inventory'
        || props.action === 'retry_setup'
      ) && props.onRetry}>
        <button
          type="button"
          data-plugin-install-retry
          class={cn(
            'min-h-9 cursor-pointer rounded-md border border-current px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            PLUGIN_PRESS_MOTION_CLASS,
          )}
          onClick={() => props.onRetry?.()}
        >
          {props.actionLabel ?? i18n.t('common.actions.retry')}
        </button>
      </Show>
      <Show when={props.action === 'review_again' && props.onReviewAgain}>
        <button
          type="button"
          data-plugin-install-review-again
          class={cn(
            'min-h-9 cursor-pointer rounded-md border border-current px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            PLUGIN_PRESS_MOTION_CLASS,
          )}
          onClick={() => props.onReviewAgain?.()}
        >
          {props.actionLabel ?? i18n.t('uiCopy.plugin.installOperation.reviewAgain')}
        </button>
      </Show>
      <Show when={props.action === 'erase_retained_data' && props.onResolveRetainedData}>
        <button
          type="button"
          data-plugin-install-resolve-retained-data
          class={cn(
            'min-h-9 cursor-pointer rounded-md border border-current px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            PLUGIN_PRESS_MOTION_CLASS,
          )}
          onClick={() => props.onResolveRetainedData?.()}
        >
          {i18n.t('uiCopy.plugin.installOperation.resolveRetainedData')}
        </button>
      </Show>
    </section>
  );
}

function stageStates(projection?: PluginInstallExecutionProjection): Array<InstallProgress> {
  const states = new Map<InstallStage, InstallProgress>(INSTALL_STAGES.map((stage) => [stage, { stage, status: 'pending' }]));
  if (!projection) {
    states.set('download', { stage: 'download', status: 'running' });
    return INSTALL_STAGES.map((stage) => states.get(stage)!);
  }
  for (const progress of projection.progress) states.set(progress.stage, progress);
  // The platform emits the current stage as a stable event stream. A stage
  // transition implicitly completes every earlier stage, even when the
  // persistence update that records that transition is the only event that
  // survives a reconnect.
  const currentIndex = [...states.values()].reduce((index, stage, candidateIndex) => (
    stage.status === 'running' || stage.status === 'failed' ? candidateIndex : index
  ), -1);
  if (currentIndex > 0) {
    for (let index = 0; index < currentIndex; index += 1) {
      const stage = INSTALL_STAGES[index]!;
      if (states.get(stage)?.status !== 'failed') states.set(stage, { stage, status: 'completed' });
    }
  }
  if (projection.execution?.status === 'completed') {
    for (const stage of INSTALL_STAGES) states.set(stage, { stage, status: 'completed' });
  }
  if (projection.execution?.status === 'failed' && ![...states.values()].some((stage) => stage.status === 'failed')) {
    const failureStage = projection.failure?.stage;
    if (failureStage) {
      states.set(failureStage, { stage: failureStage, status: 'failed' });
    } else {
      for (const stage of INSTALL_STAGES) {
        if (states.get(stage)?.status === 'running') states.set(stage, { stage, status: 'pending' });
      }
    }
  }
  return INSTALL_STAGES.map((stage) => states.get(stage)!);
}

function installFailureLabel(code: string, i18n: I18nHelpers): string {
  switch (pluginFailureCategory(code)) {
    case 'network': return i18n.t('uiCopy.plugin.installOperation.failure.network');
    case 'timeout': return i18n.t('uiCopy.plugin.installOperation.failure.timeout');
    case 'asset_missing': return i18n.t('uiCopy.plugin.installOperation.failure.assetMissing');
    case 'asset_integrity': return i18n.t('uiCopy.plugin.installOperation.failure.assetIntegrity');
    case 'interrupted': return i18n.t('uiCopy.plugin.installOperation.failure.interrupted');
    case 'state_conflict': return i18n.t('uiCopy.plugin.installOperation.failure.stateConflict');
    case 'retained_data_incompatible': return i18n.t('uiCopy.plugin.installOperation.failure.retainedDataIncompatible');
    case 'denied': return i18n.t('uiCopy.plugin.installOperation.failure.denied');
    case 'manifest_invalid': return i18n.t('uiCopy.plugin.installOperation.failure.manifestInvalid');
    case 'trust': return i18n.t('uiCopy.plugin.installOperation.failure.trust');
    case 'package_invalid': return i18n.t('uiCopy.plugin.installOperation.failure.packageInvalid');
    case 'package_too_large': return i18n.t('uiCopy.plugin.installOperation.failure.packageTooLarge');
    case 'package_path_forbidden': return i18n.t('uiCopy.plugin.installOperation.failure.packagePathForbidden');
    case 'runtime_unavailable': return i18n.t('uiCopy.plugin.installOperation.failure.runtimeUnavailable');
    case 'runtime_incompatible': return i18n.t('uiCopy.plugin.installOperation.failure.runtimeVersionMismatch');
    case 'platform_unavailable': return i18n.t('uiCopy.plugin.installOperation.failure.platformUnavailable');
    case 'contract_mismatch': return i18n.t('uiCopy.plugin.installOperation.failure.contractMismatch');
    case 'internal':
    default: return i18n.t('uiCopy.plugin.installOperation.failure.internal');
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
    maximumFractionDigits: amount >= 10 || unit === 'byte' ? 0 : 1,
  }).format(amount);
}
