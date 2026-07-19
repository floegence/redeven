import type {
  PluginConfirmationDecision,
  PluginConfirmationHandler,
  PluginConfirmationIntent,
} from '@floegence/redevplugin-ui';
import { ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { createSignal, type Accessor, type JSX } from 'solid-js';

import { useI18n } from '../i18n';

export type PluginConfirmationOwner = Readonly<{
  pluginID: string;
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
  const active = () => props.queue.active();
  const intent = () => active()?.intent;
  const plan = () => asRecord(intent()?.plan);
  const summary = () => String(plan().summary ?? '').trim();
  const target = () => String(plan().resource_display_name ?? plan().resource_ref ?? '').trim();

  return (
    <ConfirmDialog
      open={Boolean(intent())}
      onOpenChange={(open) => {
        if (!open) props.queue.rejectActive();
      }}
      title={i18n.t('uiCopy.pluginRuntime.approveAction')}
      onConfirm={() => props.queue.approveActive()}
    >
      <div class="space-y-3 text-sm" data-plugin-confirmation-dialog>
        <p class="break-all text-xs font-medium text-foreground" data-plugin-confirmation-owner>
          {i18n.t('uiCopy.plugin.surfaceTitle')}: {active()?.owner.pluginID ?? ''} · {active()?.owner.pluginInstanceID ?? ''} · {active()?.owner.surfaceID ?? ''}
        </p>
        {summary() ? <p class="break-words text-foreground">{i18n.t('uiCopy.pluginRuntime.summary', { value: summary() })}</p> : null}
        {target() ? <p class="break-all font-mono text-xs text-foreground">{i18n.t('uiCopy.pluginRuntime.target', { value: target() })}</p> : null}
        <p class="break-all font-mono text-xs text-muted-foreground">
          {i18n.t('uiCopy.pluginRuntime.method', { value: intent()?.method ?? '' })}
        </p>
        <p class="break-all font-mono text-xs text-muted-foreground">
          {i18n.t('uiCopy.pluginRuntime.requestHash', { value: intent()?.requestHash ?? '' })}
        </p>
      </div>
    </ConfirmDialog>
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
