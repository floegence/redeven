import type {
  PluginConfirmationDecision,
  PluginConfirmationHandler,
  PluginConfirmationIntent,
} from '@floegence/redevplugin-ui';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { AlertTriangle, Shield } from '@floegence/floe-webapp-core/icons';
import { Show, createEffect, createSignal, onCleanup, type Accessor, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';

const CONFIRMATION_ENTRY_REARM_DELAY_MS = 750;

export type PluginConfirmationOwner = Readonly<{
  pluginID: string;
  displayName?: string;
  pluginInstanceID: string;
  surfaceID: string;
  canConfirm: () => boolean;
}>;

type ConfirmationQueueEntry = {
  id: number;
  owner: PluginConfirmationOwner;
  intent: PluginConfirmationIntent;
  resolve: (decision: PluginConfirmationDecision) => void;
  removeAbortListener: () => void;
  settled: boolean;
};

export type PluginConfirmationQueue = Readonly<{
  active: Accessor<ConfirmationQueueEntry | undefined>;
  pendingCount?: Accessor<number>;
  createHandler: (owner: PluginConfirmationOwner) => PluginConfirmationHandler;
  approveActive: (expectedEntryID: number) => void;
  rejectActive: (expectedEntryID: number) => void;
  cancelOwner: (owner: object) => void;
  cancelAll: () => void;
}>;

export function createPluginConfirmationQueue(): PluginConfirmationQueue {
  const [entries, setEntries] = createSignal<readonly ConfirmationQueueEntry[]>([]);
  let nextID = 0;

  const resolveEntry = (entry: ConfirmationQueueEntry, confirmed: boolean) => {
    if (entry.settled) return;
    entry.settled = true;
    entry.removeAbortListener();
    entry.resolve({ confirmed });
  };

  const settleActive = (expectedEntryID: number, confirmed: boolean) => {
    let settled: ConfirmationQueueEntry | undefined;
    setEntries((current) => {
      if (current[0]?.id !== expectedEntryID) return current;
      [settled] = current;
      return current.slice(1);
    });
    if (settled) resolveEntry(settled, confirmed && settled.owner.canConfirm());
  };

  const cancelMatching = (matches: (entry: ConfirmationQueueEntry) => boolean) => {
    const cancelled: ConfirmationQueueEntry[] = [];
    setEntries((current) => current.filter((entry) => {
      if (!matches(entry)) return true;
      cancelled.push(entry);
      return false;
    }));
    for (const entry of cancelled) resolveEntry(entry, false);
  };

  return Object.freeze({
    active: () => entries()[0],
    pendingCount: () => entries().length,
    createHandler(owner) {
      return (intent) => {
        if (intent.signal.aborted || !owner.canConfirm()) return { confirmed: false };
        return new Promise<PluginConfirmationDecision>((resolve) => {
          const abort = () => {
            let aborted: ConfirmationQueueEntry | undefined;
            setEntries((current) => current.filter((entry) => {
              if (entry.id !== nextEntry.id) return true;
              aborted = entry;
              return false;
            }));
            if (aborted) resolveEntry(aborted, false);
          };
          const nextEntry: ConfirmationQueueEntry = {
            id: ++nextID,
            owner,
            intent: cloneConfirmationIntent(intent),
            resolve,
            removeAbortListener: () => intent.signal.removeEventListener('abort', abort),
            settled: false,
          };
          intent.signal.addEventListener('abort', abort, { once: true });
          setEntries((current) => [...current, nextEntry]);
        });
      };
    },
    approveActive: (expectedEntryID) => settleActive(expectedEntryID, true),
    rejectActive: (expectedEntryID) => settleActive(expectedEntryID, false),
    cancelOwner: (owner) => cancelMatching((entry) => entry.owner === owner),
    cancelAll: () => cancelMatching(() => true),
  });
}

export function PluginConfirmationDialog(props: {
  queue: PluginConfirmationQueue;
}): JSX.Element {
  const [blockedApprovalEntryID, setBlockedApprovalEntryID] = createSignal<number>();
  let previousVisibleEntryID: number | undefined;

  createEffect(() => {
    const activeEntryID = props.queue.active()?.id;
    if (activeEntryID === undefined) {
      setBlockedApprovalEntryID(undefined);
      if (previousVisibleEntryID === undefined) return;

      const timer = window.setTimeout(() => {
        if (props.queue.active() === undefined) previousVisibleEntryID = undefined;
      }, CONFIRMATION_ENTRY_REARM_DELAY_MS);
      onCleanup(() => window.clearTimeout(timer));
      return;
    }
    if (activeEntryID === previousVisibleEntryID) return;

    const replacesVisibleEntry = previousVisibleEntryID !== undefined;
    previousVisibleEntryID = activeEntryID;
    setBlockedApprovalEntryID(replacesVisibleEntry ? activeEntryID : undefined);
    if (!replacesVisibleEntry) return;

    // IMPORTANT: replacement approval stays inert so repeated input cannot confirm an unseen entry.
    const timer = window.setTimeout(() => {
      if (props.queue.active()?.id === activeEntryID) setBlockedApprovalEntryID(undefined);
    }, CONFIRMATION_ENTRY_REARM_DELAY_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <Show keyed when={props.queue.active()}>
      {(entry) => (
        <PluginConfirmationDialogEntry
          queue={props.queue}
          entry={entry}
          approvalArmed={() => blockedApprovalEntryID() !== entry.id}
        />
      )}
    </Show>
  );
}

function PluginConfirmationDialogEntry(props: {
  queue: PluginConfirmationQueue;
  entry: ConfirmationQueueEntry;
  approvalArmed: Accessor<boolean>;
}): JSX.Element {
  const i18n = useI18n();
  const [deciding, setDeciding] = createSignal(false);
  let cancelButton: HTMLButtonElement | undefined;
  const presentation = projectConfirmationPlan(props.entry.intent.plan);
  const title = presentation.summary[0] || i18n.t('uiCopy.pluginRuntime.approveAction');
  const pluginName = props.entry.owner.displayName?.trim() || props.entry.owner.pluginID;
  const pendingCount = () => props.queue.pendingCount?.() ?? 1;

  createEffect(() => {
    if (deciding()) return;
    queueMicrotask(() => {
      if (props.queue.active()?.id === props.entry.id && !deciding()) cancelButton?.focus();
    });
  });

  const settle = (confirmed: boolean) => {
    if (deciding() || (confirmed && !props.approvalArmed())) return;
    setDeciding(true);
    if (confirmed) props.queue.approveActive(props.entry.id);
    else props.queue.rejectActive(props.entry.id);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={title}
      class="w-[min(36rem,calc(100%-1rem))] max-w-[36rem] bg-background"
      footer={(
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButton}
            type="button"
            class={`${PLUGIN_MOBILE_TOUCH_TARGET_CLASS} cursor-pointer rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none`}
            data-floe-autofocus
            data-plugin-confirmation-reject
            disabled={deciding()}
            onClick={() => settle(false)}
          >
            {i18n.t('common.actions.cancel')}
          </button>
          <button
            type="button"
            class={`${PLUGIN_MOBILE_TOUCH_TARGET_CLASS} cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${presentation.highRisk
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
            data-plugin-confirmation-approve
            disabled={deciding() || !props.approvalArmed()}
            onClick={() => settle(true)}
          >
            {presentation.action || i18n.t('common.actions.confirm')}
          </button>
        </div>
      )}
    >
      <div class="redeven-plugin-enter-up space-y-4 text-sm animate-in fade-in duration-200 motion-reduce:animate-none" data-plugin-confirmation-dialog>
        <div class="flex min-w-0 items-start gap-3 rounded-md border bg-muted/20 p-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
            <Shield class="h-4 w-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceTitle')}</p>
            <p class="mt-1 truncate font-semibold text-foreground" data-plugin-confirmation-owner title={pluginName}>{pluginName}</p>
          </div>
          <Show when={pendingCount() > 1}>
            <span
              class="shrink-0 rounded border bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground"
              data-plugin-confirmation-position
              aria-label={`${i18n.t('uiCopy.pluginRuntime.approveAction')} 1 / ${pendingCount()}`}
            >
              1 / {pendingCount()}
            </span>
          </Show>
        </div>

        <Show when={presentation.summary.length > 1}>
          <ul class="space-y-1.5 border-l-2 border-primary/30 pl-3 text-foreground" data-plugin-confirmation-summary>
            {presentation.summary.slice(1).map((line) => <li class="break-words">{line}</li>)}
          </ul>
        </Show>

        <Show when={presentation.summary.length === 0}>
          <p class="break-words font-medium text-foreground" data-plugin-confirmation-method-fallback>
            {i18n.t('uiCopy.pluginRuntime.method', { value: props.entry.intent.method })}
          </p>
        </Show>

        <Show when={presentation.target}>
          <div class="rounded-md border px-3 py-2.5" data-plugin-confirmation-target>
            <p class="break-words font-medium text-foreground">{i18n.t('uiCopy.pluginRuntime.target', { value: presentation.target })}</p>
            <Show when={presentation.targetIdentity}>
              <p class="mt-1 break-all font-mono text-xs text-muted-foreground" data-plugin-confirmation-target-identity>
                {presentation.targetIdentity}
              </p>
            </Show>
          </div>
        </Show>

        <Show when={presentation.riskLevel || presentation.destructive || presentation.dataLoss || presentation.dataLossRisk || presentation.adminRequired || presentation.privileged}>
          <div class="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-plugin-confirmation-risk-status>
            <AlertTriangle class="h-4 w-4 shrink-0 text-destructive" />
            <Show when={presentation.riskLevel}>
              <span class="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-semibold uppercase text-destructive" data-plugin-confirmation-risk-level>
                {presentation.riskLevel}
              </span>
            </Show>
            <Show when={presentation.adminRequired}>
              <span class="rounded border border-destructive/30 px-2 py-1 text-xs font-medium text-destructive" data-plugin-confirmation-admin-required>
                {i18n.t('shell.status.adminRequired')}
              </span>
            </Show>
            <Show when={presentation.destructive}>
              <span class="rounded border border-destructive/30 px-2 py-1 font-mono text-xs font-medium text-destructive" data-plugin-confirmation-destructive>
                destructive
              </span>
            </Show>
            <Show when={presentation.dataLoss}>
              <span class="rounded border border-destructive/30 px-2 py-1 font-mono text-xs font-medium text-destructive" data-plugin-confirmation-data-loss>
                data_loss
              </span>
            </Show>
            <Show when={presentation.dataLossRisk}>
              <span class="rounded border border-destructive/30 px-2 py-1 font-mono text-xs font-medium text-destructive" data-plugin-confirmation-data-loss-risk>
                data_loss_risk
              </span>
            </Show>
            <Show when={presentation.privileged}>
              <span class="rounded border border-destructive/30 px-2 py-1 font-mono text-xs font-medium text-destructive" data-plugin-confirmation-privileged>
                runtime.privileged
              </span>
            </Show>
          </div>
        </Show>

        <Show when={presentation.riskFlags.length > 0}>
          <ul class="space-y-2 rounded-md border border-destructive/30 px-3 py-2.5" data-plugin-confirmation-impact>
            {presentation.riskFlags.map((flag) => (
              <li>
                <p class="font-medium text-foreground">{flag.title}</p>
                <Show when={flag.detail}><p class="mt-0.5 text-xs leading-5 text-muted-foreground">{flag.detail}</p></Show>
              </li>
            ))}
          </ul>
        </Show>

        <details class="group border-t pt-3" data-plugin-confirmation-technical-details>
          <summary class="cursor-pointer select-none font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {i18n.t('uiCopy.plugin.technicalDetails')}
          </summary>
          <dl class="mt-3 grid gap-2 text-xs text-muted-foreground">
            <TechnicalDetail label="plugin_id" value={props.entry.owner.pluginID} />
            <TechnicalDetail label="plugin_instance_id" value={props.entry.owner.pluginInstanceID} />
            <TechnicalDetail label="surface_id" value={props.entry.owner.surfaceID} />
            <TechnicalDetail label="request_id" value={props.entry.intent.requestId} />
            <TechnicalDetail label="confirmation_token_id" value={props.entry.intent.confirmationTokenId} />
            <TechnicalDetail label="method" value={props.entry.intent.method} />
            <TechnicalDetail label="request_hash" value={props.entry.intent.requestHash} />
            <TechnicalDetail label="plan_hash" value={props.entry.intent.planHash} />
          </dl>
        </details>
      </div>
    </Dialog>
  );
}

function TechnicalDetail(props: { label: string; value: string | undefined }): JSX.Element {
  return (
    <div class="grid min-w-0 gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt class="font-medium">{props.label}</dt>
      <dd class="break-all font-mono text-foreground">{props.value ?? ''}</dd>
    </div>
  );
}

function cloneConfirmationIntent(intent: PluginConfirmationIntent): PluginConfirmationIntent {
  const { signal, ...json } = intent;
  return {
    ...JSON.parse(JSON.stringify(json)) as Omit<PluginConfirmationIntent, 'signal'>,
    signal,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function displayString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayStrings(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    const item = value.trim();
    return item ? [item] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const item = displayString(candidate);
    return item ? [item] : [];
  });
}

type DisplayRiskFlag = Readonly<{
  title: string;
  detail: string;
  severity: string;
  highRisk: boolean;
  adminRequired: boolean;
}>;

type ConfirmationPlanPresentation = Readonly<{
  summary: readonly string[];
  target: string;
  targetIdentity: string;
  action: string;
  riskLevel: string;
  riskFlags: readonly DisplayRiskFlag[];
  destructive: boolean;
  dataLoss: boolean;
  dataLossRisk: boolean;
  adminRequired: boolean;
  privileged: boolean;
  highRisk: boolean;
}>;

const HIGH_RISK_LEVELS = new Set(['high', 'critical']);

function projectConfirmationPlan(value: unknown): ConfirmationPlanPresentation {
  const plan = asRecord(value);
  const nestedTarget = asRecord(plan.target);
  const runtime = asRecord(plan.runtime);
  const riskFlags = displayRiskFlags(plan.risk_flags);
  const riskLevel = displayString(plan.risk_level).toLowerCase()
    || riskFlags.find((flag) => HIGH_RISK_LEVELS.has(flag.severity))?.severity
    || '';
  const adminRequired = plan.requires_admin === true || plan.admin_required === true
    || riskFlags.some((flag) => flag.adminRequired);
  const privileged = runtime.privileged === true;
  const destructive = plan.destructive === true;
  const dataLoss = plan.data_loss === true;
  const dataLossRisk = plan.data_loss_risk === true;
  const target = firstDisplayString(
    plan.resource_display_name,
    plan.resource_ref,
    nestedTarget.display_name,
    nestedTarget.name,
    nestedTarget.container_name,
    nestedTarget.resource_ref,
    nestedTarget.id,
    nestedTarget.container_id,
  );
  const targetIdentity = firstDisplayString(
    plan.resource_ref,
    nestedTarget.resource_ref,
    nestedTarget.id,
    nestedTarget.container_id,
  );
  const highRisk = destructive
    || dataLoss
    || dataLossRisk
    || adminRequired
    || privileged
    || HIGH_RISK_LEVELS.has(riskLevel)
    || riskFlags.some((flag) => flag.highRisk);

  return {
    summary: displayStrings(plan.summary),
    target,
    targetIdentity: targetIdentity === target ? '' : targetIdentity,
    action: displayString(plan.action),
    riskLevel,
    riskFlags,
    destructive,
    dataLoss,
    dataLossRisk,
    adminRequired,
    privileged,
    highRisk,
  };
}

function firstDisplayString(...values: readonly unknown[]): string {
  for (const value of values) {
    const item = displayString(value);
    if (item) return item;
  }
  return '';
}

function displayRiskFlags(value: unknown): readonly DisplayRiskFlag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const flag = asRecord(candidate);
    const title = displayString(flag.summary) || displayString(flag.title);
    if (!title) return [];
    const severity = displayString(flag.severity).toLowerCase();
    const adminRequired = flag.requires_admin === true || flag.admin_required === true;
    return [{
      title,
      detail: displayString(flag.description) || displayString(flag.detail),
      severity,
      adminRequired,
      highRisk: HIGH_RISK_LEVELS.has(severity)
        || adminRequired
        || flag.destructive === true
        || flag.data_loss === true
        || flag.data_loss_risk === true,
    }];
  });
}
