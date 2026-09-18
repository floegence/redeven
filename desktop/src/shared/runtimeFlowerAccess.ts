import {
  RUNTIME_SERVICE_COMPATIBILITY_EPOCH,
  RUNTIME_SERVICE_PROTOCOL_VERSION,
  runtimeServiceIsOpenable,
  runtimeServiceNeedsDesktopUpdate,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceOpenReadinessLabel,
  type RuntimeServiceSnapshot,
} from './runtimeService';

export type RuntimeFlowerBlocker = Readonly<{
  code: 'runtime_update_required' | 'desktop_update_required' | 'runtime_not_ready';
  message: string;
}>;

// Desktop ships this client. The Runtime's own Env App has a separate
// readiness boundary and can remain usable across Desktop protocol versions.
export function runtimeFlowerBlocker(snapshot: RuntimeServiceSnapshot | null | undefined): RuntimeFlowerBlocker | null {
  if (snapshot) {
    const epoch = snapshot.compatibility_epoch;
    if (runtimeServiceNeedsDesktopUpdate(snapshot) || (typeof epoch === 'number' && epoch > RUNTIME_SERVICE_COMPATIBILITY_EPOCH)) {
      return { code: 'desktop_update_required', message: 'Update Redeven Desktop before using Flower with this Runtime.' };
    }
    if (epoch !== RUNTIME_SERVICE_COMPATIBILITY_EPOCH || snapshot.protocol_version !== RUNTIME_SERVICE_PROTOCOL_VERSION || runtimeServiceNeedsRuntimeUpdate(snapshot)) {
      return { code: 'runtime_update_required', message: 'Update this Runtime before using Desktop Flower. Your draft is kept.' };
    }
  }
  return runtimeServiceIsOpenable(snapshot) ? null : { code: 'runtime_not_ready', message: runtimeServiceOpenReadinessLabel(snapshot) };
}

export function assertRuntimeFlowerCompatible(snapshot: RuntimeServiceSnapshot | null | undefined): void {
  const blocker = runtimeFlowerBlocker(snapshot);
  if (blocker) throw Object.assign(new Error(blocker.message), { code: blocker.code });
}
