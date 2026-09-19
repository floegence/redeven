import { writeTextToClipboard } from '../utils/clipboard';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Check, Copy, Loader2, Refresh, WifiOffIcon } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { openConnectionCenter } from '../services/desktopShellBridge';
import { reopenEnvironmentPage } from '../utils/windowNavigation';
import { createConnectionRecoveryPresentation, type ConnectionRecoveryStepID } from './createConnectionRecoveryPresentation';
import { ConnectionPausedIllustration } from './ConnectionPausedIllustration';
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

export type ConnectionRecoveryViewProps = Readonly<{
  snapshot: ConnectionRecoverySnapshot;
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
    <section
      class={`absolute inset-0 z-20 flex overflow-auto px-4 py-6 sm:p-10 ${props.snapshot.state === 'failed' ? 'bg-background' : 'bg-background/90 backdrop-blur-sm'}`}
      data-testid="connection-recovery-view"
      data-recovery-state={props.snapshot.state}
    >
      <div class="m-auto w-full max-w-[460px] rounded-3xl border border-border/60 bg-card/80 px-6 py-8 text-center shadow-sm sm:px-9 sm:py-10" data-recovery-content>
        <div>
          <Show when={props.snapshot.state === 'failed' || props.snapshot.state === 'paused'} fallback={(
            <div class="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5" aria-hidden="true">
              {props.snapshot.state === 'succeeded' ? <Check class="h-6 w-6 text-success" />
                : offline() ? <WifiOffIcon class="h-6 w-6 text-muted-foreground" />
                  : <Refresh class="h-6 w-6 text-primary motion-safe:animate-[spin_3s_linear_infinite]" />}
            </div>
          )}>
            <div class="mb-4"><ConnectionPausedIllustration /></div>
          </Show>
          <p class="mx-auto mb-3 w-fit max-w-full break-words rounded-full border border-border/50 bg-muted/30 px-3 py-1 text-[11px] font-medium leading-5 text-muted-foreground">{props.environmentName}</p>
          <div role={props.snapshot.state === 'failed' ? undefined : 'status'} aria-live="polite" aria-atomic="true">
            {/* This heading receives announcement focus; keyboard indicators remain on the actions. */}
            <h1 ref={failedHeading} class="text-2xl font-semibold leading-8 tracking-tight text-foreground outline-none" style={{ 'box-shadow': 'none' }}
              role={props.snapshot.state === 'failed' ? 'alert' : undefined} tabindex={props.snapshot.state === 'failed' ? -1 : undefined}>
              {title()}
            </h1>
            <p class="mx-auto mt-3 max-w-[340px] text-[13px] leading-6 text-muted-foreground">{summary()}</p>
          </div>
          <Show when={props.snapshot.state === 'recovering'}>
            <div class="mt-6 rounded-2xl border border-border/50 bg-muted/25 px-4 py-4" data-recovery-activity>
              <p class="mb-2 text-[11px] font-medium text-muted-foreground">{i18n.t('connectionRecovery.automaticRetry')}</p>
              <div class="flex items-center justify-center gap-2.5 text-sm font-medium text-foreground" role="timer" aria-live="off">
                <Show when={!props.snapshot.next_retry_at_unix_ms} fallback={<span class="h-2 w-2 shrink-0 rounded-full bg-primary/65" aria-hidden="true" />}>
                  <Loader2 class="h-4 w-4 shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
                </Show>
                <span class="tabular-nums">{retryRemainingSeconds() > 0
                  ? i18n.t('connectionRecovery.retryIn', { seconds: retryRemainingSeconds() })
                  : props.snapshot.phase === 'secure_session'
                    ? i18n.t('connectionRecovery.steps.secureSession')
                    : i18n.t('connectionRecovery.connecting')}</span>
              </div>
              <Show when={serverWait()}><p class="mt-2 text-xs leading-5 text-muted-foreground">{i18n.t('connectionRecovery.retryLimited')}</p></Show>
            </div>
          </Show>
          <Show when={props.snapshot.state !== 'succeeded'}>
            <div class="mt-6 flex flex-wrap items-center justify-center gap-2" data-recovery-actions>
              <Show when={canRetry()}>
                <Button class="min-h-10 cursor-pointer rounded-full px-5" size="sm" icon={Refresh} disabled={retrying() || serverWait()} onClick={() => void retry()}>
                  {i18n.t('connectionRecovery.retryNow')}
                </Button>
              </Show>
              <Show when={props.snapshot.state === 'recovering'}>
                <Button ref={stopButton} class="min-h-10 cursor-pointer rounded-full px-5" size="sm" variant="ghost" disabled={stopping()} onClick={() => void stop()}>
                  {i18n.t('connectionRecovery.stopRetry')}
                </Button>
              </Show>
              <Show when={props.snapshot.state === 'paused'}>
                <Button ref={resumeButton} class="min-h-10 cursor-pointer rounded-full px-5" size="sm" icon={Refresh} disabled={stopping() || !online()} onClick={() => void retry()}>
                  {i18n.t('connectionRecovery.resumeRetry')}
                </Button>
              </Show>
              <Show when={canOpenConnectionCenter()}>
                <Button class="min-h-10 cursor-pointer rounded-full px-5" size="sm" onClick={() => void openConnectionCenter()}>{i18n.t('connectionRecovery.openConnectionCenter')}</Button>
              </Show>
              <Show when={props.snapshot.state === 'failed' && !canOpenConnectionCenter()}>
                <Button class="min-h-10 cursor-pointer rounded-full px-5" size="sm" icon={Refresh} onClick={() => reopenEnvironmentPage(window)}>{i18n.t('connectionRecovery.reopenEnvironment')}</Button>
              </Show>
            </div>
          </Show>
        </div>
        <details class="mx-auto mt-6 text-xs text-muted-foreground">
          <summary class="mx-auto w-fit cursor-pointer select-none rounded px-1 py-1.5 text-[11px] transition-colors hover:text-foreground">
            {i18n.t('connectionRecovery.technicalDetails')}
          </summary>
          <div class="mt-4 rounded-xl border border-border/60 bg-muted/20 p-4 text-left">
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
  );
}
