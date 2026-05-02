import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDesktopSSHConfigHosts } from './sshConfigHosts';

async function makeHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ssh-config-'));
  await fs.mkdir(path.join(home, '.ssh', 'config.d'), { recursive: true });
  return home;
}

describe('sshConfigHosts', () => {
  it('loads concrete SSH config hosts with user, host name, and port metadata', async () => {
    const home = await makeHome();
    const configPath = path.join(home, '.ssh', 'config');
    await fs.writeFile(path.join(home, '.ssh', 'config.d', 'team.conf'), [
      'Host bastion',
      '  HostName bastion.internal',
      '  User root',
      '  Port 2200',
      '',
    ].join('\n'));
    await fs.writeFile(configPath, [
      'Include config.d/*.conf',
      'Host devbox wild-* !blocked',
      '  HostName devbox.internal',
      '  User ops',
      '  Port 2222',
      'Host db prod-db',
      '  HostName db.internal',
      '  User data',
      'Host bad-port',
      '  HostName bad.internal',
      '  Port not-a-number',
      '',
    ].join('\n'));

    await expect(loadDesktopSSHConfigHosts({ homeDir: home, configPath })).resolves.toEqual([
      {
        alias: 'bad-port',
        host_name: 'bad.internal',
        user: '',
        port: null,
        source_path: configPath,
      },
      {
        alias: 'bastion',
        host_name: 'bastion.internal',
        user: 'root',
        port: 2200,
        source_path: path.join(home, '.ssh', 'config.d', 'team.conf'),
      },
      {
        alias: 'db',
        host_name: 'db.internal',
        user: 'data',
        port: null,
        source_path: configPath,
      },
      {
        alias: 'devbox',
        host_name: 'devbox.internal',
        user: 'ops',
        port: 2222,
        source_path: configPath,
      },
      {
        alias: 'prod-db',
        host_name: 'db.internal',
        user: 'data',
        port: null,
        source_path: configPath,
      },
    ]);
  });

  it('keeps include recursion and file limits bounded', async () => {
    const home = await makeHome();
    const configPath = path.join(home, '.ssh', 'config');
    const includedPath = path.join(home, '.ssh', 'loop.conf');
    await fs.writeFile(configPath, [
      'Include loop.conf',
      'Host main-host',
      '  HostName main.internal',
      '',
    ].join('\n'));
    await fs.writeFile(includedPath, [
      'Include config',
      'Host included-host',
      '  HostName included.internal',
      '',
    ].join('\n'));

    const hosts = await loadDesktopSSHConfigHosts({
      homeDir: home,
      configPath,
      maxFiles: 2,
      maxIncludeDepth: 2,
    });

    expect(hosts.map((host) => host.alias)).toEqual(['included-host', 'main-host']);
  });
});
