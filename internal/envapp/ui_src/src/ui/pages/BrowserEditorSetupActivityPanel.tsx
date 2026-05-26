import { For, Show, createMemo, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, RefreshIcon, X } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { type BrowserEditorSetupActivity } from '../services/browserEditorSetupActivity';

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

function accentBarClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return 'bg-emerald-500';
    case 'preparing':
      return 'bg-blue-500';
    case 'failed':
    case 'error':
      return 'bg-red-500';
    case 'cancelled':
    case 'unusable':
      return 'bg-amber-500';
    default:
      return 'bg-border';
  }
}

function panelSurfaceClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/30';
    case 'preparing':
      return 'border-blue-500/30';
    case 'failed':
    case 'error':
      return 'border-red-500/30';
    case 'cancelled':
    case 'unusable':
      return 'border-amber-500/30';
    default:
      return 'border-border';
  }
}

function activityIconClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
    case 'preparing':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300';
    case 'failed':
    case 'error':
      return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300';
    case 'cancelled':
    case 'unusable':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300';
    default:
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

function activityIconGlow(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return '0 0 0 6px color-mix(in srgb, var(--success) 8%, transparent)';
    case 'preparing':
      return '0 0 0 6px color-mix(in srgb, var(--info) 8%, transparent)';
    case 'failed':
    case 'error':
      return '0 0 0 6px color-mix(in srgb, var(--error) 8%, transparent)';
    case 'cancelled':
    case 'unusable':
      return '0 0 0 6px color-mix(in srgb, var(--warning) 8%, transparent)';
    default:
      return 'none';
  }
}

function activityIcon(state: BrowserEditorSetupActivity['state']): JSX.Element {
  if (state === 'ready') return <Check class="h-4 w-4" />;
  if (state === 'failed' || state === 'error' || state === 'cancelled') return <X class="h-4 w-4" />;
  return <RefreshIcon class={cn('h-4 w-4', state === 'preparing' || state === 'checking' ? 'animate-spin' : '')} />;
}

function progressBarStyle(state: BrowserEditorSetupActivity['state'], percent: number): JSX.CSSProperties {
  const base: JSX.CSSProperties = { width: `${Math.max(8, percent)}%` };
  if (state === 'failed' || state === 'error') {
    return { ...base, background: 'var(--error)' };
  }
  if (state === 'cancelled') {
    return { ...base, background: 'var(--warning)' };
  }
  return base;
}

export function BrowserEditorSetupActivityPanel(props: BrowserEditorSetupActivityPanelProps) {
  const activity = () => props.activity;
  const canPrepare = createMemo(() => activity().state === 'missing' || activity().can_retry || activity().state === 'unusable');
  const showDetails = createMemo(() => Boolean(activity().detail || props.extraDetails || activity().show_log));
  const actionLabel = createMemo(() => (props.prepareSubmitting ? props.runningLabel : props.actionLabel));
  const isActive = createMemo(() => activity().state === 'preparing' || activity().state === 'checking');

  return (
    <div
      data-testid="browser-editor-setup-activity"
      class={cn(
        'relative overflow-hidden rounded-lg border bg-card p-5 transition-colors duration-300',
        panelSurfaceClass(activity().state),
      )}
      aria-live="polite"
    >
      <div class={cn('absolute left-0 top-0 h-full w-[3px]', accentBarClass(activity().state))} />

      {/* ── Header ── */}
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-4">
          <div
            class={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-shadow duration-300',
              activityIconClass(activity().state),
            )}
            style={{ 'box-shadow': activityIconGlow(activity().state) } as JSX.CSSProperties}
          >
            {activityIcon(activity().state)}
          </div>
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-semibold text-foreground">{activity().title}</h3>
              <Tag variant={activity().badge_variant} tone="soft" size="sm" class="cursor-default select-none">
                {activity().badge_label}
              </Tag>
            </div>
            <p class="text-sm leading-relaxed text-muted-foreground">{activity().summary}</p>
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

      {/* ── Steps + Progress ── */}
      <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)] lg:items-center">
        <div class="redeven-environment-progress">
          <div class="redeven-environment-progress__steps">
            <For each={activity().steps}>
              {(step, index) => (
                <div class="redeven-environment-progress__step">
                  <div class="redeven-environment-progress__step-connector">
                    <div class="redeven-environment-progress__step-dot" data-state={step.state} />
                    <Show when={index() < activity().steps.length - 1}>
                      <div
                        class="redeven-environment-progress__step-line"
                        data-state={step.state === 'done' ? 'done' : undefined}
                      />
                    </Show>
                  </div>
                  <div class="redeven-environment-progress__step-label" data-state={step.state}>
                    {step.label}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="min-w-0 space-y-2">
          <div
            class="redeven-environment-progress__meter"
            data-plan-state={isActive() ? 'planning' : undefined}
          >
            <span style={progressBarStyle(activity().state, activity().progress_percent)} />
          </div>
          <div class="redeven-environment-progress__meta">
            <span>Step {activity().active_step_index} of {activity().step_count}</span>
            <Show when={activity().pending_action_label}>
              {(label) => <span>{label()}</span>}
            </Show>
          </div>
        </div>
      </div>

      {/* ── Details ── */}
      <Show when={showDetails()}>
        <div class="mt-4 space-y-3 border-t border-border pt-4">
          <Show when={activity().detail}>
            {(detail) => (
              <div class="flex items-start gap-2.5 rounded-md border border-info/25 bg-info/[0.04] p-3 text-xs leading-5 text-muted-foreground">
                <div class="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-info/15 text-[10px] font-semibold text-info">
                  i
                </div>
                <div>{detail()}</div>
              </div>
            )}
          </Show>
          {props.extraDetails}
          <Show when={activity().show_log}>
            <pre
              data-testid="code-runtime-log-tail"
              class="max-h-48 overflow-auto rounded-lg border bg-[color-mix(in_srgb,var(--terminal-background)_6%,var(--background))] p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words"
            >
              {activity().log_tail.length > 0 ? activity().log_tail.join('\n') : 'No browser editor setup details yet.'}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}
