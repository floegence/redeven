import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Code, RefreshIcon, X } from '@floegence/floe-webapp-core/icons';
import { Button, Tag } from '@floegence/floe-webapp-core/ui';

import { type BrowserEditorSetupActivity } from '../services/browserEditorSetupActivity';
import { useI18n } from '../i18n';

export type BrowserEditorSetupActivityPanelProps = Readonly<{
  activity: BrowserEditorSetupActivity;
  layout?: 'wide' | 'compact';
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

function activityIconClass(activity: BrowserEditorSetupActivity): string {
  if (activity.platform_diagnosis) return 'browser-editor-setup__icon--warning';
  switch (activity.state) {
    case 'ready':
      return 'browser-editor-setup__icon--success';
    case 'preparing':
    case 'checking':
      return 'browser-editor-setup__icon--info';
    case 'failed':
    case 'error':
      return 'browser-editor-setup__icon--error';
    case 'cancelled':
    case 'unusable':
      return 'browser-editor-setup__icon--warning';
    default:
      return 'browser-editor-setup__icon--neutral';
  }
}

function activityIcon(activity: BrowserEditorSetupActivity): JSX.Element {
  if (activity.state === 'ready') return <Check class="h-4 w-4" />;
  if (activity.state === 'preparing' || activity.state === 'checking') return <RefreshIcon class="h-4 w-4 animate-spin" />;
  if (activity.platform_diagnosis || activity.state === 'failed' || activity.state === 'cancelled' || activity.state === 'unusable') {
    return <AlertTriangle class="h-4 w-4" />;
  }
  if (activity.state === 'error') return <X class="h-4 w-4" />;
  return <Code class="h-4 w-4" />;
}

function detailCalloutClass(state: BrowserEditorSetupActivity['state']): string {
  switch (state) {
    case 'failed':
    case 'error':
      return 'browser-editor-setup__callout--error';
    case 'cancelled':
    case 'unusable':
      return 'browser-editor-setup__callout--warning';
    default:
      return 'browser-editor-setup__callout--info';
  }
}

function canDismiss(activity: BrowserEditorSetupActivity): boolean {
  return activity.state === 'ready' || activity.state === 'failed' || activity.state === 'cancelled';
}

function hasActions(activity: BrowserEditorSetupActivity, props: BrowserEditorSetupActivityPanelProps): boolean {
  return Boolean(
    (activity.can_continue && props.onContinue)
    || ((activity.state === 'missing' || activity.can_retry) && props.onPrepare)
    || (activity.can_cancel && props.onCancel)
    || (canDismiss(activity) && props.onDismiss),
  );
}

export function BrowserEditorSetupActivityPanel(props: BrowserEditorSetupActivityPanelProps) {
  const i18n = useI18n();
  const activity = () => props.activity;
  const layout = () => props.layout ?? 'compact';
  const canPrepare = createMemo(() => activity().state === 'missing' || activity().can_retry);
  const hasTechnicalDetails = createMemo(() => Boolean(props.extraDetails || activity().show_log));
  const actionLabel = createMemo(() => (props.prepareSubmitting ? props.runningLabel : props.actionLabel));
  const showActions = createMemo(() => hasActions(activity(), props));
  const [detailsOpen, setDetailsOpen] = createSignal(false);

  return (
    <section
      data-testid="browser-editor-setup-activity"
      data-layout={layout()}
      data-presentation={activity().presentation}
      data-state={activity().state}
      class="browser-editor-setup"
      aria-live="polite"
    >
      <div class="browser-editor-setup__body">
        <div class="browser-editor-setup__primary">
          <div class="browser-editor-setup__header">
            <div class="flex min-w-0 items-center gap-3">
              <div class={cn('browser-editor-setup__icon', activityIconClass(activity()))}>
                {activityIcon(activity())}
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <h3 class="text-sm font-semibold text-foreground">{activity().title}</h3>
                <Tag variant={activity().badge_variant} tone="soft" size="sm" class="cursor-default select-none">
                  {activity().badge_label}
                </Tag>
              </div>
            </div>

            <Show when={props.onRefresh}>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => props.onRefresh?.()}
                disabled={props.loading}
                aria-label={i18n.t('common.actions.refresh')}
              >
                <RefreshIcon class={cn('h-4 w-4', props.loading ? 'animate-spin' : '')} />
              </Button>
            </Show>
          </div>

          <p class="browser-editor-setup__summary">{activity().summary}</p>

          <Show when={activity().detail}>
            {(detail) => (
              <div class={cn('browser-editor-setup__callout', detailCalloutClass(activity().state))}>
                {detail()}
              </div>
            )}
          </Show>

          <Show when={showActions()}>
            <div class="browser-editor-setup__actions">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
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
              <Show when={canDismiss(activity()) && props.onDismiss}>
                <Button size="sm" variant="ghost" onClick={() => props.onDismiss?.()}>
                  {i18n.t('codeRuntime.dismiss')}
                </Button>
              </Show>
            </div>
          </Show>
        </div>

        <div class="browser-editor-setup__secondary">
          <Show
            when={activity().platform_diagnosis}
            fallback={
              <div
                class="browser-editor-setup__progress"
                data-layout={layout()}
                role="progressbar"
                aria-label={i18n.t('codeRuntime.setupProgress')}
                aria-valuemin={1}
                aria-valuemax={activity().step_count}
                aria-valuenow={activity().active_step_index}
                aria-valuetext={i18n.t('codeRuntime.stepProgress', {
                  current: activity().active_step_index,
                  total: activity().step_count,
                })}
              >
                <div class="browser-editor-setup__secondary-heading">{i18n.t('codeRuntime.setupProgress')}</div>
                <div class="browser-editor-setup__steps" data-layout={layout()}>
                  <For each={activity().steps}>
                    {(step, index) => (
                      <div class="browser-editor-setup__step" data-state={step.state}>
                        <div class="browser-editor-setup__step-connector">
                          <div class="browser-editor-setup__step-dot" data-state={step.state} />
                          <Show when={index() < activity().steps.length - 1}>
                            <div
                              class="browser-editor-setup__step-line"
                              data-state={step.state === 'done' ? 'done' : undefined}
                            />
                          </Show>
                        </div>
                        <div class="browser-editor-setup__step-label" data-state={step.state}>
                          {step.label}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            }
          >
            {(diagnosis) => (
              <div class="browser-editor-setup__diagnosis">
                <div class="browser-editor-setup__secondary-heading">{i18n.t('runtimeStatus.compatibilityLabel')}</div>
                <dl class="browser-editor-setup__comparison">
                  <div class="browser-editor-setup__comparison-row" data-kind="detected">
                    <dt>{i18n.t('codeRuntime.activity.platform.detected')}</dt>
                    <dd>{diagnosis().detected_label || diagnosis().detected.platform_id || '-'}</dd>
                  </div>
                  <div class="browser-editor-setup__comparison-row" data-kind="required">
                    <dt>{i18n.t('codeRuntime.activity.platform.required')}</dt>
                    <dd>{diagnosis().required_label || '-'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </Show>
        </div>
      </div>

      <Show when={hasTechnicalDetails()}>
        <div class="browser-editor-setup__details">
          <button
            type="button"
            class="browser-editor-setup__details-trigger"
            aria-expanded={detailsOpen()}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            <Show when={detailsOpen()} fallback={<ChevronRight class="h-3.5 w-3.5" />}>
              <ChevronDown class="h-3.5 w-3.5" />
            </Show>
            {i18n.t('codeRuntime.technicalDetails')}
          </button>

          <Show when={detailsOpen()}>
            <div class="browser-editor-setup__details-content">
              {props.extraDetails}
              <Show when={activity().show_log}>
                <pre data-testid="code-runtime-log-tail" class="browser-editor-setup__log">
                  {activity().log_tail.length > 0 ? activity().log_tail.join('\n') : i18n.t('codeRuntime.noSetupDetails')}
                </pre>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
