import { writeTextToClipboard } from '../utils/clipboard';
import { ErrorBoundary, For, Show, Suspense, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from 'solid-js';
import { Copy, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { openConnectionCenter } from '../services/desktopShellBridge';
import { reopenEnvironmentPage } from '../utils/windowNavigation';
import { createConnectionRecoveryPresentation, type ConnectionRecoveryStepID } from './createConnectionRecoveryPresentation';
import type { ConnectionIllustrationState } from './ConnectionRecoveryIllustration';

const ConnectionRecoveryIllustration = lazy(() => import('./ConnectionRecoveryIllustration').then(module => ({ default: module.ConnectionRecoveryIllustration })));
const IllustrationPlaceholder = () => <div class="mx-auto mb-5 h-28 w-60" aria-hidden="true" />;
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

export type ConnectionRecoveryViewProps = Readonly<{
  snapshot: ConnectionRecoverySnapshot;
  retainWorkspace?: boolean;
  environmentName: string;
  onRetry: () => Promise<void>;
  onStop: () => Promise<void>;
}>;

const STEP_TRANSLATION_KEYS = {
  interrupted: 'connectionRecovery.steps.interrupted',
  desktop_transport: 'connectionRecovery.steps.desktopTransport',
  protocol_connect: 'connectionRecovery.steps.protocolConnect',
  secure_session: 'connectionRecovery.steps.secureSession',
  completed: 'connectionRecovery.steps.completed',
} as const satisfies Readonly<Record<ConnectionRecoveryStepID, EnvAppTranslationKey>>;

export function ConnectionRecoveryView(props: ConnectionRecoveryViewProps) {
  const i18n = useI18n();
  const compact = () => props.retainWorkspace && props.snapshot.state !== 'failed';
  const presentation = createMemo(() => createConnectionRecoveryPresentation(props.snapshot));
  const [online, setOnline] = createSignal(navigator.onLine);
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [copied, setCopied] = createSignal(false);
  const [retrying, setRetrying] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let failedHeading: HTMLHeadingElement | undefined;
  let resumeButton: HTMLButtonElement | undefined;
  let stopButton: HTMLButtonElement | undefined;
  let previousState = props.snapshot.state;
  const offline = () => !online() && props.snapshot.state === 'recovering';

  onMount(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    onCleanup(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      clearTimeout(copyTimer);
    });
  });
  createEffect(() => {
    if (!props.snapshot.next_retry_at_unix_ms && !props.snapshot.retry_not_before_unix_ms) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    onCleanup(() => window.clearInterval(interval));
  });
  createEffect(() => {
    const state = props.snapshot.state;
    if (state === 'failed') queueMicrotask(() => failedHeading?.focus());
    if (state === 'paused' && !stopping()) queueMicrotask(() => resumeButton?.focus());
    if (state === 'recovering' && previousState === 'paused') queueMicrotask(() => stopButton?.focus());
    previousState = state;
  });

  const title = createMemo(() => {
    if (offline()) return i18n.t('connectionRecovery.title.offline');
    if (props.snapshot.state === 'succeeded') return i18n.t('connectionRecovery.title.recovered');
    if (props.snapshot.state === 'failed') return i18n.t('connectionRecovery.title.failed');
    if (props.snapshot.state === 'paused') return i18n.t('connectionRecovery.title.paused');
    return i18n.t('connectionRecovery.title.recovering');
  });
  const summary = createMemo(() => {
    if (offline()) return i18n.t('connectionRecovery.summary.offline');
    if (props.snapshot.state === 'succeeded') return i18n.t('connectionRecovery.summary.recovered');
    if (props.snapshot.state === 'failed') return i18n.t('connectionRecovery.summary.failed');
    if (props.snapshot.state === 'paused') return i18n.t('connectionRecovery.summary.paused');
    return i18n.t('connectionRecovery.summary.recovering');
  });
  const failureReason = createMemo(() => {
    const errorCode = props.snapshot.failure?.error_code;
    if (errorCode === 'gateway_unavailable') return i18n.t('connectionRecovery.failure.gatewayUnavailable');
    if (errorCode === 'gateway_target_unavailable') return i18n.t('connectionRecovery.failure.gatewayTargetUnavailable');
    if (errorCode === 'gateway_session_expired') return i18n.t('connectionRecovery.failure.gatewaySessionExpired');
    if (errorCode === 'process_identity_changed') return i18n.t('connectionRecovery.failure.processIdentityChanged');
    if (errorCode === 'remote_command_ended') return i18n.t('connectionRecovery.failure.remoteCommandEnded');
    switch (props.snapshot.failure?.code) {
      case 'authentication_failed': return i18n.t('connectionRecovery.failure.authenticationFailed');
      case 'missing_environment_context': return i18n.t('connectionRecovery.failure.missingEnvironmentContext');
      case 'secure_session_failed': return i18n.t('connectionRecovery.failure.secureSessionFailed');
      case 'runtime_offline': return i18n.t('connectionRecovery.failure.runtimeOffline');
      case 'runtime_unavailable': return i18n.t('connectionRecovery.failure.runtimeUnavailable');
      default: return i18n.t('connectionRecovery.failure.transportUnavailable');
    }
  });
  const retryRemainingSeconds = () => Math.max(0, Math.ceil(((props.snapshot.next_retry_at_unix_ms ?? 0) - nowMs()) / 1_000));
  const copyDiagnostic = async () => {
    await writeTextToClipboard(presentation().diagnostic_text);
    setCopied(true);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setCopied(false), 1_500);
  };
  const canRetry = createMemo(() => {
    if (offline() || props.snapshot.state !== 'recovering') return false;
    if (props.snapshot.phase === 'desktop_transport') return props.snapshot.desktop_transport?.actions.includes('retry_now') ?? false;
    return props.snapshot.next_retry_at_unix_ms !== undefined;
  });
  const serverWait = () => (props.snapshot.retry_not_before_unix_ms ?? 0) > nowMs();
  const illustrationState = createMemo<ConnectionIllustrationState>(() => {
    if (props.snapshot.state === 'succeeded') return 'succeeded';
    if (props.snapshot.state === 'failed') return 'failed';
    if (props.snapshot.state === 'paused') return 'paused';
    if (offline()) return 'offline';
    return props.snapshot.next_retry_at_unix_ms ? 'waiting' : 'connecting';
  });
  const canOpenConnectionCenter = () => props.snapshot.state === 'failed'
    && props.snapshot.desktop_transport?.actions.includes('open_connection_center');
  const retry = async () => {
    if (retrying()) return;
    setRetrying(true);
    try { await props.onRetry(); } finally { setRetrying(false); }
  };

  const stop = async () => {
    if (stopping()) return;
    setStopping(true);
    try { await props.onStop(); } finally { setStopping(false); }
  };

  return (
    <Show when={compact()} fallback={
    <section
      class="floe-window-status z-20"
      data-testid="connection-recovery-view"
      data-recovery-state={props.snapshot.state}
    >
      <div class="floe-window-status__content" data-recovery-content>
        <div>
          <ErrorBoundary fallback={<IllustrationPlaceholder />}><Suspense fallback={<IllustrationPlaceholder />}><ConnectionRecoveryIllustration state={illustrationState()} /></Suspense></ErrorBoundary>
          <p class="floe-window-status__identity">{props.environmentName}</p>
          <div role={props.snapshot.state === 'failed' ? undefined : 'status'} aria-live="polite" aria-atomic="true">
            {/* This heading receives announcement focus; keyboard indicators remain on the actions. */}
            <h1 ref={failedHeading} class="floe-window-status__title outline-none" style={{ 'box-shadow': 'none' }}
              role={props.snapshot.state === 'failed' ? 'alert' : undefined} tabindex={props.snapshot.state === 'failed' ? -1 : undefined}>
              {title()}
            </h1>
            <p class="floe-window-status__description">{summary()}</p>
          </div>
          <Show when={props.snapshot.state === 'recovering'}>
            <div class="floe-window-status__activity" data-recovery-activity>
              <p class="floe-window-status__label">{i18n.t('connectionRecovery.automaticRetry')}</p>
              <div class="flex items-center justify-center gap-2.5 text-[length:var(--floe-type-body)] font-medium text-foreground" role="timer" aria-live="off">
                <span class="tabular-nums" data-floe-progress-shimmer={!offline() && retryRemainingSeconds() === 0 ? 'text' : undefined}>{retryRemainingSeconds() > 0
                  ? i18n.t('connectionRecovery.retryIn', { seconds: retryRemainingSeconds() })
                  : props.snapshot.phase === 'secure_session'
                    ? i18n.t('connectionRecovery.steps.secureSession')
                    : i18n.t('connectionRecovery.connecting')}</span>
              </div>
              <Show when={serverWait()}><p class="mt-2 text-xs leading-5 text-muted-foreground">{i18n.t('connectionRecovery.retryLimited')}</p></Show>
            </div>
          </Show>
          <Show when={props.snapshot.state !== 'succeeded'}>
            <div class="floe-window-status__actions" data-recovery-actions>
              <Show when={canRetry()}>
                <Button class="min-h-10 cursor-pointer bg-foreground px-4 text-background hover:bg-foreground/90" size="sm" icon={Refresh} disabled={retrying() || serverWait()} onClick={() => void retry()}>
                  {i18n.t('connectionRecovery.retryNow')}
                </Button>
              </Show>
              <Show when={props.snapshot.state === 'recovering'}>
                <Button ref={stopButton} class="min-h-10 cursor-pointer px-4" size="sm" variant="ghost" disabled={stopping()} onClick={() => void stop()}>
                  {i18n.t('connectionRecovery.stopRetry')}
                </Button>
              </Show>
              <Show when={props.snapshot.state === 'paused'}>
                <Button ref={resumeButton} class="min-h-10 cursor-pointer bg-foreground px-4 text-background hover:bg-foreground/90" size="sm" icon={Refresh} disabled={stopping() || !online()} onClick={() => void retry()}>
                  {i18n.t('connectionRecovery.resumeRetry')}
                </Button>
              </Show>
              <Show when={canOpenConnectionCenter()}>
                <Button class="min-h-10 cursor-pointer px-4" size="sm" onClick={() => void openConnectionCenter()}>{i18n.t('connectionRecovery.openConnectionCenter')}</Button>
              </Show>
              <Show when={props.snapshot.state === 'failed' && !canOpenConnectionCenter()}>
                <Button class="min-h-10 cursor-pointer bg-foreground px-4 text-background hover:bg-foreground/90" size="sm" icon={Refresh} onClick={() => reopenEnvironmentPage(window)}>{i18n.t('connectionRecovery.reopenEnvironment')}</Button>
              </Show>
            </div>
          </Show>
        </div>
        <details class="floe-window-status__details">
          <summary class="mx-auto w-fit cursor-pointer select-none px-1 py-1.5 text-[11px] transition-colors hover:text-foreground">
            {i18n.t('connectionRecovery.technicalDetails')}
          </summary>
          <div class="mt-4 border-t border-border/60 pt-4 text-left">
            <Show when={props.snapshot.state === 'failed'}><p class="mb-4 text-xs leading-5 text-foreground">{failureReason()}</p></Show>
            <ol class="space-y-3" aria-label={i18n.t('connectionRecovery.timelineLabel')}>
              <For each={presentation().steps}>{(step) => (
                <li class="flex items-center gap-2.5">
                  <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${step.status === 'complete' ? 'bg-success' : step.status === 'active' ? 'bg-primary' : step.status === 'failed' ? 'bg-error' : 'bg-muted-foreground/30'}`} aria-hidden="true" />
                  <span class="min-w-0 flex-1">{i18n.t(STEP_TRANSLATION_KEYS[step.id])}</span>
                  <Show when={step.attempt_count > 0}><span>{i18n.tn('connectionRecovery.attempts', step.attempt_count)}</span></Show>
                </li>
              )}</For>
            </ol>
            <Show when={props.snapshot.state === 'failed'}>
              <div class="mt-5 flex items-start gap-2 border-t border-border pt-4">
                <pre class="min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4">{presentation().diagnostic_text}</pre>
                <Tooltip content={copied() ? i18n.t('connectionRecovery.copiedDiagnostic') : i18n.t('connectionRecovery.copyDiagnostic')} placement="top" delay={0}>
                  <button type="button" class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={copied() ? i18n.t('connectionRecovery.copiedDiagnostic') : i18n.t('connectionRecovery.copyDiagnostic')} onClick={() => void copyDiagnostic()}>
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            </Show>
          </div>
        </details>
      </div>
    </section>
    }>
      <aside class="absolute inset-x-3 top-3 z-20 mx-auto w-fit max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-background px-3 py-2 shadow-sm"
        data-recovery-compact data-testid="connection-recovery-view" data-recovery-state={props.snapshot.state}>
        <div class="flex min-w-0 items-center gap-3">
          <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
          <span class="min-w-0 truncate text-xs" role="status" aria-live="polite">{title()}</span>
          <details class="min-w-0 text-xs">
            <summary class="cursor-pointer whitespace-nowrap rounded px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{i18n.t('connectionRecovery.technicalDetails')}</summary>
            <div class="absolute left-1/2 top-full mt-1 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 max-h-[60vh] overflow-auto rounded-lg border border-border bg-background p-3 shadow-sm">
              <p class="mb-1 truncate text-xs font-medium">{props.environmentName}</p>
              <p class="mb-3 text-xs text-muted-foreground">{summary()}</p>
              <div class="flex flex-wrap items-center gap-2">
                <Show when={canRetry()}><Button size="sm" variant="outline" disabled={retrying() || serverWait()} onClick={() => void retry()}>{i18n.t('connectionRecovery.retryNow')}</Button></Show>
                <Show when={props.snapshot.state === 'recovering'}><Button ref={stopButton} size="sm" variant="ghost" disabled={stopping()} onClick={() => void stop()}>{i18n.t('connectionRecovery.stopRetry')}</Button></Show>
                <Show when={props.snapshot.state === 'paused'}><Button ref={resumeButton} size="sm" disabled={retrying() || !online()} onClick={() => void retry()}>{i18n.t('connectionRecovery.resumeRetry')}</Button></Show>
                <Button size="sm" variant="ghost" onClick={() => void copyDiagnostic()}>{i18n.t(copied() ? 'connectionRecovery.copiedDiagnostic' : 'connectionRecovery.copyDiagnostic')}</Button>
              </div>
              <pre class="mt-3 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-muted-foreground">{presentation().diagnostic_text}</pre>
            </div>
          </details>
        </div>
      </aside>
    </Show>
  );
}
