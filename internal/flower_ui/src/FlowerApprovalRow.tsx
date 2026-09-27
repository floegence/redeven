import { StatusRegion, Button } from '@floegence/floe-webapp-core/ui';
import { For, Show, createEffect, createSignal, createUniqueId, on, onCleanup, onMount, type JSX } from 'solid-js';
import { AlertCircle, Copy, Globe, Pencil, Shield, Terminal } from '@floegence/floe-webapp-core/icons';
import type { FlowerApprovalAction } from './contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from './copy';
import type { FlowerApprovalPresentation } from './flowerApprovalPresentation';
import { FlowerShellCommandHighlight } from './shellCommandHighlight';

export function FlowerApprovalDecisionActions(props: Readonly<{
  label: string;
  rejectLabel: string;
  approveLabel: string;
  rejectAriaLabel: string;
  approveAriaLabel: string;
  describedBy?: string;
  disabled: boolean;
  submitting?: boolean;
  onReject: () => void;
  onApprove: () => void;
}>) {
  return <div class="flower-approval-decision-group" role="group" aria-label={props.label} data-flower-approval-decision-group="true">
    <Button variant="outline" size="sm" class="flower-composer-approval-decision flower-approval-decision-reject rounded-full"
      disabled={props.disabled} aria-label={props.rejectAriaLabel} aria-describedby={props.describedBy || undefined} onClick={props.onReject}>
      <span class="min-w-0 truncate" title={props.rejectLabel}>{props.rejectLabel}</span>
    </Button>
    <Button variant="primary" size="sm" class="flower-composer-approval-decision flower-approval-decision-approve rounded-full"
      disabled={props.disabled} loading={props.submitting} aria-label={props.approveAriaLabel} aria-describedby={props.describedBy || undefined} onClick={props.onApprove}>
      <span class="min-w-0 truncate" title={props.approveLabel}>{props.approveLabel}</span>
    </Button>
  </div>;
}

/** One mounted row owns only its disclosure state; runtime current views own decisions. */
export function FlowerApprovalRow(props: Readonly<{
  action: FlowerApprovalAction;
  presentation: FlowerApprovalPresentation;
  copy: FlowerSurfaceCopy['chat'];
  disabled: boolean;
  submitting: boolean;
  status: string;
  error: string;
  copied: boolean;
  subtaskLabel: string;
  readingProps?: JSX.HTMLAttributes<HTMLDivElement>;
  scrollViewportProps?: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & { style?: JSX.CSSProperties };
  onCopy: () => void;
  onDecide: (approved: boolean) => void;
}>) {
  const id = createUniqueId();
  const [expanded, setExpanded] = createSignal(false);
  const [truncated, setTruncated] = createSignal(false);
  let commandRef: HTMLPreElement | undefined;
  let measureFrame = 0;
  const measure = () => {
    if (!commandRef?.clientWidth) return;
    const style = getComputedStyle(commandRef);
    const fullHeight = commandRef.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    setTruncated(fullHeight > parseFloat(style.lineHeight) * 2 + 1);
  };
  const scheduleMeasure = () => {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(measure);
  };
  onMount(() => {
    const observer = new ResizeObserver(scheduleMeasure);
    if (commandRef) observer.observe(commandRef);
    let active = true;
    void document.fonts?.ready.then(() => { if (active) scheduleMeasure(); });
    onCleanup(() => { active = false; observer.disconnect(); cancelAnimationFrame(measureFrame); });
  });
  createEffect(on([() => props.presentation.command, expanded], scheduleMeasure));
  const icon = () => {
    switch (props.presentation.operationKind) {
      case 'terminal': return <Terminal class="h-4 w-4" />;
      case 'file': return <Pencil class="h-4 w-4" />;
      case 'network': return <Globe class="h-4 w-4" />;
      default: return <Shield class="h-4 w-4" />;
    }
  };
  return <section class="flower-approval-queue-row" tabIndex={-1} aria-labelledby={`${id}-title`}
    data-flower-composer-approval="true" data-flower-approval-action-id={props.action.action_id}
    data-flower-approval-origin={props.action.origin} data-flower-approval-surface-role={props.action.surface_role || 'primary_action'}
    data-flower-approval-submitting={props.submitting ? 'true' : undefined} aria-busy={props.submitting}>
    <div class="flower-approval-operation" data-flower-approval-operation-kind={props.presentation.operationKind} {...props.readingProps}>
      <span class="flower-approval-operation-icon" aria-hidden="true">{icon()}</span>
      <strong id={`${id}-title`} class="flower-approval-operation-label">{props.presentation.operationLabel}</strong>
    </div>
    <div class="flower-approval-actions" data-flower-approval-actions-row="true">
      <FlowerApprovalDecisionActions label={props.presentation.operationLabel} rejectLabel={props.copy.toolApprovalReject}
        approveLabel={props.copy.toolApprovalApprove} rejectAriaLabel={props.copy.toolApprovalRejectAction(props.presentation.operationLabel, props.subtaskLabel)}
        approveAriaLabel={props.copy.toolApprovalApproveAction(props.presentation.operationLabel, props.subtaskLabel)}
        disabled={props.disabled} submitting={props.submitting} describedBy={props.status || props.error ? `${id}-status` : undefined}
        onReject={() => props.onDecide(false)} onApprove={() => props.onDecide(true)} />
    </div>
    <div class="flower-approval-body" {...props.readingProps}>
      <Show when={props.presentation.targets.length}>
        <div class="flower-approval-targets"><For each={props.presentation.targets}>{target => <span class="flower-approval-target">{target}</span>}</For></div>
      </Show>
      <Show when={props.presentation.command}>{command => <div class="flower-approval-command" data-expanded={expanded()}>
        <pre id={`${id}-command`} ref={commandRef} class="flower-approval-command-text"><FlowerShellCommandHighlight command={command()} /></pre>
        <div class="flower-approval-command-tools">
          <Show when={expanded() || truncated()}>
            <button type="button" class="flower-approval-command-toggle" aria-expanded={expanded()} aria-controls={`${id}-command`}
              onClick={() => setExpanded(value => !value)}>{expanded() ? props.copy.toolApprovalHideCommand : props.copy.toolApprovalExpandCommand}</button>
          </Show>
          <button type="button" class="flower-approval-copy-btn" data-copied={props.copied}
            aria-label={`${props.copy.toolApprovalCopyCommand}: ${props.presentation.operationLabel}`}
            title={props.copied ? props.copy.toolApprovalCopied : props.copy.toolApprovalCopyCommand} onClick={props.onCopy}>
            <Copy class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span class="flower-visually-hidden" role="status">{props.copied ? props.copy.toolApprovalCopied : ''}</span>
        </div>
      </div>}</Show>
      <Show when={props.presentation.risk}>{risk => <p class="flower-approval-risk"><AlertCircle class="h-3.5 w-3.5" aria-hidden="true" /><span>{risk()}</span></p>}</Show>
      <Show when={props.presentation.description || props.presentation.details.length}>
        <details class="flower-approval-details"><summary>{props.copy.toolApprovalDetails}</summary>
          <Show when={props.presentation.description}>{description => <p class="flower-approval-operation-description">{description()}</p>}</Show>
          <For each={props.presentation.details}>{detail => <div class="flower-approval-target">{detail}</div>}</For>
        </details>
      </Show>
      <StatusRegion {...props.scrollViewportProps} lines={1} class="text-xs"><Show when={props.status || props.error}>
        <p id={`${id}-status`} class="flower-approval-status" role={props.error ? 'alert' : 'status'}>{props.error || props.status}</p>
      </Show></StatusRegion>
      <span class="flower-visually-hidden" role="status">{props.submitting ? props.copy.toolApprovalSubmitting : ''}</span>
    </div>
  </section>;
}
