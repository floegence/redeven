import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  Check,
  AlertCircle,
  Copy,
  Loader2,
  Refresh,
} from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { openConnectionCenter } from '../services/desktopShellBridge';
import {
  createConnectionRecoveryPresentation,
  type ConnectionRecoveryStep,
  type ConnectionRecoveryStepID,
} from './createConnectionRecoveryPresentation';
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

function StepStatusIcon(props: Readonly<{ status: ConnectionRecoveryStep['status'] }>) {
  return (
    <span
      class={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
        props.status === 'complete'
          ? 'border-success/50 bg-success/10 text-success'
          : props.status === 'failed'
            ? 'border-error/50 bg-error/10 text-error'
            : props.status === 'active'
              ? 'border-primary/50 bg-primary/10 text-primary motion-safe:animate-pulse'
              : 'border-border bg-background text-muted-foreground/60'
      }`}
      aria-hidden="true"
    >
      {props.status === 'complete' ? (
        <Check class="h-3 w-3" />
      ) : props.status === 'failed' ? (
        <AlertCircle class="h-3 w-3" />
      ) : props.status === 'active' ? (
        <Loader2 class="h-3 w-3 motion-safe:animate-spin" />
      ) : (
        <span class="h-2 w-2 rounded-full border border-current" />
      )}
    </span>
  );
}

export function ConnectionRecoveryView(props: ConnectionRecoveryViewProps) {
  const i18n = useI18n();
  const presentation = createMemo(() => createConnectionRecoveryPresentation(props.snapshot));
  const [nowMs, setNowMs] = createSignal(Date.now());
  const [copied, setCopied] = createSignal(false);
  let failedHeading: HTMLHeadingElement | undefined;

  createEffect(() => {
    if (!presentation().steps.some((step) => step.next_retry_at_unix_ms)) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 250);
    onCleanup(() => window.clearInterval(interval));
  });

  createEffect(() => {
    if (props.snapshot.state !== 'failed') return;
    queueMicrotask(() => failedHeading?.focus());
  });

  const title = createMemo(() => {
    if (props.snapshot.state === 'succeeded') return i18n.t('connectionRecovery.title.recovered');
    if (props.snapshot.state === 'failed') return i18n.t('connectionRecovery.title.failed');
    return i18n.t('connectionRecovery.title.recovering');
  });
  const summary = createMemo(() => {
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
  const retryRemainingSeconds = (step: ConnectionRecoveryStep) => {
    if (!step.next_retry_at_unix_ms) return null;
    return Math.max(0, Math.ceil((step.next_retry_at_unix_ms - nowMs()) / 1_000));
  };
  const copyDiagnostic = async () => {
    await navigator.clipboard.writeText(presentation().diagnostic_text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const canRetry = createMemo(() => {
    if (props.snapshot.state !== 'recovering') return false;
    if (props.snapshot.phase === 'desktop_transport') {
      return props.snapshot.desktop_transport?.actions.includes('retry_now') ?? false;
    }
    return props.snapshot.phase === 'runtime_probe';
  });
  const canOpenConnectionCenter = createMemo(() => (
    props.snapshot.state === 'failed'
    && props.snapshot.desktop_transport?.actions.includes('open_connection_center')
  ));

  return (
    <section
      class="absolute inset-0 z-20 flex overflow-auto bg-background px-5 py-8 sm:px-8 sm:py-10"
      aria-live={props.snapshot.state === 'failed' ? undefined : 'polite'}
      aria-busy={props.snapshot.state === 'recovering'}
      data-testid="connection-recovery-view"
      data-recovery-state={props.snapshot.state}
    >
      <div class="m-auto w-full max-w-[640px]">
        <div class="mb-7">
          <h1
            ref={failedHeading}
            class="text-[18px] font-semibold leading-7 tracking-normal text-foreground outline-none"
            role={props.snapshot.state === 'failed' ? 'alert' : undefined}
            tabindex={props.snapshot.state === 'failed' ? -1 : undefined}
          >
            {title()}
          </h1>
          <p class="mt-1 text-[13px] leading-5 tracking-normal text-muted-foreground">{props.environmentName}</p>
          <p class="mt-3 max-w-[560px] text-[13px] leading-5 tracking-normal text-muted-foreground">{summary()}</p>
          <Show when={props.snapshot.state === 'failed'}>
            <p class="mt-2 max-w-[560px] text-[13px] leading-5 tracking-normal text-error">{failureReason()}</p>
          </Show>
        </div>

        <div class="mb-7" aria-label={i18n.t('connectionRecovery.progressLabel')}>
          <div class="mb-2 flex items-center justify-between gap-4 text-[11px] leading-4 tracking-normal text-muted-foreground">
            <span>{i18n.t('connectionRecovery.progress', {
              complete: presentation().completed_step_count,
              total: presentation().steps.length,
            })}</span>
            <span>{presentation().progress_percent}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-[3px] bg-muted" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={presentation().progress_percent}>
            <div
              class="h-full rounded-[3px] bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${presentation().progress_percent}%` }}
            />
          </div>
        </div>

        <ol class="relative space-y-0" aria-label={i18n.t('connectionRecovery.timelineLabel')}>
          <For each={presentation().steps}>{(step, index) => {
            const remainingSeconds = createMemo(() => retryRemainingSeconds(step));
            return (
              <li class="relative flex min-h-[54px] gap-3 pb-3 last:min-h-0 last:pb-0">
                <Show when={index() < presentation().steps.length - 1}>
                  <span class="absolute bottom-0 left-[9px] top-5 w-px bg-border" aria-hidden="true" />
                </Show>
                <StepStatusIcon status={step.status} />
                <div class="min-w-0 flex-1 pt-px">
                  <div class={`text-[13px] leading-5 tracking-normal ${
                    step.status === 'failed'
                      ? 'font-medium text-error'
                      : step.status === 'active'
                        ? 'font-medium text-foreground'
                        : step.status === 'complete'
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                  }`}>
                    {i18n.t(STEP_TRANSLATION_KEYS[step.id])}
                  </div>
                  <Show when={step.attempt_count > 0 || remainingSeconds() !== null}>
                    <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-4 tracking-normal text-muted-foreground">
                      <Show when={step.attempt_count > 0}>
                        <span>{i18n.tn('connectionRecovery.attempts', step.attempt_count)}</span>
                      </Show>
                      <Show when={remainingSeconds() !== null}>
                        <span>{i18n.t('connectionRecovery.retryIn', { seconds: remainingSeconds() ?? 0 })}</span>
                      </Show>
                    </div>
                  </Show>
                </div>
              </li>
            );
          }}</For>
        </ol>

        <div class="mt-7 flex flex-wrap items-center gap-2">
          <Show when={canRetry()}>
            <Button class="cursor-pointer" size="sm" icon={Refresh} onClick={() => void props.onRetry()}>
              {i18n.t('connectionRecovery.retryNow')}
            </Button>
          </Show>
          <Show when={canOpenConnectionCenter()}>
            <Button class="cursor-pointer" size="sm" onClick={() => void openConnectionCenter()}>
              {i18n.t('connectionRecovery.openConnectionCenter')}
            </Button>
          </Show>
        </div>

        <Show when={props.snapshot.state === 'failed'}>
          <details class="mt-7 border-t border-border pt-4 text-[11px] leading-4 tracking-normal text-muted-foreground">
            <summary class="cursor-pointer select-none font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              {i18n.t('connectionRecovery.technicalDetails')}
            </summary>
            <div class="mt-3 flex items-start gap-2">
              <pre class="min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-muted-foreground">{presentation().diagnostic_text}</pre>
              <Tooltip content={copied() ? i18n.t('connectionRecovery.copiedDiagnostic') : i18n.t('connectionRecovery.copyDiagnostic')} placement="top" delay={0}>
                <button
                  type="button"
                  class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-border bg-background text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={copied() ? i18n.t('connectionRecovery.copiedDiagnostic') : i18n.t('connectionRecovery.copyDiagnostic')}
                  onClick={() => void copyDiagnostic()}
                >
                  <Copy class="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          </details>
        </Show>
      </div>
    </section>
  );
}
