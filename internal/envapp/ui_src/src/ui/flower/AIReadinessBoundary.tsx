import { StableText } from '@floegence/floe-webapp-core/ui';
import { writeTextToClipboard } from '../utils/clipboard';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  type JSX,
} from 'solid-js';
import { AlertTriangle, Check, ChevronDown, Copy, Download, RefreshIcon, ShieldCheck } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import type { AIReadinessController } from './aiReadiness';
import { createAIReadinessPresentation, type AIReadinessAction } from './aiReadinessPresentation';
import { FlowerReadinessIllustration } from './FlowerReadinessIllustration';

const INTERACTIVE_CLASS = 'cursor-pointer disabled:cursor-not-allowed disabled:opacity-55';

export type AIReadinessBoundaryProps = Readonly<{
  controller: AIReadinessController;
  presentation?: 'full' | 'companion';
  onOpenUpdate: () => void;
  onOpenPermissions: () => void;
  onReviewIssues: () => void;
  canReviewIssues?: boolean;
  canRetryGeneration: boolean;
  focusEnabled: boolean;
  renderContent: () => JSX.Element;
}>;

export function AIReadinessBoundary(props: AIReadinessBoundaryProps) {
  const i18n = useI18n();
  const [busyVisible, setBusyVisible] = createSignal(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false);
  const [copyPending, setCopyPending] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);
  const [clockMs, setClockMs] = createSignal(Date.now());
  const elapsedMs = createMemo(() => {
    const startedAt = props.controller.busyStartedAt();
    return startedAt === null
      ? (props.controller.startupElapsedMs() ?? -1)
      : Math.max(0, clockMs() - startedAt);
  });
  const elapsedText = createMemo(() => {
    const seconds = Math.max(0, Math.floor(elapsedMs() / 1_000));
    return seconds < 60
      ? i18n.t('aiReadiness.diagnostics.elapsedSeconds', { seconds })
      : i18n.t('aiReadiness.diagnostics.elapsedMinutes', { minutes: Math.floor(seconds / 60) });
  });
  const showElapsed = createMemo(() => elapsedMs() >= 10_000);
  const longBusy = createMemo(() => elapsedMs() >= 30_000);
  const projection = createMemo(() => createAIReadinessPresentation(
    props.controller.snapshot(),
    i18n,
    { canRetryGeneration: props.canRetryGeneration, canManageStorage: props.canReviewIssues, elapsedMs: elapsedMs() },
  ));
  const operational = createMemo(() => {
    const state = props.controller.snapshot().state;
    return state === 'ready' || state === 'degraded';
  });
  const busy = createMemo(() => projection().mode === 'busy');
  const diagnosticContentID = `ai-readiness-diagnostic-${createUniqueId()}`;
  let boundaryRoot: HTMLDivElement | undefined;
  let surfaceRoot: HTMLDivElement | undefined;
  let maintenanceHeading: HTMLHeadingElement | undefined;
  let diagnosticsButton: HTMLButtonElement | undefined;
  let wasOperational = false;
  let maintenanceFocused = false;
  let restoreSurfaceFocus = false;

  const focusStillBelongsToBoundary = (): boolean => {
    const active = document.activeElement;
    return active === null || active === document.body || Boolean(active && boundaryRoot?.contains(active));
  };

  createEffect(() => {
    setBusyVisible(false);
    if (!busy()) return;
    const timer = window.setTimeout(() => setBusyVisible(true), 150);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    const startedAt = props.controller.busyStartedAt();
    if (startedAt === null || operational()) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const isOperational = operational();
    if (props.focusEnabled && !isOperational && (props.controller.snapshot().state === 'blocked' || busyVisible()) && !maintenanceFocused && focusStillBelongsToBoundary()) {
      queueMicrotask(() => {
        if (!props.focusEnabled || operational() || !focusStillBelongsToBoundary()) return;
        maintenanceFocused = true;
        maintenanceHeading?.focus({ preventScroll: true });
      });
    }
    if (isOperational && !wasOperational) {
      maintenanceFocused = false;
      setDiagnosticsOpen(false);
      if (props.focusEnabled && restoreSurfaceFocus && focusStillBelongsToBoundary()) {
        restoreSurfaceFocus = false;
        queueMicrotask(() => {
          if (!props.focusEnabled || !focusStillBelongsToBoundary()) return;
          surfaceRoot?.focus({ preventScroll: true });
        });
      } else {
        restoreSurfaceFocus = false;
      }
    }
    wasOperational = isOperational;
  });

  const maintenanceVisible = createMemo(() => {
    const state = props.controller.snapshot().state;
    return state !== 'ready' && (state === 'blocked' || busyVisible());
  });

  const toggleDiagnostics = (): void => {
    setDiagnosticsOpen((open) => !open);
    setCopied(false);
  };

  const runAction = async (action: AIReadinessAction): Promise<void> => {
    switch (action) {
      case 'retry':
        restoreSurfaceFocus = true;
        await props.controller.retry();
        return;
      case 'open_update':
        props.onOpenUpdate();
        return;
      case 'open_permissions':
        props.onOpenPermissions();
        return;
      case 'open_backups':
      case 'review_issues':
        if (props.canReviewIssues) props.onReviewIssues();
        return;
      case 'show_diagnostics':
        toggleDiagnostics();
        return;
    }
  };

  const actionLabel = (action: AIReadinessAction): string => {
    switch (action) {
      case 'retry':
        return props.controller.retryPending()
          ? i18n.t('aiReadiness.actions.retrying')
          : i18n.t('aiReadiness.actions.retry');
      case 'open_update':
        return i18n.t('aiReadiness.actions.openUpdate');
      case 'open_permissions':
        return i18n.t('aiReadiness.actions.openPermissions');
      case 'open_backups': return i18n.t('aiReadiness.storage.view');
      case 'review_issues':
        return i18n.t('aiReadiness.actions.reviewIssues');
      case 'show_diagnostics':
        return diagnosticsOpen()
          ? i18n.t('aiReadiness.actions.hideDiagnostics')
          : i18n.t('aiReadiness.actions.showDiagnostics');
    }
  };

  const copyLabel = () => copyPending()
    ? i18n.t('aiReadiness.actions.copyingDiagnostics')
    : copyFailed() ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
      : copied() ? i18n.t('aiReadiness.actions.diagnosticsCopied')
        : i18n.t('aiReadiness.actions.copyDiagnostics');

  const copyDiagnostics = async (): Promise<void> => {
    if (copyPending()) return;
    setCopyPending(true);
    setCopied(false);
    setCopyFailed(false);
    try {
      await writeTextToClipboard(projection().diagnosticText);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    } finally {
      setCopyPending(false);
    }
  };

  const ActionIcon = (iconProps: Readonly<{ action: AIReadinessAction }>) => {
    switch (iconProps.action) {
      case 'retry':
        return <RefreshIcon class={`h-4 w-4 ${props.controller.retryPending() ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />;
      case 'open_update':
        return <Download class="h-4 w-4" aria-hidden="true" />;
      case 'open_permissions':
        return <ShieldCheck class="h-4 w-4" aria-hidden="true" />;
      case 'open_backups':
      case 'review_issues':
        return <AlertTriangle class="h-4 w-4" aria-hidden="true" />;
      case 'show_diagnostics':
        return <ChevronDown class={`h-4 w-4 transition-transform motion-reduce:transition-none ${diagnosticsOpen() ? 'rotate-180' : ''}`} aria-hidden="true" />;
    }
  };

  const closeDiagnosticsOnEscape: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent> = (event) => {
    if (event.key !== 'Escape' || !diagnosticsOpen()) return;
    event.preventDefault();
    setDiagnosticsOpen(false);
    diagnosticsButton?.focus({ preventScroll: true });
  };

  const ActionButton = (actionProps: Readonly<{ action: AIReadinessAction; primary: boolean }>) => (
    <button
      ref={(element) => {
        if (actionProps.action === 'show_diagnostics') diagnosticsButton = element;
      }}
      type="button"
      class={`ai-readiness-action ${INTERACTIVE_CLASS} ${actionProps.primary ? 'ai-readiness-action--primary' : 'ai-readiness-action--secondary'}`}
      disabled={actionProps.action === 'retry' && props.controller.retryPending()}
      aria-busy={actionProps.action === 'retry' && props.controller.retryPending() ? 'true' : undefined}
      data-pending={actionProps.action === 'retry' && props.controller.retryPending() ? 'true' : undefined}
      aria-expanded={actionProps.action === 'show_diagnostics' ? diagnosticsOpen() : undefined}
      aria-controls={actionProps.action === 'show_diagnostics' ? diagnosticContentID : undefined}
      onClick={() => void runAction(actionProps.action)}
    >
      <ActionIcon action={actionProps.action} />
      <span>{actionLabel(actionProps.action)}</span>
    </button>
  );

  return (
    <div ref={boundaryRoot} class="ai-readiness-boundary h-full min-h-0" data-ai-readiness-state={props.controller.snapshot().state}>
      <Show when={operational()}>
        <div
          ref={surfaceRoot}
          class="h-full min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          tabindex={-1}
          data-ai-readiness-content
        >
          <Show when={props.controller.snapshot().state === 'degraded'}>
            <aside class="ai-readiness-degraded" role="status" aria-label={projection().title}>
              <AlertTriangle class="h-4 w-4 shrink-0" aria-hidden="true" />
              <span class="min-w-0 flex-1">{projection().description}</span>
              <Show when={props.canReviewIssues}>
                <button type="button" class={`ai-readiness-degraded__review ${INTERACTIVE_CLASS}`} onClick={props.onReviewIssues}>
                  {i18n.t('aiReadiness.actions.reviewIssues')}
                </button>
              </Show>
            </aside>
          </Show>
          {props.renderContent()}
        </div>
      </Show>

      <Show when={maintenanceVisible()}>
        <section
          class="ai-readiness-surface h-full min-h-0 overflow-auto"
          data-presentation={props.presentation ?? 'full'}
          data-mode={projection().mode}
          data-phase={props.controller.snapshot().state}
          onKeyDown={closeDiagnosticsOnEscape}
        >
          <div class="ai-readiness-surface__inner">
            <Show when={busy()} fallback={
              <div class={`ai-readiness-status-icon ai-readiness-status-icon--${projection().tone}`} aria-hidden="true">
                <AlertTriangle class="h-5 w-5" />
              </div>
            }>
              <FlowerReadinessIllustration />
            </Show>
            <Show when={!busy()}>
              <p class="ai-readiness-eyebrow">{i18n.t('aiReadiness.eyebrow')}</p>
            </Show>
            <h1
              ref={maintenanceHeading}
              class="ai-readiness-title"
              tabindex={-1}
              aria-live="polite"
            >
              {projection().title}
            </h1>
            <Show when={!busy()}>
              <p class="ai-readiness-description">{projection().description}</p>
            </Show>
            <Show when={busy()}>
              <div class="ai-readiness-progress">
                <div class="ai-readiness-progress__track" role="progressbar" aria-label={projection().title}>
                  <span />
                </div>
              </div>
            </Show>
            <Show when={!busy() && projection().dataStatement !== projection().description}>
              <div class="ai-readiness-data-statement">
                <ShieldCheck class="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{projection().dataStatement}</span>
              </div>
            </Show>
            <Show when={!busy() && showElapsed()}>
              <p class="ai-readiness-elapsed" data-ai-readiness-elapsed>
                {i18n.t('aiReadiness.slow.elapsed', { duration: elapsedText() })}
              </p>
            </Show>
            <Show when={longBusy() && busy()}>
              <p class="ai-readiness-workspace-hint" data-ai-readiness-long-task>{i18n.t('aiReadiness.workspaceAvailable')}</p>
            </Show>
            <Show when={busy()}>
              <div class="ai-readiness-details-entry">
                <Show when={showElapsed()}>
                  <span class="ai-readiness-elapsed" data-ai-readiness-elapsed>
                    {i18n.t('aiReadiness.slow.elapsed', { duration: elapsedText() })}
                  </span>
                </Show>
                <button
                  ref={diagnosticsButton}
                  type="button"
                  class="ai-readiness-details-toggle"
                  aria-expanded={diagnosticsOpen()}
                  aria-controls={diagnosticContentID}
                  onClick={toggleDiagnostics}
                >
                  {i18n.t('aiReadiness.diagnostics.title')}
                  <ChevronDown class={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${diagnosticsOpen() ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              </div>
            </Show>

            <Show when={projection().primaryAction || projection().secondaryAction}>
              <div class="ai-readiness-actions">
                <Show when={projection().primaryAction}>
                  {(action) => <ActionButton action={action()} primary />}
                </Show>
                <Show when={projection().secondaryAction}>
                  {(action) => <ActionButton action={action()} primary={false} />}
                </Show>
              </div>
            </Show>

            <Show when={diagnosticsOpen()}>
              <div class="ai-readiness-diagnostics">
                <div id={diagnosticContentID} class="ai-readiness-diagnostics__content">
                  <div>
                    <h2 class="text-sm font-semibold text-foreground">{i18n.t('aiReadiness.diagnostics.title')}</h2>
                    <Show when={!busy()}>
                      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.diagnostics.description')}</p>
                    </Show>
                  </div>
                  <Show when={busy()}>
                    <div class="ai-readiness-diagnostics__context">
                      <p>{projection().description}</p>
                      <Show when={projection().dataStatement !== projection().description}>
                        <p>{projection().dataStatement}</p>
                      </Show>
                      <Show when={!longBusy()}>
                        <p>{i18n.t('aiReadiness.workspaceAvailable')}</p>
                      </Show>
                      <Show when={longBusy()}>
                        <p>{i18n.t('aiReadiness.slow.longDescription')}</p>
                      </Show>
                    </div>
                  </Show>
                  <dl class="ai-readiness-diagnostics__rows">
                    <For each={projection().diagnosticRows}>{(row) => (
                      <div class="ai-readiness-diagnostics__row">
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    )}</For>
                  </dl>
                  <button
                    type="button"
                    class={`ai-readiness-copy ${INTERACTIVE_CLASS}`}
                    aria-label={copyLabel()}
                    title={copyLabel()}
                    disabled={copyPending()}
                    aria-busy={copyPending() ? 'true' : undefined}
                    data-pending={copyPending() ? 'true' : undefined}
                    onClick={() => void copyDiagnostics()}
                  >
                    <Show when={copied()} fallback={<Copy class="h-4 w-4" aria-hidden="true" />}>
                      <Check class="h-4 w-4" aria-hidden="true" />
                    </Show>
                    <span class="ai-readiness-copy-label"><StableText reserve={[i18n.t('aiReadiness.actions.copyingDiagnostics'), i18n.t('aiReadiness.actions.copyDiagnosticsFailed'), i18n.t('aiReadiness.actions.diagnosticsCopied'), i18n.t('aiReadiness.actions.copyDiagnostics')]}>{copyLabel()}</StableText></span>
                  </button>
                  <Show when={copied() || copyFailed()}>
                    <span class="sr-only" role="status">
                      {copyFailed()
                        ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
                        : i18n.t('aiReadiness.actions.diagnosticsCopied')}
                    </span>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </section>
      </Show>
    </div>
  );
}
