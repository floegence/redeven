import { describe, expect, it, vi } from 'vitest';

import type { RuntimeHostAccessExecutor, RuntimeHostCommandOptions } from './runtimeHostAccess';
import {
  inspectReinstallTargetProcesses,
  stopReinstallTargetProcesses,
} from './reinstallTargetProcess';
import type { ReinstallTargetProcessInventory } from './reinstallTargetCoordinator';

const targetRoot = '/srv/redeven-private';
const inventory: ReinstallTargetProcessInventory = {
  schema_version: 1,
  target_root: targetRoot,
  inventory_digest: 'inventory-digest',
  instances: [],
  summary: { automatic: 0, blocked: 0 },
};

function executor(
  kind: 'local_host' | 'ssh_host',
  output: string,
): Readonly<{
  value: RuntimeHostAccessExecutor;
  run: ReturnType<typeof vi.fn<(argv: readonly string[], options?: RuntimeHostCommandOptions) => Promise<{ stdout: string; stderr: string }>>>;
}> {
  const run = vi.fn(async () => ({ stdout: output, stderr: '' }));
  return {
    run,
    value: {
      host_access: kind === 'local_host'
        ? { kind: 'local_host' }
        : {
            kind: 'ssh_host',
            ssh: { ssh_destination: 'ops@example.internal', ssh_port: null, auth_mode: 'key_agent' },
          },
      run,
      release: async () => undefined,
    },
  };
}

describe('reinstallTargetProcess', () => {
  it('uses the current bundled local helper without invoking an old target binary', async () => {
    const fake = executor('local_host', JSON.stringify(inventory));
    await inspectReinstallTargetProcesses({
      executor: fake.value,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      local_helper_executable: '/Applications/Redeven.app/Contents/Resources/bin/redeven',
    });

    expect(fake.run).toHaveBeenCalledWith([
      '/Applications/Redeven.app/Contents/Resources/bin/redeven',
      'desktop-target-process-inventory',
      '--target-root',
      targetRoot,
    ], {});
  });

  it('uploads the current helper through SSH under the temporary directory outside the target root', async () => {
    const archive = Buffer.from('current-runtime-archive');
    const fake = executor('ssh_host', JSON.stringify(inventory));
    await inspectReinstallTargetProcesses({
      executor: fake.value,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      helper_archive: archive,
    });

    const [argv, options] = fake.run.mock.calls[0]!;
    expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(argv[2]).toContain('${TMPDIR:-/tmp}/redeven-target-process-helper.XXXXXX');
    expect(argv[2]).not.toContain(`${targetRoot}/runtime/maintenance`);
    expect(argv[2]).not.toContain('service-stop');
    expect(argv).toContain(targetRoot);
    expect(options?.stdinData).toEqual(archive);
  });

  it('runs the uploaded helper inside only the registered container ID', async () => {
    const containerID = 'c'.repeat(64);
    const archive = Buffer.from('current-runtime-archive');
    const fake = executor('ssh_host', JSON.stringify({ after: inventory }));
    await stopReinstallTargetProcesses({
      executor: fake.value,
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: containerID,
        container_ref: containerID,
        container_label: 'registered',
        runtime_root: targetRoot,
        bridge_strategy: 'exec_stream',
      },
      target_root: targetRoot,
      helper_archive: archive,
      inventory,
    });

    const [argv, options] = fake.run.mock.calls[0]!;
    expect(argv.slice(0, 4)).toEqual(['docker', 'exec', '-i', containerID]);
    expect(argv).toContain('stop');
    expect(argv).toContain('inventory-digest');
    expect(argv.join('\n')).not.toContain('docker system prune');
    expect(argv.join('\n')).not.toContain('service-stop');
    expect(options?.stdinData).toEqual(archive);
  });
});
