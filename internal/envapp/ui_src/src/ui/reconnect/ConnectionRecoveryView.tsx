import { writeTextToClipboard } from '../utils/clipboard';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Check, AlertCircle, Copy, Loader2, Refresh, Cloud, WifiOffIcon } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { openConnectionCenter } from '../services/desktopShellBridge';
import { reloadCurrentPage } from '../utils/windowNavigation';
import { createConnectionRecoveryPresentation, type ConnectionRecoveryStepID } from './createConnectionRecoveryPresentation';
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

export type ConnectionRecoveryViewProps = Readonly<{
  snapshot: ConnectionRecoverySnapshot;
  environmentName: string;
  onRetry: () => Promise<void>;
}>;

const STEP_TRANSLATION_KEYS = {
  interrupted: 'connectionRecovery.steps.interrupted',
  desktop_transport: 'connectionRecovery.steps.desktopTransport',
  runtime_probe: 'connectionRecovery.steps.runtimeProbe',
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
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let failedHeading: HTMLHeadingElement | undefined;
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
    if (!props.snapshot.next_retry_at_unix_ms) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    onCleanup(() => window.clearInterval(interval));
  });
  createEffect(() => {
    if (props.snapshot.state === 'failed') queueMicrotask(() => failedHeading?.focus());
  });

  const title = createMemo(() => {
    if (offline()) return i18n.t('connectionRecovery.title.offline');
    if (props.snapshot.state === 'succeeded') return i18n.t('connectionRecovery.title.recovered');
    if (props.snapshot.state === 'failed') return i18n.t('connectionRecovery.title.failed');
    return i18n.t('connectionRecovery.title.recovering');
  });
  const summary = createMemo(() => {
    if (offline()) return i18n.t('connectionRecovery.summary.offline');
    if (props.snapshot.state === 'succeeded') return i18n.t('connectionRecovery.summary.recovered');
    if (props.snapshot.state === 'failed') return i18n.t('connectionRecovery.summary.failed');
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
    return props.snapshot.phase === 'runtime_probe' || props.snapshot.phase === 'protocol_connect';
  });
  const canOpenConnectionCenter = () => props.snapshot.state === 'failed'
    && props.snapshot.desktop_transport?.actions.includes('open_connection_center');
  const retry = async () => {
    if (retrying()) return;
    setRetrying(true);
    try { await props.onRetry(); } finally { setRetrying(false); }
  };

  return (
    <section
      class="absolute inset-0 z-20 flex overflow-auto bg-background/85 px-5 py-8 backdrop-blur-sm sm:p-10"
      data-testid="connection-recovery-view"
      data-recovery-state={props.snapshot.state}
    >
      <div class="m-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <div class="px-6 pb-6 pt-7 sm:px-8 sm:pt-8">
          <div class="mb-7 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <Cloud class="h-4 w-4 shrink-0" />
            <span class="min-w-0 break-words">{props.environmentName}</span>
          </div>
          <div class="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/50" aria-hidden="true">
            {props.snapshot.state === 'succeeded' ? <Check class="h-6 w-6 text-success" />
              : props.snapshot.state === 'failed' ? <AlertCircle class="h-6 w-6 text-warning" />
                : offline() ? <WifiOffIcon class="h-6 w-6 text-muted-foreground" />
                  : <Refresh class="h-6 w-6 text-primary motion-safe:animate-[spin_3s_linear_infinite]" />}
          </div>
          <div role={props.snapshot.state === 'failed' ? undefined : 'status'} aria-live="polite" aria-atomic="true">
            <h1 ref={failedHeading} class="text-xl font-semibold leading-7 tracking-tight text-foreground outline-none"
              role={props.snapshot.state === 'failed' ? 'alert' : undefined} tabindex={props.snapshot.state === 'failed' ? -1 : undefined}>
              {title()}
            </h1>
            <p class="mt-2 text-[13px] leading-6 text-muted-foreground">{summary()}</p>
          </div>
          <Show when={props.snapshot.state === 'failed'}>
            <p class="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-foreground">{failureReason()}</p>
          </Show>
          <Show when={props.snapshot.state === 'recovering' && !offline()}>
            <div class="mt-5 flex items-center gap-2 text-xs text-muted-foreground" data-recovery-activity>
              <Loader2 class="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />
              <span>{retryRemainingSeconds() > 0
                ? i18n.t('connectionRecovery.retryIn', { seconds: retryRemainingSeconds() })
                : i18n.t(STEP_TRANSLATION_KEYS[presentation().active_step])}</span>
            </div>
          </Show>
          <Show when={canRetry() || props.snapshot.state === 'failed'}>
            <div class="mt-6 flex flex-wrap items-center gap-2">
              <Show when={canRetry()}>
                <Button class="cursor-pointer" size="sm" variant="outline" icon={Refresh} disabled={retrying()} onClick={() => void retry()}>
                  {i18n.t('connectionRecovery.retryNow')}
                </Button>
              </Show>
              <Show when={canOpenConnectionCenter()}>
                <Button class="cursor-pointer" size="sm" onClick={() => void openConnectionCenter()}>{i18n.t('connectionRecovery.openConnectionCenter')}</Button>
              </Show>
              <Show when={props.snapshot.state === 'failed' && !canOpenConnectionCenter()}>
                <Button class="cursor-pointer" size="sm" icon={Refresh} onClick={() => reloadCurrentPage(window)}>{i18n.t('accessGate.reloadPageAction')}</Button>
              </Show>
            </div>
          </Show>
        </div>
        <details class="border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <summary class="cursor-pointer select-none px-6 py-3.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-8">
            {i18n.t('connectionRecovery.technicalDetails')}
          </summary>
          <div class="px-6 pb-6 sm:px-8">
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
