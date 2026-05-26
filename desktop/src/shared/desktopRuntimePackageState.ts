import {
  desktopRuntimeMaintenanceRequiresUpdate,
  type DesktopRuntimeMaintenanceRequirement,
} from './desktopRuntimeHealth';
import type { RuntimeServiceSnapshot } from './runtimeService';

export type DesktopRuntimePackageState =
  | Readonly<{
      state: 'absent';
      target_version: string;
    }>
  | Readonly<{
      state: 'compatible';
      current_version: string;
      target_version: string;
    }>
  | Readonly<{
      state: 'outdated';
      current_version: string;
      target_version: string;
    }>
  | Readonly<{
      state: 'incompatible';
      current_version?: string;
      target_version: string;
      reason: string;
    }>
  | Readonly<{
      state: 'unknown';
      target_version: string;
      reason: string;
    }>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function desktopRuntimePackageStateFromRuntimeService(
  runtimeService: RuntimeServiceSnapshot | undefined,
  maintenance: DesktopRuntimeMaintenanceRequirement | undefined,
): DesktopRuntimePackageState | undefined {
  const targetVersion = compact(maintenance?.target_runtime_version);
  const currentVersion = compact(maintenance?.current_runtime_version ?? runtimeService?.runtime_version);
  if (desktopRuntimeMaintenanceRequiresUpdate(maintenance)) {
    return {
      state: 'outdated',
      current_version: currentVersion || 'unknown',
      target_version: targetVersion || currentVersion || 'unknown',
    };
  }
  if (runtimeService) {
    return {
      state: 'compatible',
      current_version: currentVersion || targetVersion || 'unknown',
      target_version: targetVersion || currentVersion || 'unknown',
    };
  }
  return undefined;
}
