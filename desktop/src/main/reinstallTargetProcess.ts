import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import { containerRuntimeExecCommand } from './containerRuntime';
import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import type { ReinstallTargetProcessInventory } from './reinstallTargetCoordinator';

const stageHelperScript = [
  'set -eu',
  'helper_root=$(mktemp -d "${TMPDIR:-/tmp}/redeven-target-process-helper.XXXXXX")',
  'archive="$helper_root/redeven.tar.gz"',
  'cleanup() { rm -rf -- "$helper_root"; }',
  'trap cleanup EXIT INT TERM',
  'cat > "$archive"',
  'tar -xzf "$archive" -C "$helper_root"',
  'helper="$helper_root/redeven"',
  '[ -x "$helper" ] || { echo "current Redeven maintenance helper is missing" >&2; exit 50; }',
  'trap - EXIT INT TERM',
  'printf "%s\\n" "$helper"',
].join('\n');

const processCommandScript = [
  'set -eu',
  'helper="$1"',
  'operation="$2"',
  'target_root="$3"',
  'inventory_digest="${4:-}"',
  '[ -x "$helper" ] || { echo "current Redeven maintenance helper is unavailable" >&2; exit 50; }',
  'case "$operation" in',
  '  inventory) "$helper" desktop-target-process-inventory --target-root "$target_root" ;;',
  '  stop) "$helper" desktop-target-process-stop --target-root "$target_root" --expected-inventory-digest "$inventory_digest" --best-effort --grace-period 5s ;;',
  '  *) echo "invalid Redeven target process operation" >&2; exit 51 ;;',
  'esac',
].join('\n');

const cleanupHelperScript = [
  'set -eu',
  'helper="$1"',
  'helper_root="${helper%/redeven}"',
  'case "$helper_root" in',
  '  "${TMPDIR:-/tmp}"/redeven-target-process-helper.*) rm -rf -- "$helper_root" ;;',
  '  *) echo "refusing to clean an unknown reinstall helper path" >&2; exit 1 ;;',
  'esac',
].join('\n');

function placementCommand(
  placement: DesktopRuntimePlacement,
  script: string,
  marker: string,
  args: readonly string[] = [],
): readonly string[] {
  const argv = ['sh', '-c', script, marker, ...args];
  return placement.kind === 'host_process'
    ? argv
    : containerRuntimeExecCommand({
        engine: placement.container_engine,
        container_id: placement.container_id,
        argv,
      });
}

function parseInventory(raw: string): ReinstallTargetProcessInventory {
  const value = JSON.parse(String(raw ?? '')) as Partial<ReinstallTargetProcessInventory>;
  if (
    value.schema_version !== 1 ||
    typeof value.target_root !== 'string' ||
    !Array.isArray(value.instances) ||
    !value.summary ||
    typeof value.summary.automatic !== 'number' ||
    typeof value.summary.blocked !== 'number' ||
    typeof value.inventory_digest !== 'string'
  ) {
    throw new Error('Current Redeven maintenance helper returned an invalid process inventory.');
  }
  return value as ReinstallTargetProcessInventory;
}

export type ReinstallTargetProcessSession = Readonly<{
  inspect: () => Promise<ReinstallTargetProcessInventory>;
  stop: (inventory: ReinstallTargetProcessInventory) => Promise<ReinstallTargetProcessInventory>;
  close: () => Promise<void>;
}>;

export async function openReinstallTargetProcessSession(
  args: Readonly<{
    executor: RuntimeHostAccessExecutor;
    placement: DesktopRuntimePlacement;
    target_root: string;
    helper_archive?: Buffer;
    local_helper_executable?: string;
  }>,
): Promise<ReinstallTargetProcessSession> {
  const localHelper =
    args.executor.host_access.kind === 'local_host' && args.placement.kind === 'host_process'
      ? String(args.local_helper_executable ?? '').trim()
      : '';
  let helper = localHelper;
  let stagedHelper = '';
  if (helper === '') {
    if (!args.helper_archive) {
      throw new Error('Desktop did not prepare the current Redeven maintenance helper.');
    }
    const staged = await args.executor.run(
      placementCommand(args.placement, stageHelperScript, 'redeven-target-process-helper-stage'),
      { stdinData: args.helper_archive },
    );
    helper =
      String(staged.stdout ?? '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1) ?? '';
    if (helper === '') {
      throw new Error('Desktop could not stage the current Redeven maintenance helper.');
    }
    stagedHelper = helper;
  }

  let closed = false;
  const run = async (
    operation: 'inventory' | 'stop',
    inventoryDigest = '',
  ): Promise<ReinstallTargetProcessInventory> => {
    if (closed) {
      throw new Error('Redeven reinstall process session is closed.');
    }
    const result = await args.executor.run(
      placementCommand(args.placement, processCommandScript, 'redeven-target-process-helper', [
        helper,
        operation,
        args.target_root,
        inventoryDigest || '-',
      ]),
    );
    if (operation === 'inventory') {
      return parseInventory(result.stdout);
    }
    const payload = JSON.parse(String(result.stdout ?? '')) as {
      after?: unknown;
    };
    return parseInventory(JSON.stringify(payload.after));
  };

  return {
    inspect: () => run('inventory'),
    stop: (inventory) => run('stop', inventory.inventory_digest),
    close: async () => {
      if (closed) return;
      closed = true;
      if (stagedHelper !== '') {
        await args.executor
          .run(
            placementCommand(args.placement, cleanupHelperScript, 'redeven-target-process-helper-cleanup', [
              stagedHelper,
            ]),
          )
          .catch(() => undefined);
      }
    },
  };
}
