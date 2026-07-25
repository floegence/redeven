import type {
  PluginConfirmationDecision,
  PluginConfirmationHandler,
  PluginConfirmationIntent,
} from '@floegence/redevplugin-ui';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createSignal, type Accessor, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';

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
  approveActive: () => void;
  rejectActive: () => void;
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

  const settleActive = (confirmed: boolean) => {
    let settled: ConfirmationQueueEntry | undefined;
    setEntries((current) => {
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
    approveActive: () => settleActive(true),
    rejectActive: () => settleActive(false),
    cancelOwner: (owner) => cancelMatching((entry) => entry.owner === owner),
    cancelAll: () => cancelMatching(() => true),
  });
}

export function PluginConfirmationDialog(props: {
  queue: PluginConfirmationQueue;
}): JSX.Element {
  const i18n = useI18n();
  let cancelButton: HTMLButtonElement | undefined;
  const active = () => props.queue.active();
  const intent = () => active()?.intent;
  const plan = () => asRecord(intent()?.plan);
  const summary = () => displayString(plan().summary);
  const target = () => displayString(plan().resource_display_name) || displayString(plan().resource_ref);
  const action = () => displayString(plan().action);
  const riskFlags = () => displayRiskFlags(plan().risk_flags);
  const pluginName = () => active()?.owner.displayName?.trim() || active()?.owner.pluginID || '';
  const pendingCount = () => props.queue.pendingCount?.() ?? (active() ? 1 : 0);

  createEffect(() => {
    const activeID = active()?.id;
    if (activeID === undefined) return;
    queueMicrotask(() => {
      if (active()?.id === activeID) cancelButton?.focus();
    });
  });

  return (
    <Dialog
      open={Boolean(intent())}
      onOpenChange={(open) => {
        if (!open) props.queue.rejectActive();
      }}
      title={summary() || i18n.t('uiCopy.pluginRuntime.approveAction')}
      footer={(
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButton}
            type="button"
            class={`${PLUGIN_MOBILE_TOUCH_TARGET_CLASS} cursor-pointer rounded-md border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            data-floe-autofocus
            data-plugin-confirmation-reject
            onClick={() => props.queue.rejectActive()}
          >
            {i18n.t('common.actions.cancel')}
          </button>
          <button
            type="button"
            class={`${PLUGIN_MOBILE_TOUCH_TARGET_CLASS} cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${plan().destructive === true
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
            data-plugin-confirmation-approve
            onClick={() => props.queue.approveActive()}
          >
            {action() || i18n.t('common.actions.confirm')}
          </button>
        </div>
      )}
    >
      <div class="space-y-4 text-sm" data-plugin-confirmation-dialog>
        <div class="flex min-w-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-medium text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceTitle')}</p>
            <p class="mt-1 truncate font-semibold text-foreground" data-plugin-confirmation-owner title={pluginName()}>{pluginName()}</p>
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

        <Show when={!summary()}>
          <p class="break-words font-medium text-foreground" data-plugin-confirmation-method-fallback>
            {i18n.t('uiCopy.pluginRuntime.method', { value: intent()?.method ?? '' })}
          </p>
        </Show>

        <Show when={target()}>
          <div class="rounded-md border bg-muted/30 px-3 py-2.5" data-plugin-confirmation-target>
            <p class="break-words font-medium text-foreground">{i18n.t('uiCopy.pluginRuntime.target', { value: target() })}</p>
          </div>
        </Show>

        <Show when={riskFlags().length > 0}>
          <ul class="space-y-2 border-l-2 border-destructive/40 pl-3" data-plugin-confirmation-impact>
            {riskFlags().map((flag) => (
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
            <TechnicalDetail label="plugin_id" value={active()?.owner.pluginID} />
            <TechnicalDetail label="plugin_instance_id" value={active()?.owner.pluginInstanceID} />
            <TechnicalDetail label="surface_id" value={active()?.owner.surfaceID} />
            <TechnicalDetail label="request_id" value={intent()?.requestId} />
            <TechnicalDetail label="confirmation_token_id" value={intent()?.confirmationTokenId} />
            <TechnicalDetail label="method" value={intent()?.method} />
            <TechnicalDetail label="request_hash" value={intent()?.requestHash} />
            <TechnicalDetail label="plan_hash" value={intent()?.planHash} />
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
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function displayString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayRiskFlags(value: unknown): readonly Readonly<{ title: string; detail: string }>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const flag = asRecord(candidate);
    const title = displayString(flag.summary);
    if (!title) return [];
    return [{ title, detail: displayString(flag.description) }];
  });
}
