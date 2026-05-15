import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createLocalRuntimeHostExecutor,
  createSSHRuntimeHostExecutor,
} from './runtimeHostAccess';

describe('runtimeHostAccess', () => {
  it('describes local host access without placement details', () => {
    expect(createLocalRuntimeHostExecutor().host_access).toEqual({ kind: 'local_host' });
  });

  it('describes SSH host access separately from runtime placement', () => {
    const executor = createSSHRuntimeHostExecutor({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      remote_install_dir: '/opt/redeven',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
      connect_timeout_seconds: 15,
    });

    expect(executor.host_access).toMatchObject({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: 2222,
      },
    });
  });

  it('passes explicit bridge environment variables to the remote SSH command', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-test-'));
    const argsPath = path.join(tempDir, 'ssh-args.json');
    const fakeSSH = path.join(tempDir, 'ssh');
    await fs.writeFile(fakeSSH, [
      '#!/usr/bin/env bash',
      `node -e "require('node:fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))" ${JSON.stringify(argsPath)} "$@"`,
    ].join('\n'), { mode: 0o755 });

    const executor = createSSHRuntimeHostExecutor({
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'key_agent',
      remote_install_dir: '/opt/redeven',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
      connect_timeout_seconds: 15,
    }, { sshBinary: fakeSSH });
    await executor.run(['docker', 'exec', '-i', 'dev', 'redeven', 'desktop-bridge'], {
      env: {
        REDEVEN_DESKTOP_OWNER_ID: 'desktop-owner',
        'BAD-NAME': 'ignored',
      },
    });
    const args = JSON.parse(await fs.readFile(argsPath, 'utf8')) as string[];

    expect(args.at(-1)).toBe(
      "env REDEVEN_DESKTOP_OWNER_ID='desktop-owner' 'docker' 'exec' '-i' 'dev' 'redeven' 'desktop-bridge'",
    );
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

    const sshOut = path.join(tempDir, 'ssh.bin');
    const fakeSSH = path.join(tempDir, 'ssh');
    await fs.writeFile(fakeSSH, [
      '#!/usr/bin/env bash',
      `cat > ${JSON.stringify(sshOut)}`,
    ].join('\n'), { mode: 0o755 });
    const executor = createSSHRuntimeHostExecutor({
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'key_agent',
      remote_install_dir: '/opt/redeven',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
      connect_timeout_seconds: 15,
    }, { sshBinary: fakeSSH });
    await executor.run(['docker', 'exec', '-i', 'dev', 'sh'], {
      stdinData: Buffer.from('ssh-archive'),
    });
    expect(await fs.readFile(sshOut, 'utf8')).toBe('ssh-archive');
  });
});
