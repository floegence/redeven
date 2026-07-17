import type {
  RuntimePlacementBridgeRegistry,
  RuntimePlacementBridgeRecord,
} from './runtimePlacementBridgeRegistry';
import type { StartupReport } from './startup';
import type { RuntimeProbeFailure, RuntimeProbeResult } from './runtimeState';
import type { DesktopSessionTransportRecoverySnapshot } from '../shared/desktopSessionContextIPC';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';

export type RuntimePlacementBridgeObservation = Readonly<
  | { kind: 'absent' }
  | { kind: 'ready'; record: RuntimePlacementBridgeRecord }
  | {
      kind: 'recovering';
      record: RuntimePlacementBridgeRecord;
      recovery: DesktopSessionTransportRecoverySnapshot;
    }
  | {
      kind: 'unavailable';
      record: RuntimePlacementBridgeRecord;
      failure: RuntimeProbeFailure;
    }
>;

export async function observeRuntimePlacementBridge(
  registry: RuntimePlacementBridgeRegistry,
  targetID: DesktopRuntimeTargetID,
  probe: (record: RuntimePlacementBridgeRecord) => Promise<RuntimeProbeResult<StartupReport>>,
): Promise<RuntimePlacementBridgeObservation> {
  for (;;) {
    const bridgeRecord = registry.get(targetID);
    if (!bridgeRecord) {
      return { kind: 'absent' };
    }
    const beforeProbe = bridgeRecord.session.getRecoverySnapshot();
    if (beforeProbe.phase === 'waiting' || beforeProbe.phase === 'connecting') {
      return { kind: 'recovering', record: bridgeRecord, recovery: beforeProbe };
    }
    if (beforeProbe.phase === 'failed') {
      await bridgeRecord.session.closed;
      continue;
    }

    const result = await probe(bridgeRecord);
    const current = registry.get(targetID);
    if (!current || current.session !== bridgeRecord.session) {
      continue;
    }
    const afterProbe = current.session.getRecoverySnapshot();
    if (afterProbe.phase === 'waiting' || afterProbe.phase === 'connecting') {
      return { kind: 'recovering', record: current, recovery: afterProbe };
    }
    if (afterProbe.phase === 'failed') {
      await current.session.closed;
      continue;
    }
    if (!result.ok) {
      return { kind: 'unavailable', record: current, failure: result.failure };
    }

    const startup = result.value;
    const updatedRecord = registry.updateIfCurrent(
      targetID,
      current.session,
      (record) => ({
        ...record,
        startup: {
          ...record.startup,
          local_ui_url: startup.local_ui_url,
          local_ui_urls: startup.local_ui_urls,
          runtime_control: record.startup.runtime_control,
          password_required: startup.password_required,
          started_at_unix_ms: startup.started_at_unix_ms
            ?? record.startup.started_at_unix_ms,
          runtime_service: startup.runtime_service ?? record.startup.runtime_service,
        },
      }),
    );
    if (!updatedRecord) {
      continue;
    }
    return { kind: 'ready', record: updatedRecord };
  }
}
