import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import { containerRuntimeExecCommand } from './containerRuntime';
import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import type { ReinstallTargetProcessInventory } from './reinstallTargetCoordinator';

const processHelperScript = [
  'set -eu',
  'operation="$1"',
  'target_root="$2"',
  'inventory_digest="${3:-}"',
  'helper_root=$(mktemp -d "${TMPDIR:-/tmp}/redeven-target-process-helper.XXXXXX")',
  'cleanup() { rm -rf -- "$helper_root"; }',
  'trap cleanup EXIT INT TERM',
  'archive="$helper_root/redeven.tar.gz"',
  'cat > "$archive"',
  'tar -xzf "$archive" -C "$helper_root"',
  'helper="$helper_root/redeven"',
  '[ -x "$helper" ] || { echo "current Redeven maintenance helper is missing" >&2; exit 50; }',
  'case "$operation" in',
  '  inventory) "$helper" desktop-target-process-inventory --target-root "$target_root" ;;',
  '  stop) "$helper" desktop-target-process-stop --target-root "$target_root" --expected-inventory-digest "$inventory_digest" --best-effort --grace-period 5s ;;',
  '  *) echo "invalid Redeven target process operation" >&2; exit 51 ;;',
  'esac',
].join('\n');

function helperCommand(
  executor: RuntimeHostAccessExecutor,
  placement: DesktopRuntimePlacement,
  operation: 'inventory' | 'stop',
  targetRoot: string,
  inventoryDigest: string,
  localHelperExecutable: string | undefined,
): readonly string[] {
  if (executor.host_access.kind === 'local_host' && placement.kind === 'host_process' && localHelperExecutable) {
    return operation === 'inventory'
      ? [localHelperExecutable, 'desktop-target-process-inventory', '--target-root', targetRoot]
      : [localHelperExecutable, 'desktop-target-process-stop', '--target-root', targetRoot, '--expected-inventory-digest', inventoryDigest, '--best-effort', '--grace-period', '5s'];
  }
  const argv = ['sh', '-c', processHelperScript, 'redeven-target-process-helper', operation, targetRoot, inventoryDigest || '-'];
  if (placement.kind === 'host_process') {
    return argv;
  }
  return containerRuntimeExecCommand({
    engine: placement.container_engine,
    container_id: placement.container_id,
    argv,
  });
}

function parseInventory(raw: string): ReinstallTargetProcessInventory {
  const value = JSON.parse(String(raw ?? '')) as Partial<ReinstallTargetProcessInventory>;
  if (
    value.schema_version !== 1
    || typeof value.target_root !== 'string'
    || !Array.isArray(value.instances)
    || !value.summary
    || typeof value.summary.automatic !== 'number'
    || typeof value.summary.blocked !== 'number'
    || typeof value.inventory_digest !== 'string'
  ) {
    throw new Error('Current Redeven maintenance helper returned an invalid process inventory.');
  }
  return value as ReinstallTargetProcessInventory;
}

export async function inspectReinstallTargetProcesses(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  helper_archive?: Buffer;
  local_helper_executable?: string;
}>): Promise<ReinstallTargetProcessInventory> {
  const result = await args.executor.run(helperCommand(
    args.executor,
    args.placement,
    'inventory',
    args.target_root,
    '',
    args.local_helper_executable,
  ), { ...(args.helper_archive ? { stdinData: args.helper_archive } : {}) });
  return parseInventory(result.stdout);
}

export async function stopReinstallTargetProcesses(args: Readonly<{
  executor: RuntimeHostAccessExecutor;
  placement: DesktopRuntimePlacement;
  target_root: string;
  helper_archive?: Buffer;
  local_helper_executable?: string;
  inventory: ReinstallTargetProcessInventory;
}>): Promise<ReinstallTargetProcessInventory> {
  const result = await args.executor.run(helperCommand(
    args.executor,
    args.placement,
    'stop',
    args.target_root,
    args.inventory.inventory_digest,
    args.local_helper_executable,
  ), { ...(args.helper_archive ? { stdinData: args.helper_archive } : {}) });
  const payload = JSON.parse(String(result.stdout ?? '')) as { after?: unknown };
  return parseInventory(JSON.stringify(payload.after));
}
