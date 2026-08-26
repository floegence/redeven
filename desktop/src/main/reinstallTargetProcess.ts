import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import {
  DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS,
  DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
} from './runtimeHostAccess';
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
  '[ -x "$helper" ] || { echo "current Redeven process tool is missing" >&2; exit 50; }',
  'trap - EXIT INT TERM',
  'printf "%s\\n" "$helper"',
].join('\n');

const processCommandScript = [
  'set -eu',
  'helper="$1"',
  'operation="$2"',
  'target_root="$3"',
  'inventory_digest="${4:-}"',
  '[ -x "$helper" ] || { echo "current Redeven process tool is unavailable" >&2; exit 50; }',
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
    throw new Error('Current Redeven process tool returned an invalid process inventory.');
  }
  return value as ReinstallTargetProcessInventory;
}

export type ReinstallTargetProcessSession = Readonly<{
  inspect: (signal?: AbortSignal) => Promise<ReinstallTargetProcessInventory>;
  stop: (inventory: ReinstallTargetProcessInventory, signal?: AbortSignal) => Promise<ReinstallTargetProcessInventory>;
  close: () => Promise<void>;
}>;

export async function openReinstallTargetProcessSession(
  args: Readonly<{
    executor: RuntimeHostAccessExecutor;
    placement: DesktopRuntimePlacement;
    target_root: string;
    helper_archive?: Buffer;
    helper_executable?: string;
    local_helper_executable?: string;
    signal?: AbortSignal;
  }>,
): Promise<ReinstallTargetProcessSession> {
  const localHelper =
    args.executor.host_access.kind === 'local_host' && args.placement.kind === 'host_process'
      ? String(args.local_helper_executable ?? '').trim()
      : '';
  let helper = String(args.helper_executable ?? '').trim() || localHelper;
  let stagedHelper = '';
  if (helper === '') {
    if (!args.helper_archive) {
      throw new Error('Desktop did not prepare the current Redeven process tool.');
    }
    const staged = await args.executor.run(
      placementCommand(args.placement, stageHelperScript, 'redeven-target-process-helper-stage'),
      {
        stdinData: args.helper_archive,
        ...(args.signal ? { signal: args.signal } : {}),
        timeout_ms: DEFAULT_RUNTIME_HOST_TRANSFER_TIMEOUT_MS,
      },
    );
    helper =
      String(staged.stdout ?? '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1) ?? '';
    if (helper === '') {
      throw new Error('Desktop could not stage the current Redeven process tool.');
    }
    stagedHelper = helper;
  }

  let closed = false;
  const run = async (
    operation: 'inventory' | 'stop',
    inventoryDigest = '',
    signal?: AbortSignal,
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
      { ...(signal ? { signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS },
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
    inspect: (signal) => run('inventory', '', signal),
    stop: (inventory, signal) => run('stop', inventory.inventory_digest, signal),
    close: async () => {
      if (closed) return;
      closed = true;
      if (stagedHelper !== '') {
        await args.executor
          .run(
            placementCommand(args.placement, cleanupHelperScript, 'redeven-target-process-helper-cleanup', [
              stagedHelper,
            ]),
            { ...(args.signal ? { signal: args.signal } : {}), timeout_ms: DEFAULT_RUNTIME_HOST_COMMAND_TIMEOUT_MS },
          )
          .catch(() => undefined);
      }
    },
  };
}
