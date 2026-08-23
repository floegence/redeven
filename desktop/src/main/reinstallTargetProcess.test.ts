import { describe, expect, it, vi } from 'vitest';

import type { RuntimeHostAccessExecutor, RuntimeHostCommandOptions } from './runtimeHostAccess';
import { openReinstallTargetProcessSession } from './reinstallTargetProcess';
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
  outputs: readonly string[],
): Readonly<{
  value: RuntimeHostAccessExecutor;
  run: ReturnType<
    typeof vi.fn<
      (argv: readonly string[], options?: RuntimeHostCommandOptions) => Promise<{ stdout: string; stderr: string }>
    >
  >;
}> {
  const remaining = [...outputs];
  const run = vi.fn(async () => ({
    stdout: remaining.shift() ?? '',
    stderr: '',
  }));
  return {
    run,
    value: {
      host_access:
        kind === 'local_host'
          ? { kind: 'local_host' }
          : {
              kind: 'ssh_host',
              ssh: {
                ssh_destination: 'ops@example.internal',
                ssh_port: null,
                auth_mode: 'key_agent',
              },
            },
      run,
      release: async () => undefined,
    },
  };
}

describe('reinstallTargetProcess', () => {
  it('uses the current bundled local helper without invoking an old target binary', async () => {
    const fake = executor('local_host', [JSON.stringify(inventory)]);
    const session = await openReinstallTargetProcessSession({
      executor: fake.value,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      local_helper_executable: '/Applications/Redeven.app/Contents/Resources/bin/redeven',
    });
    await session.inspect();
    await session.close();

    const [argv] = fake.run.mock.calls[0]!;
    expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(argv).toContain('/Applications/Redeven.app/Contents/Resources/bin/redeven');
    expect(argv).toContain('inventory');
    expect(argv).toContain(targetRoot);
  });

  it('uploads the current helper through SSH under the temporary directory outside the target root', async () => {
    const archive = Buffer.from('current-runtime-archive');
    const helperPath = '/tmp/redeven-target-process-helper.123/redeven';
    const fake = executor('ssh_host', [helperPath, JSON.stringify(inventory), '']);
    const session = await openReinstallTargetProcessSession({
      executor: fake.value,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      helper_archive: archive,
    });
    await session.inspect();
    await session.close();

    const [argv, options] = fake.run.mock.calls[0]!;
    expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
    expect(argv[2]).toContain('${TMPDIR:-/tmp}/redeven-target-process-helper.XXXXXX');
    expect(argv[2]).not.toContain(`${targetRoot}/runtime/maintenance`);
    expect(argv[2]).not.toContain('service-stop');
    expect(options?.stdinData).toEqual(archive);
    expect(fake.run.mock.calls[1]![0]).toContain(targetRoot);
    expect(fake.run.mock.calls[1]![1]?.stdinData).toBeUndefined();
    expect(fake.run.mock.calls[2]![0].join('\n')).toContain('rm -rf -- "$helper_root"');
  });

  it('runs the uploaded helper inside only the registered container ID', async () => {
    const containerID = 'c'.repeat(64);
    const archive = Buffer.from('current-runtime-archive');
    const helperPath = '/tmp/redeven-target-process-helper.123/redeven';
    const fake = executor('ssh_host', [helperPath, JSON.stringify({ after: inventory }), '']);
    const session = await openReinstallTargetProcessSession({
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
    });
    await session.stop(inventory);
    await session.close();

    const [argv] = fake.run.mock.calls[1]!;
    expect(argv.slice(0, 4)).toEqual(['docker', 'exec', '-i', containerID]);
    expect(argv).toContain('stop');
    expect(argv).toContain('inventory-digest');
    expect(argv.join('\n')).not.toContain('docker system prune');
    expect(argv.join('\n')).not.toContain('service-stop');
    expect(fake.run.mock.calls[0]![1]?.stdinData).toEqual(archive);
    expect(fake.run.mock.calls[1]![1]?.stdinData).toBeUndefined();
  });
});
