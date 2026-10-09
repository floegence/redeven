import type { ManagedDesktopModelSource } from './desktopModelSource';
import type { DesktopSessionKey } from './desktopTarget';
import type { RuntimePlacementBridgeSession, RuntimePlacementBridgeTermination } from './runtimePlacementBridgeSession';
import type { StartupReport } from './startup';
import type { DesktopSessionRuntimeHandle } from './sessionRuntime';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopCloudRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

export type RuntimePlacementBridgeAttachment = Readonly<
  | { kind: 'opening'; operation_key: string }
  | { kind: 'session'; session_key: DesktopSessionKey }
>;
export type RuntimePlacementBridgeRecord = Readonly<{
  runtime_key: string;
  environment_id: string;
  label: string;
  target_id: DesktopCloudRuntimeLinkTargetID;
  runtime_binary_path: string;
  session: RuntimePlacementBridgeSession;
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
}>;
export type DesktopModelSourceState = Readonly<
  | { phase: 'idle' | 'starting' | 'connected' }
  | { phase: 'failed'; message: string }
>;
export type RuntimePlacementBridgeLease = Readonly<{
  record: RuntimePlacementBridgeRecord;
  active: boolean;
  modelSourceState: DesktopModelSourceState;
  attachSession: (sessionKey: DesktopSessionKey) => void;
  retain: (owner: string) => Promise<RuntimePlacementBridgeLease>;
  ensureModelSource: (start: (signal: AbortSignal) => Promise<ManagedDesktopModelSource>, retry?: boolean) => Promise<void>;
  release: () => Promise<void>;
}>;
type ModelSourceOwner = {
  controller: AbortController;
  state: DesktopModelSourceState;
  task: Promise<void>;
  handle?: ManagedDesktopModelSource;
};
type Entry = {
  controller: AbortController;
  consumers: Map<symbol, RuntimePlacementBridgeAttachment>;
  modelConsumers: Set<symbol>;
  opening: Promise<RuntimePlacementBridgeRecord>;
  record: RuntimePlacementBridgeRecord | null;
  settlement: Promise<void>;
  retiring?: Promise<void>;
  model?: ModelSourceOwner;
};
export type RuntimePlacementBridgeSettlementHandler = (
  record: RuntimePlacementBridgeRecord,
  attachments: readonly RuntimePlacementBridgeAttachment[],
  termination: RuntimePlacementBridgeTermination,
) => void | Promise<void>;

function canceled(): DOMException { return new DOMException('Runtime connection request was canceled.', 'AbortError'); }

/** Owns product consumers and creation only; the bridge session owns transport recovery. */
export class RuntimePlacementBridgeRegistry {
  private readonly entries = new Map<DesktopRuntimeTargetID, Entry>();
  private closed = false;
  constructor(
    private readonly onSettled: RuntimePlacementBridgeSettlementHandler,
    private readonly onModelChanged: (record: RuntimePlacementBridgeRecord, state: DesktopModelSourceState) => void = () => undefined,
  ) {}

  get size(): number { return this.entries.size; }
  get(targetID: DesktopRuntimeTargetID): RuntimePlacementBridgeRecord | null { return this.entries.get(targetID)?.record ?? null; }
  keys(): readonly DesktopRuntimeTargetID[] { return [...this.entries.keys()]; }
  values(): readonly RuntimePlacementBridgeRecord[] {
    return [...this.entries.values()].flatMap(entry => entry.record ? [entry.record] : []);
  }

  async acquire(
    targetID: DesktopRuntimeTargetID,
    owner: string,
    create: (signal: AbortSignal) => Promise<RuntimePlacementBridgeRecord>,
    signal?: AbortSignal,
  ): Promise<RuntimePlacementBridgeLease> {
    if (this.closed || signal?.aborted) throw canceled();
    let entry = this.entries.get(targetID);
    if (entry?.retiring) {
      await entry.retiring;
      return this.acquire(targetID, owner, create, signal);
    }
    if (!entry) {
      entry = {
        controller: new AbortController(), consumers: new Map(), modelConsumers: new Set(),
        record: null, opening: undefined!, settlement: Promise.resolve(),
      };
      this.entries.set(targetID, entry);
      const created = entry;
      // Reserve before calling the factory, including factories which throw synchronously.
      created.opening = Promise.resolve().then(() => create(created.controller.signal)).then(async record => {
        if (record.session.placement_target_id !== targetID || created.controller.signal.aborted || this.entries.get(targetID) !== created) {
          await record.session.disconnect();
          throw canceled();
        }
        created.record = record;
        created.settlement = record.session.closed.then(async termination => {
          if (this.entries.get(targetID) === created) this.entries.delete(targetID);
          const attachments = [...created.consumers.values()];
          created.consumers.clear();
          created.modelConsumers.clear();
          created.controller.abort();
          await this.stopModel(created);
          await this.onSettled(created.record!, attachments, termination);
        });
        void created.settlement.catch(() => undefined);
        return record;
      }).catch(error => {
        if (this.entries.get(targetID) === created) this.entries.delete(targetID);
        created.controller.abort();
        throw error;
      });
      void created.opening.catch(() => undefined);
    }
    const owned = entry;
    const token = Symbol(owner);
    owned.consumers.set(token, { kind: 'opening', operation_key: owner });
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', onAbort);
      owned.consumers.delete(token);
      owned.modelConsumers.delete(token);
      if (this.entries.get(targetID) !== owned) return;
      if (owned.consumers.size === 0) await this.retireEntry(targetID, owned);
      else if (owned.modelConsumers.size === 0) await this.stopModel(owned);
    };
    let rejectCanceled!: (error: Error) => void;
    const aborted = new Promise<never>((_, reject) => { rejectCanceled = reject; });
    const onAbort = () => { rejectCanceled(canceled()); void release().catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await Promise.race([owned.opening, aborted]);
      if (released || owned.controller.signal.aborted) throw canceled();
    } catch (error) {
      await release();
      throw error;
    }
    const isCurrent = () => this.entries.get(targetID) === owned;
    return {
      get record() { return owned.record!; },
      get active() { return !released && !owned.controller.signal.aborted && isCurrent(); },
      get modelSourceState() { return owned.model?.state ?? { phase: 'idle' }; },
      attachSession(sessionKey) {
        if (released || owned.controller.signal.aborted) throw canceled();
        owned.consumers.set(token, { kind: 'session', session_key: sessionKey });
      },
      retain: (nextOwner) => {
        if (released || owned.controller.signal.aborted) return Promise.reject(canceled());
        return this.acquire(targetID, nextOwner, async () => { throw canceled(); });
      },
      ensureModelSource: async (start, retry = false) => {
        if (released || owned.controller.signal.aborted) throw canceled();
        owned.modelConsumers.add(token);
        if (owned.model && !owned.model.controller.signal.aborted && !(retry && owned.model.state.phase === 'failed')) return owned.model.task;
        await this.stopModel(owned);
        if (released || owned.controller.signal.aborted) throw canceled();
        // Other consumers can enter while a prior model process is stopping.
        if (owned.model) return owned.model.task;
        const model: ModelSourceOwner = { controller: new AbortController(), state: { phase: 'starting' }, task: undefined! };
        owned.model = model;
        const publish = (state: DesktopModelSourceState) => {
          if (owned.model !== model || owned.controller.signal.aborted) return;
          model.state = state;
          this.onModelChanged(owned.record!, state);
        };
        model.task = (async () => {
          try {
            const handle = await start(model.controller.signal);
            model.handle = handle;
            if (model.controller.signal.aborted) { await handle.stop(); return; }
            void handle.ready.then(() => publish({ phase: 'connected' })).catch(() => undefined);
            void handle.closed.then(result => {
              model.handle = undefined;
              if (!model.controller.signal.aborted) publish({ phase: 'failed', message: result.message ?? 'Desktop model source stopped.' });
            });
          } catch (error) {
            if (!model.controller.signal.aborted) publish({ phase: 'failed', message: error instanceof Error ? error.message : 'Desktop model source could not start.' });
          }
        })();
        publish(model.state);
        return model.task;
      },
      release,
    };
  }

  updateIfCurrent(targetID: DesktopRuntimeTargetID, session: RuntimePlacementBridgeSession, update: (record: RuntimePlacementBridgeRecord) => RuntimePlacementBridgeRecord): RuntimePlacementBridgeRecord | null {
    const entry = this.entries.get(targetID);
    if (!entry?.record || entry.record.session !== session || entry.controller.signal.aborted) return null;
    const next = update(entry.record);
    if (next.session !== session || next.session.placement_target_id !== targetID) throw new Error('Runtime Placement Bridge updates must preserve session identity.');
    entry.record = next;
    return next;
  }

  private async stopModel(entry: Entry): Promise<void> {
    const model = entry.model;
    if (!model) return;
    model.controller.abort();
    await model.task;
    await model.handle?.stop();
    if (entry.model === model) entry.model = undefined;
  }

  private retireEntry(targetID: DesktopRuntimeTargetID, entry: Entry): Promise<void> {
    if (entry.retiring) return entry.retiring;
    entry.controller.abort();
    entry.retiring = (async () => {
      await this.stopModel(entry);
      const record = await entry.opening.catch(() => null);
      if (record) { await record.session.disconnect(); await entry.settlement; }
      if (this.entries.get(targetID) === entry) this.entries.delete(targetID);
    })();
    return entry.retiring;
  }

  async retire(targetID: DesktopRuntimeTargetID): Promise<void> {
    const entry = this.entries.get(targetID);
    if (entry) await this.retireEntry(targetID, entry);
  }

  async retireAll(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.entries].map(([targetID, entry]) => this.retireEntry(targetID, entry)));
  }
}
