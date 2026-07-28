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
import { AlertTriangle, Check, ChevronDown, Copy, Download, Loader2, RefreshIcon, ShieldCheck } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import type { AIReadinessController } from './aiReadiness';
import { createAIReadinessPresentation, type AIReadinessAction } from './aiReadinessPresentation';

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
  children: JSX.Element;
}>;

export function AIReadinessBoundary(props: AIReadinessBoundaryProps) {
  const i18n = useI18n();
  const projection = createMemo(() => createAIReadinessPresentation(
    props.controller.snapshot(),
    i18n,
    { canRetryGeneration: props.canRetryGeneration },
  ));
  const [busyVisible, setBusyVisible] = createSignal(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = createSignal(false);
  const [copyPending, setCopyPending] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);
  const [clockMs, setClockMs] = createSignal(Date.now());
  const diagnosticContentID = `ai-readiness-diagnostic-${createUniqueId()}`;
  let boundaryRoot: HTMLDivElement | undefined;
  let surfaceRoot: HTMLDivElement | undefined;
  let maintenanceHeading: HTMLHeadingElement | undefined;
  let diagnosticsButton: HTMLButtonElement | undefined;
  let previousSurfaceFocus: HTMLElement | null = null;
  let wasReady = false;
  let maintenanceFocused = false;
  let restoreSurfaceFocus = false;

  const focusStillBelongsToBoundary = (): boolean => {
    const active = document.activeElement;
    return active === null || active === document.body || Boolean(active && boundaryRoot?.contains(active));
  };

  createEffect(() => {
    const state = props.controller.snapshot().state;
    setBusyVisible(false);
    if (state === 'ready' || state === 'degraded' || state === 'blocked') return;
    const timer = window.setTimeout(() => setBusyVisible(true), 150);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(() => {
    const nextCheckAt = props.controller.nextCheckAt();
    if (nextCheckAt === null) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    onCleanup(() => window.clearInterval(timer));
  });

  const nextCheckSeconds = createMemo(() => {
    const nextCheckAt = props.controller.nextCheckAt();
    return nextCheckAt === null ? 0 : Math.max(0, Math.ceil((nextCheckAt - clockMs()) / 1_000));
  });

  createEffect(() => {
    const ready = props.controller.snapshot().state === 'ready' || props.controller.snapshot().state === 'degraded';
    if (props.focusEnabled && !ready && wasReady && surfaceRoot?.contains(document.activeElement)) {
      previousSurfaceFocus = document.activeElement as HTMLElement;
      restoreSurfaceFocus = true;
    }
    if (props.focusEnabled && !ready && (props.controller.snapshot().state === 'blocked' || busyVisible()) && !maintenanceFocused && focusStillBelongsToBoundary()) {
      queueMicrotask(() => {
        if (!props.focusEnabled || props.controller.snapshot().state === 'ready' || props.controller.snapshot().state === 'degraded' || !focusStillBelongsToBoundary()) return;
        maintenanceFocused = true;
        maintenanceHeading?.focus({ preventScroll: true });
      });
    }
    if (ready && !wasReady) {
      maintenanceFocused = false;
      setDiagnosticsOpen(false);
      if (props.focusEnabled && restoreSurfaceFocus && focusStillBelongsToBoundary()) {
        restoreSurfaceFocus = false;
        queueMicrotask(() => {
          if (!props.focusEnabled || !focusStillBelongsToBoundary()) return;
          const target = previousSurfaceFocus;
          if (target?.isConnected && !target.hasAttribute('disabled')) target.focus({ preventScroll: true });
          else surfaceRoot?.focus({ preventScroll: true });
        });
      } else {
        restoreSurfaceFocus = false;
      }
    }
    wasReady = ready;
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
      case 'review_issues':
        return i18n.t('aiReadiness.actions.reviewIssues');
      case 'show_diagnostics':
        return diagnosticsOpen()
          ? i18n.t('aiReadiness.actions.hideDiagnostics')
          : i18n.t('aiReadiness.actions.showDiagnostics');
    }
  };

  const copyDiagnostics = async (): Promise<void> => {
    if (copyPending()) return;
    setCopyPending(true);
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(projection().diagnosticText);
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
      <div
        ref={surfaceRoot}
        class="h-full min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        tabindex={-1}
        hidden={props.controller.snapshot().state !== 'ready' && props.controller.snapshot().state !== 'degraded'}
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
        {props.children}
      </div>

      <Show when={maintenanceVisible()}>
        <section
          class="ai-readiness-surface h-full min-h-0 overflow-auto"
          data-presentation={props.presentation ?? 'full'}
          aria-busy={projection().mode === 'busy' || props.controller.retryPending() ? 'true' : undefined}
          onKeyDown={closeDiagnosticsOnEscape}
        >
          <div class="ai-readiness-surface__inner">
            <div class={`ai-readiness-status-icon ai-readiness-status-icon--${projection().tone}`} aria-hidden="true">
              <Show when={projection().mode === 'busy'} fallback={<AlertTriangle class="h-5 w-5" />}>
                <Loader2 class="h-5 w-5 animate-spin motion-reduce:animate-none" />
              </Show>
            </div>
            <p class="ai-readiness-eyebrow">{i18n.t('aiReadiness.eyebrow')}</p>
            <h1
              ref={maintenanceHeading}
              class="ai-readiness-title outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabindex={-1}
              aria-live="polite"
            >
              {projection().title}
            </h1>
            <p class="ai-readiness-description">{projection().description}</p>
            <div class="ai-readiness-data-statement">
              <ShieldCheck class="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{projection().dataStatement}</span>
            </div>
            <Show when={nextCheckSeconds() > 0}>
              <p class="ai-readiness-next-check" data-ai-readiness-next-check>
                {i18n.t('aiReadiness.actions.nextCheck', { seconds: nextCheckSeconds() })}
              </p>
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
                    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{i18n.t('aiReadiness.diagnostics.description')}</p>
                  </div>
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
                    disabled={copyPending()}
                    aria-busy={copyPending() ? 'true' : undefined}
                    data-pending={copyPending() ? 'true' : undefined}
                    onClick={() => void copyDiagnostics()}
                  >
                    <Show when={copied()} fallback={<Copy class="h-4 w-4" aria-hidden="true" />}>
                      <Check class="h-4 w-4" aria-hidden="true" />
                    </Show>
                    <span>{copyPending()
                      ? i18n.t('aiReadiness.actions.copyingDiagnostics')
                      : copyFailed()
                        ? i18n.t('aiReadiness.actions.copyDiagnosticsFailed')
                      : copied()
                        ? i18n.t('aiReadiness.actions.diagnosticsCopied')
                        : i18n.t('aiReadiness.actions.copyDiagnostics')}</span>
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
