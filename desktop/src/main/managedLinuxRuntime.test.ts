import { describe, expect, it, vi } from 'vitest';

import { ensureManagedLinuxRuntimeReady } from './managedLinuxRuntime';
import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';

const inventory = {
  schema_version: 3,
  scope: {
    runtime_root: '/home/dev/.redeven',
    state_root: '/home/dev/.redeven',
    user_identity: 'dev',
    namespace_id: 'mnt:[1]',
  },
  inventory_digest: 'a'.repeat(64),
  instances: [{
    pid: 4242,
    process_started_at_unix_ms: 1778751234567,
    instance_id: 'runtime-instance',
    state_root: '/home/dev/.redeven',
    executable_path: '/home/dev/.redeven/runtime/managed/bin/redeven',
    executable_device: 1,
    executable_inode: 2,
    namespace_id: 'mnt:[1]',
    runtime_version: 'v1.2.3',
    identity_status: 'verified',
    layout_status: 'current',
    stop_authority: 'automatic',
  }],
  summary: { automatic: 1, blocked: 0 },
};

describe('managed Linux Runtime', () => {
  it('attaches to one verified current process instead of starting a duplicate', async () => {
    const run = vi.fn<RuntimeHostAccessExecutor['run']>(async (argv) => {
      const script = argv[2] ?? '';
      if (script.includes('runtime_is_compatible')) {
        return {
          stdout: [
            'status=ready',
            'slot_release_tag=v1.2.3',
            'reported_release_tag=v1.2.3',
            'target_release_tag=v1.2.3',
            'binary_path=/home/dev/.redeven/runtime/managed/bin/redeven',
            'stamp_path=/home/dev/.redeven/runtime/managed/.redeven-managed-runtime',
            'reason=ready',
          ].join('\n'),
          stderr: '',
        };
      }
      if (script.includes('desktop-runtime-inventory')) {
        return { stdout: JSON.stringify(inventory), stderr: '' };
      }
      if (script.includes('desktop-runtime-status')) {
        return {
          stdout: JSON.stringify({
            status: 'ready',
            pid: 4242,
            local_ui_bridge_url: 'http://127.0.0.1:43124/',
            local_ui_bridge_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            password_required: false,
            effective_run_mode: 'desktop',
            remote_enabled: false,
          }),
          stderr: '',
        };
      }
      throw new Error(`Unexpected managed Linux command: ${argv.join(' ')}`);
    });
    const executor: RuntimeHostAccessExecutor = {
      host_access: { kind: 'wsl_host', distribution_name: 'Ubuntu-24.04', linux_user: 'dev' },
      run,
      release: async () => undefined,
    };

    await expect(ensureManagedLinuxRuntimeReady({
      executor,
      runtime_root: 'remote_default',
      runtime_state_root: 'remote_default',
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://invalid.example',
      asset_cache_root: '/unused',
      runtime_process_intent: 'start',
    })).resolves.toMatchObject({
      runtime_binary_path: '/home/dev/.redeven/runtime/managed/bin/redeven',
      startup: { pid: 4242 },
    });
    expect(run.mock.calls.some(([argv]) => (argv[2] ?? '').includes('setsid "$binary"'))).toBe(false);
  });
});
