import type { ManagedDesktopModelSource } from './desktopModelSource';
import type { DesktopSessionKey } from './desktopTarget';
import type {
  RuntimePlacementBridgeSession,
  RuntimePlacementBridgeTermination,
} from './runtimePlacementBridgeSession';
import type { StartupReport } from './startup';
import type { DesktopSessionRuntimeHandle } from './sessionRuntime';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';

export type RuntimePlacementBridgeOwner = Readonly<
  | { kind: 'opening'; operation_key: string }
  | { kind: 'session'; session_key: DesktopSessionKey }
>;

export type RuntimePlacementBridgeRecord = Readonly<{
  runtime_key: string;
  environment_id: string;
  label: string;
  target_id: DesktopProviderRuntimeLinkTargetID;
  runtime_binary_path: string;
  session: RuntimePlacementBridgeSession;
  startup: StartupReport;
  desktop_model_source?: ManagedDesktopModelSource | null;
  runtime_handle: DesktopSessionRuntimeHandle;
}>;

type RuntimePlacementBridgeRegistryEntry = {
  record: RuntimePlacementBridgeRecord;
  owner: RuntimePlacementBridgeOwner;
  settlement: Promise<void>;
};

export type RuntimePlacementBridgeSettlementHandler = (
  record: RuntimePlacementBridgeRecord,
  owner: RuntimePlacementBridgeOwner,
  termination: RuntimePlacementBridgeTermination,
) => void | Promise<void>;

export class RuntimePlacementBridgeRegistry {
  private readonly entries = new Map<DesktopRuntimeTargetID, RuntimePlacementBridgeRegistryEntry>();

  constructor(private readonly onSettled: RuntimePlacementBridgeSettlementHandler) {}

  get size(): number {
    return this.entries.size;
  }

  get(targetID: DesktopRuntimeTargetID): RuntimePlacementBridgeRecord | null {
    return this.entries.get(targetID)?.record ?? null;
  }

  owner(targetID: DesktopRuntimeTargetID): RuntimePlacementBridgeOwner | null {
    return this.entries.get(targetID)?.owner ?? null;
  }

  keys(): readonly DesktopRuntimeTargetID[] {
    return [...this.entries.keys()];
  }

  values(): readonly RuntimePlacementBridgeRecord[] {
    return [...this.entries.values()].map((entry) => entry.record);
  }

  trackOpening(
    record: RuntimePlacementBridgeRecord,
    operationKey: string,
  ): RuntimePlacementBridgeRecord {
    const targetID = record.session.placement_target_id;
    if (this.entries.has(targetID)) {
      throw new Error(`Runtime Placement Bridge ${targetID} already has a lifecycle owner.`);
    }

    const entry: RuntimePlacementBridgeRegistryEntry = {
      record,
      owner: { kind: 'opening', operation_key: operationKey },
      settlement: Promise.resolve(),
    };
    this.entries.set(targetID, entry);
    const session = record.session;
    entry.settlement = session.closed.then(async (termination) => {
      const current = this.entries.get(targetID);
      if (!current || current.record.session !== session) {
        return;
      }
      this.entries.delete(targetID);
      await this.onSettled(current.record, current.owner, termination);
    });
    void entry.settlement.catch(() => undefined);
    return record;
  }

  attachSession(
    targetID: DesktopRuntimeTargetID,
    session: RuntimePlacementBridgeSession,
    sessionKey: DesktopSessionKey,
  ): RuntimePlacementBridgeRecord | null {
    const entry = this.entries.get(targetID);
    if (!entry || entry.record.session !== session) {
      return null;
    }
    if (entry.owner.kind === 'session') {
      return entry.owner.session_key === sessionKey ? entry.record : null;
    }
    entry.owner = { kind: 'session', session_key: sessionKey };
    return entry.record;
  }

  updateIfCurrent(
    targetID: DesktopRuntimeTargetID,
    session: RuntimePlacementBridgeSession,
    update: (record: RuntimePlacementBridgeRecord) => RuntimePlacementBridgeRecord,
  ): RuntimePlacementBridgeRecord | null {
    const entry = this.entries.get(targetID);
    if (!entry || entry.record.session !== session) {
      return null;
    }
    const next = update(entry.record);
    if (next.session !== session || next.session.placement_target_id !== targetID) {
      throw new Error('Runtime Placement Bridge updates must preserve session identity.');
    }
    entry.record = next;
    return next;
  }

  async retire(targetID: DesktopRuntimeTargetID): Promise<void> {
    const entry = this.entries.get(targetID);
    if (!entry) {
      return;
    }
    await entry.record.session.disconnect();
    await entry.settlement;
  }

  async retireAll(): Promise<void> {
    const targetIDs = this.keys();
    await Promise.all(targetIDs.map((targetID) => this.retire(targetID)));
  }
}
