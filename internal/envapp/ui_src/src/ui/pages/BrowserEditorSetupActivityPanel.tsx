import { For, Show, createMemo, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, RefreshIcon, X } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { type BrowserEditorSetupActivity, type BrowserEditorSetupStepState } from '../services/browserEditorSetupActivity';

export type BrowserEditorSetupActivityPanelProps = Readonly<{
  activity: BrowserEditorSetupActivity;
  loading?: boolean;
  prepareSubmitting?: boolean;
  cancelSubmitting?: boolean;
  actionLabel: string;
  runningLabel: string;
  onPrepare?: () => void;
  onRefresh?: () => void;
  onCancel?: () => void;
  onContinue?: () => void;
  onDismiss?: () => void;
  extraDetails?: JSX.Element;
}>;

function stepDotContent(state: BrowserEditorSetupStepState): JSX.Element | null {
  if (state === 'done') return <Check class="h-2.5 w-2.5" />;
  if (state === 'error' || state === 'cancelled') return <X class="h-2.5 w-2.5" />;
  return null;
}

function panelToneClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/40 bg-emerald-500/[0.05]';
    case 'preparing':
      return 'border-blue-500/40 bg-blue-500/[0.05]';
    case 'failed':
    case 'error':
      return 'border-red-500/40 bg-red-500/[0.05]';
    case 'cancelled':
    case 'unusable':
      return 'border-amber-500/40 bg-amber-500/[0.05]';
    default:
      return 'border-border bg-muted/20';
  }
}

function stepDotClass(state: BrowserEditorSetupStepState): string {
  switch (state) {
    case 'done':
      return 'border-emerald-500/50 bg-emerald-500 text-white shadow-[0_0_0_4px_rgba(16,185,129,0.10)]';
    case 'active':
      return 'border-primary/60 bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)] animate-pulse';
    case 'error':
      return 'border-red-500/50 bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.10)]';
    case 'cancelled':
      return 'border-amber-500/50 bg-amber-500 text-white shadow-[0_0_0_4px_rgba(245,158,11,0.10)]';
    case 'pending':
    default:
      return 'border-border bg-background';
  }
}

function stepLabelClass(state: BrowserEditorSetupStepState): string {
  switch (state) {
    case 'done':
      return 'text-foreground';
    case 'active':
      return 'font-semibold text-foreground';
    case 'error':
      return 'font-semibold text-red-600 dark:text-red-400';
    case 'cancelled':
      return 'font-semibold text-amber-600 dark:text-amber-400';
    case 'pending':
    default:
      return 'text-muted-foreground';
  }
}

function activityIconClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
    case 'preparing':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-300';
    case 'failed':
    case 'error':
      return 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300';
    case 'cancelled':
    case 'unusable':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300';
    default:
      return 'border-border bg-background text-muted-foreground';
  }
}

function activityIcon(state: BrowserEditorSetupActivity['state']): JSX.Element {
  if (state === 'ready') return <Check class="h-3.5 w-3.5" />;
  if (state === 'failed' || state === 'error' || state === 'cancelled') return <X class="h-3.5 w-3.5" />;
  return <RefreshIcon class={cn('h-3.5 w-3.5', state === 'preparing' || state === 'checking' ? 'animate-spin' : '')} />;
}

export function BrowserEditorSetupActivityPanel(props: BrowserEditorSetupActivityPanelProps) {
  const activity = () => props.activity;
  const canPrepare = createMemo(() => activity().state === 'missing' || activity().can_retry || activity().state === 'unusable');
  const showDetails = createMemo(() => Boolean(activity().detail || props.extraDetails || activity().show_log));
  const actionLabel = createMemo(() => (props.prepareSubmitting ? props.runningLabel : props.actionLabel));

  return (
    <div
      data-testid="browser-editor-setup-activity"
      class={cn('rounded-lg border p-4 transition-colors duration-300', panelToneClass(activity().state))}
      aria-live="polite"
    >
      <div class="flex min-w-0 flex-col gap-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <div class={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', activityIconClass(activity().state))}>
              {activityIcon(activity().state)}
            </div>
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-sm font-semibold text-foreground">{activity().title}</div>
                <Tag variant={activity().badge_variant} tone="soft" size="sm" class="cursor-default select-none">
                  {activity().badge_label}
                </Tag>
              </div>
              <div class="max-w-3xl text-sm text-muted-foreground">{activity().summary}</div>
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Show when={activity().can_continue && props.onContinue}>
              <Button size="sm" variant="default" onClick={() => props.onContinue?.()}>
                {activity().pending_action_label || 'Continue'}
              </Button>
            </Show>
            <Show when={canPrepare() && props.onPrepare}>
              <Button size="sm" variant="default" onClick={() => props.onPrepare?.()} disabled={props.prepareSubmitting}>
                {actionLabel()}
              </Button>
            </Show>
            <Show when={activity().can_cancel && props.onCancel}>
              <Button size="sm" variant="outline" onClick={() => props.onCancel?.()} disabled={props.cancelSubmitting}>
                {props.cancelSubmitting ? 'Cancelling...' : 'Cancel'}
              </Button>
            </Show>
            <Show when={props.onRefresh}>
              <Button size="sm" variant="ghost" onClick={() => props.onRefresh?.()} disabled={props.loading}>
                Refresh
              </Button>
            </Show>
            <Show when={(activity().state === 'ready' || activity().state === 'failed' || activity().state === 'cancelled') && props.onDismiss}>
              <Button size="sm" variant="ghost" onClick={() => props.onDismiss?.()}>
                Dismiss
              </Button>
            </Show>
          </div>
        </div>

        <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)] lg:items-end">
          <div class="grid min-w-0 gap-2">
            <For each={activity().steps}>
              {(step, index) => (
                <div class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <div class="flex flex-col items-center">
                    <span class={cn('mt-0.5 flex h-3 w-3 items-center justify-center rounded-full border text-[8px] transition-colors', stepDotClass(step.state))}>
                      {stepDotContent(step.state)}
                    </span>
                    <Show when={index() < activity().steps.length - 1}>
                      <span class={cn('mt-1 h-3 w-px rounded-full', step.state === 'done' ? 'bg-emerald-500/40' : 'bg-border')} />
                    </Show>
                  </div>
                  <div class={cn('min-w-0 text-xs leading-5 transition-colors', stepLabelClass(step.state))}>
                    {step.label}
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="min-w-0 space-y-2">
            <div class="h-1.5 overflow-hidden rounded-full bg-border/60">
              <div
                class={cn(
                  'h-full min-w-1 rounded-full transition-all duration-300',
                  activity().state === 'failed' ? 'bg-red-500'
                    : activity().state === 'cancelled' ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-primary to-emerald-500',
                )}
                style={{ width: `${Math.max(8, activity().progress_percent)}%` }}
              />
            </div>
            <div class="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
              <span>Step {activity().active_step_index} of {activity().step_count}</span>
              <Show when={activity().pending_action_label}>
                {(label) => <span>{label()}</span>}
              </Show>
            </div>
          </div>
        </div>

        <Show when={showDetails()}>
          <div class="space-y-3 border-t border-border pt-3">
            <Show when={activity().detail}>
              {(detail) => (
                <div class="rounded-md border border-border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                  {detail()}
                </div>
              )}
            </Show>
            {props.extraDetails}
            <Show when={activity().show_log}>
              <pre
                data-testid="code-runtime-log-tail"
                class="max-h-48 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words"
              >
                {activity().log_tail.length > 0 ? activity().log_tail.join('\n') : 'No browser editor setup details yet.'}
              </pre>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
