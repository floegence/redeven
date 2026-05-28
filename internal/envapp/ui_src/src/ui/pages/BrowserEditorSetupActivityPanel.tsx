import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, ChevronDown, ChevronRight, RefreshIcon, X } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { type BrowserEditorSetupActivity } from '../services/browserEditorSetupActivity';
import { useI18n } from '../i18n';

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

function activityIconClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'ready':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
    case 'preparing':
    case 'checking':
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
      return '0 0 0 4px color-mix(in srgb, var(--success) 8%, transparent)';
    case 'preparing':
    case 'checking':
      return '0 0 0 4px color-mix(in srgb, var(--info) 8%, transparent)';
    case 'failed':
    case 'error':
      return '0 0 0 4px color-mix(in srgb, var(--error) 8%, transparent)';
    case 'cancelled':
    case 'unusable':
      return '0 0 0 4px color-mix(in srgb, var(--warning) 8%, transparent)';
    default:
      return 'none';
  }
}

function activityIcon(state: BrowserEditorSetupActivity['state']): JSX.Element {
  if (state === 'ready') return <Check class="h-3.5 w-3.5" />;
  if (state === 'failed' || state === 'error' || state === 'cancelled') return <X class="h-3.5 w-3.5" />;
  return <RefreshIcon class={cn('h-3.5 w-3.5', state === 'preparing' || state === 'checking' ? 'animate-spin' : '')} />;
}

function detailCalloutClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'failed':
    case 'error':
      return 'border-l-2 border-l-red-500 bg-red-500/[0.04]';
    case 'cancelled':
    case 'unusable':
      return 'border-l-2 border-l-amber-500 bg-amber-500/[0.04]';
    default:
      return 'border-l-2 border-l-blue-500 bg-blue-500/[0.04]';
  }
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

function hasActionBar(activity: BrowserEditorSetupActivity, props: BrowserEditorSetupActivityPanelProps): boolean {
  return Boolean(
    (activity.can_continue && props.onContinue) ||
    ((activity.state === 'missing' || activity.can_retry || activity.state === 'unusable') && props.onPrepare) ||
    (activity.can_cancel && props.onCancel) ||
    (props.onDismiss && (activity.state === 'ready' || activity.state === 'failed' || activity.state === 'cancelled')),
  );
}

export function BrowserEditorSetupActivityPanel(props: BrowserEditorSetupActivityPanelProps) {
  const i18n = useI18n();
  const activity = () => props.activity;
  const canPrepare = createMemo(() => activity().state === 'missing' || activity().can_retry || activity().state === 'unusable');
  const hasTechnicalDetails = createMemo(() => Boolean(props.extraDetails || activity().show_log));
  const actionLabel = createMemo(() => (props.prepareSubmitting ? props.runningLabel : props.actionLabel));
  const isActive = createMemo(() => activity().state === 'preparing' || activity().state === 'checking');
  const showActionBar = createMemo(() => hasActionBar(activity(), props));
  const [detailsOpen, setDetailsOpen] = createSignal(false);

  return (
    <div
      data-testid="browser-editor-setup-activity"
      class="rounded-xl border border-border bg-card shadow-sm transition-colors duration-300"
      aria-live="polite"
    >
      {/* ── Header row ── */}
      <div class="flex items-center justify-between gap-4 p-4">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-shadow duration-300',
              activityIconClass(activity().state),
            )}
            style={{ 'box-shadow': activityIconGlow(activity().state) } as JSX.CSSProperties}
          >
            {activityIcon(activity().state)}
          </div>
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="text-sm font-semibold text-foreground">{activity().title}</h3>
            <Tag variant={activity().badge_variant} tone="soft" size="sm" class="cursor-default select-none">
              {activity().badge_label}
            </Tag>
          </div>
        </div>
        <Show when={props.onRefresh}>
          <Button size="icon" variant="ghost" onClick={() => props.onRefresh?.()} disabled={props.loading} aria-label={i18n.t('common.actions.refresh')}>
            <RefreshIcon class={cn('h-4 w-4', props.loading ? 'animate-spin' : '')} />
          </Button>
        </Show>
      </div>

      {/* ── Summary ── */}
      <div class="px-4 pb-1">
        <p class="text-sm leading-relaxed text-muted-foreground">{activity().summary}</p>
      </div>

      {/* ── Detail callout ── */}
      <Show when={activity().detail}>
        {(detail) => (
          <div class="px-4 pt-3">
            <div class={cn('rounded-md px-4 py-3 text-sm leading-relaxed', detailCalloutClass(activity().state))}>
              <p class="text-muted-foreground">{detail()}</p>
            </div>
          </div>
        )}
      </Show>

      {/* ── Progress ── */}
      <div class="space-y-3 px-4 pt-4">
        <div class="flex items-center justify-between gap-4">
          <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{i18n.t('codeRuntime.setupProgress')}</span>
          <span class="text-xs font-medium text-muted-foreground">
            {i18n.t('codeRuntime.stepProgress', {
              current: activity().active_step_index,
              total: activity().step_count,
            })}
          </span>
        </div>

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

        <div
          class="redeven-environment-progress__meter"
          data-plan-state={isActive() ? 'planning' : undefined}
        >
          <span style={progressBarStyle(activity().state, activity().progress_percent)} />
        </div>
      </div>

      {/* ── Technical details (collapsible) ── */}
      <Show when={hasTechnicalDetails()}>
        <div class="px-4">
          <button
            type="button"
            class="flex w-full items-center gap-1.5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <Show when={detailsOpen()} fallback={<ChevronRight class="h-3.5 w-3.5" />}>
              <ChevronDown class="h-3.5 w-3.5" />
            </Show>
            {i18n.t('codeRuntime.technicalDetails')}
          </button>

          <Show when={detailsOpen()}>
            <div class="space-y-3 pb-3">
              {props.extraDetails}
              <Show when={activity().show_log}>
                <pre
                  data-testid="code-runtime-log-tail"
                  class="max-h-48 overflow-auto rounded-lg border bg-[color-mix(in_srgb,var(--terminal-background)_6%,var(--background))] p-3 font-mono text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words"
                >
                  {activity().log_tail.length > 0 ? activity().log_tail.join('\n') : i18n.t('codeRuntime.noSetupDetails')}
                </pre>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* ── Action bar (fixed at bottom) ── */}
      <Show when={showActionBar()}>
        <div class="flex items-center justify-between gap-3 border-t border-border p-4">
          <div class="flex items-center gap-2">
            <Show when={activity().can_continue && props.onContinue}>
              <Button size="sm" variant="default" onClick={() => props.onContinue?.()}>
                {activity().pending_action_label || i18n.t('codeRuntime.continueAction')}
              </Button>
            </Show>
            <Show when={canPrepare() && props.onPrepare}>
              <Button size="sm" variant="default" onClick={() => props.onPrepare?.()} disabled={props.prepareSubmitting}>
                {actionLabel()}
              </Button>
            </Show>
            <Show when={activity().can_cancel && props.onCancel}>
              <Button size="sm" variant="outline" onClick={() => props.onCancel?.()} disabled={props.cancelSubmitting}>
                {props.cancelSubmitting ? i18n.t('codeRuntime.cancelling') : i18n.t('common.actions.cancel')}
              </Button>
            </Show>
          </div>
          <Show when={(activity().state === 'ready' || activity().state === 'failed' || activity().state === 'cancelled') && props.onDismiss}>
            <Button size="sm" variant="ghost" onClick={() => props.onDismiss?.()}>
              {i18n.t('codeRuntime.dismiss')}
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
