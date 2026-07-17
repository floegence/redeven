import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
} from './runtimeHostAccess';
import { DesktopOperationFailureError } from './desktopOperationFailure';
import type { DesktopSSHTransportManager } from './sshTransportManager';

function fakeTransportManager(
  run: (command: string, options?: Readonly<{ stdinData?: Buffer }>) => Promise<Readonly<{
    exit_code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>> = async () => ({ exit_code: 0, signal: null, stdout: '', stderr: '' }),
) {
  const runMock = vi.fn(run);
  const release = vi.fn(async () => undefined);
  const acquire = vi.fn(async (input) => ({
    generation: 1,
    target: input.target,
    run: runMock,
    stream: vi.fn(),
    release,
  }));
  return {
    manager: { acquire, dispose: vi.fn(async () => undefined) } as DesktopSSHTransportManager,
    acquire,
    run: runMock,
    release,
  };
}

describe('runtimeHostAccess', () => {
  it('describes local host access without placement details', () => {
    expect(createLocalRuntimeHostExecutor().host_access).toEqual({ kind: 'local_host' });
  });

  it('describes SSH host access separately from runtime placement', () => {
    const transport = fakeTransportManager();
    const executor = createSSHRuntimeHostExecutor(transport.manager, {
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      connect_timeout_seconds: 15,
    }, { credentialScope: 'environment-a' });

    expect(executor.host_access).toMatchObject({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: 2222,
      },
    });
  });

  it('surfaces missing local host commands as structured command-not-found errors', async () => {
    await expect(createLocalRuntimeHostExecutor().run([
      'redeven-missing-host-command-for-test',
    ], {
      env: { PATH: '' },
    })).rejects.toMatchObject({
      name: 'DesktopHostCommandNotFoundError',
      command_name: 'redeven-missing-host-command-for-test',
      message: 'redeven-missing-host-command-for-test was not found. Install it or make it available to Redeven Desktop, then try again.',
    });
  });

  it('passes explicit bridge environment variables to the remote SSH command', async () => {
    const transport = fakeTransportManager();
    const executor = createSSHRuntimeHostExecutor(transport.manager, {
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'key_agent',
      connect_timeout_seconds: 15,
    }, { credentialScope: 'environment-a' });
    await executor.run(['docker', 'exec', '-i', 'dev', 'redeven', 'desktop-bridge'], {
      env: {
        REDEVEN_DESKTOP_OWNER_ID: 'desktop-owner',
        'BAD-NAME': 'ignored',
      },
    });
    const remoteCommand = transport.run.mock.calls[0]?.[0] ?? '';
    expect(remoteCommand).toBe(
      "env REDEVEN_DESKTOP_OWNER_ID='desktop-owner' 'docker' 'exec' '-i' 'dev' 'redeven' 'desktop-bridge'",
    );
    expect(remoteCommand).not.toContain('-L');
    expect(remoteCommand).not.toContain('ExitOnForwardFailure');
    await executor.release();
  });

  it('uses a locally supplied SSH password through askpass without sending it in argv', async () => {
    const transport = fakeTransportManager();
    const executor = createSSHRuntimeHostExecutor(transport.manager, {
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'password',
      connect_timeout_seconds: 15,
    }, {
      sshPassword: 'stored-secret',
      credentialScope: 'saved-environment-a',
    });
    await executor.run(['true']);

    expect(transport.acquire).toHaveBeenCalledWith(expect.objectContaining({
      credentialScope: 'saved-environment-a',
      sshPassword: 'stored-secret',
    }));
    expect(transport.run.mock.calls[0]?.[0]).not.toContain('stored-secret');
    await executor.release();
  });

  it('streams stdin data through local and SSH host executors', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-host-stdin-test-'));
    const localOut = path.join(tempDir, 'local.bin');
    await createLocalRuntimeHostExecutor().run([
      process.execPath,
      '-e',
      `const fs=require('node:fs');const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(localOut)}, Buffer.concat(chunks)));`,
    ], {
      stdinData: Buffer.from('local-archive'),
    });
    expect(await fs.readFile(localOut, 'utf8')).toBe('local-archive');

    let sshArchive = '';
    const transport = fakeTransportManager(async (_command, options) => {
      sshArchive = options?.stdinData?.toString('utf8') ?? '';
      return { exit_code: 0, signal: null, stdout: '', stderr: '' };
    });
    const executor = createSSHRuntimeHostExecutor(transport.manager, {
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'key_agent',
      connect_timeout_seconds: 15,
    }, { credentialScope: 'environment-a' });
    await executor.run(['docker', 'exec', '-i', 'dev', 'sh'], {
      stdinData: Buffer.from('ssh-archive'),
    });
    expect(sshArchive).toBe('ssh-archive');
    await executor.release();
  });

  it('keeps SSH host command stderr as diagnostics instead of the visible summary', async () => {
    const transport = fakeTransportManager(async () => ({
      exit_code: 255,
      signal: null,
      stdout: '',
      stderr: 'ssh: Could not resolve hostname dify\n',
    }));
    const executor = createSSHRuntimeHostExecutor(transport.manager, {
      ssh_destination: 'dify',
      ssh_port: null,
      auth_mode: 'key_agent',
      connect_timeout_seconds: 15,
    }, { credentialScope: 'environment-dify' });

    try {
      await executor.run(['docker', 'ps']);
      throw new Error('expected host command failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DesktopOperationFailureError);
      const failure = (error as DesktopOperationFailureError).presentation;
      expect(failure.summary).toBe('SSH command on "dify" failed.');
      expect(failure.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          channel: 'stderr',
          text: 'ssh: Could not resolve hostname dify',
        }),
      ]));
    } finally {
      await executor.release();
    }
  });
});
