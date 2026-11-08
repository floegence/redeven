import type {
  PluginConfirmationDecision,
  PluginConfirmationHandler,
  PluginConfirmationIntent,
} from '@floegence/redevplugin-ui';
import { Show, Suspense, lazy, createEffect, createSignal, onCleanup, type Accessor, type JSX } from 'solid-js';

const PluginConfirmationDialogEntry = lazy(() => import('./PluginConfirmationDialog').then(module => ({ default: module.PluginConfirmationDialogEntry })));

const CONFIRMATION_ENTRY_REARM_DELAY_MS = 750;

export type PluginConfirmationOwner = Readonly<{
  pluginID: string;
  displayName?: string;
  pluginInstanceID: string;
  surfaceID: string;
  canConfirm: () => boolean;
}>;

export type ConfirmationQueueEntry = {
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
  const [presentedEntryID, setPresentedEntryID] = createSignal<number>();
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
    if (presentedEntryID() !== activeEntryID || activeEntryID === previousVisibleEntryID) return;

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
        <Suspense><PluginConfirmationDialogEntry
          queue={props.queue}
          entry={entry}
          onPresented={() => setPresentedEntryID(entry.id)}
          approvalArmed={() => presentedEntryID() === entry.id && blockedApprovalEntryID() !== entry.id}
        /></Suspense>
      )}
    </Show>
  );
}

function cloneConfirmationIntent(intent: PluginConfirmationIntent): PluginConfirmationIntent {
  const { signal, ...json } = intent;
  return {
    ...JSON.parse(JSON.stringify(json)) as Omit<PluginConfirmationIntent, 'signal'>,
    signal,
  };
}
