import { describe, expect, it, vi } from 'vitest';

import {
  decodeDesktopWSLCommandOutput,
  discoverDesktopWSLDistributions,
  probeDesktopWSLDistribution,
  type DesktopWSLCommandRunner,
} from './desktopWSL';

function utf16(value: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')]);
}

describe('desktopWSL', () => {
  it('decodes both UTF-16LE and UTF-8 command output', () => {
    expect(decodeDesktopWSLCommandOutput(utf16('Ubuntu\r\nDebian\r\n'))).toBe('Ubuntu\r\nDebian\r\n');
    expect(decodeDesktopWSLCommandOutput(Buffer.from('Ubuntu\n', 'utf8'))).toBe('Ubuntu\n');
  });

  it('discovers multiple distributions without depending on localized state labels', async () => {
    const run = vi.fn<DesktopWSLCommandRunner>(async (args) => {
      const key = args.join(' ');
      if (key === '--list --quiet') {
        return { stdout: utf16('Ubuntu 24.04\r\nDebian\r\nLegacy Dev\r\n'), stderr: Buffer.alloc(0) };
      }
      if (key === '--list --verbose') {
        return {
          stdout: utf16('  NAME                 STATE             VERSION\r\n* Ubuntu 24.04         Wird ausgeführt    2\r\n  Debian               Beendet            2\r\n  Legacy Dev           Beendet            1\r\n'),
          stderr: Buffer.alloc(0),
        };
      }
      return { stdout: utf16('Ubuntu 24.04\r\n'), stderr: Buffer.alloc(0) };
    });

    await expect(discoverDesktopWSLDistributions(run)).resolves.toEqual({
      availability: 'ready',
      distributions: [
        { distribution_name: 'Ubuntu 24.04', wsl_version: 2, state: 'running', registration_status: 'eligible' },
        { distribution_name: 'Debian', wsl_version: 2, state: 'stopped', registration_status: 'eligible' },
        { distribution_name: 'Legacy Dev', wsl_version: 1, state: 'stopped', registration_status: 'wsl1_unsupported' },
      ],
    });
  });

  it('probes the default Linux user and passes distribution names only as argv', async () => {
    const run = vi.fn<DesktopWSLCommandRunner>(async (args) => {
      const command = args.slice(args.indexOf('--exec') + 1);
      if (command[0] === 'id') return { stdout: Buffer.from('dev\n'), stderr: Buffer.alloc(0) };
      if (command[0] === 'uname' && command[1] === '-s') return { stdout: Buffer.from('Linux\n'), stderr: Buffer.alloc(0) };
      if (command[0] === 'uname' && command[1] === '-m') return { stdout: Buffer.from('x86_64\n'), stderr: Buffer.alloc(0) };
      if (command[0] === 'sh' && command[2]?.startsWith('printf')) return { stdout: Buffer.from('/home/dev\n'), stderr: Buffer.alloc(0) };
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    const probe = await probeDesktopWSLDistribution('Ubuntu 24.04; echo unsafe', run);

    expect(probe).toMatchObject({
      distribution_name: 'Ubuntu 24.04; echo unsafe',
      linux_user: 'dev',
      linux_home: '/home/dev',
      architecture: 'amd64',
      missing_commands: [],
    });
    expect(run.mock.calls.every(([args]) => (
      args[0] === '--distribution'
      && args[1] === 'Ubuntu 24.04; echo unsafe'
      && args[2] === '--exec'
    ))).toBe(true);
  });

  it('reports missing managed Runtime and reinstall commands before registration', async () => {
    const run = vi.fn<DesktopWSLCommandRunner>(async (args) => {
      const command = args.slice(args.indexOf('--exec') + 1);
      if (command[0] === 'id') return { stdout: Buffer.from('dev\n'), stderr: Buffer.alloc(0) };
      if (command[0] === 'uname' && command[1] === '-s') return { stdout: Buffer.from('Linux\n'), stderr: Buffer.alloc(0) };
      if (command[0] === 'uname' && command[1] === '-m') return { stdout: Buffer.from('x86_64\n'), stderr: Buffer.alloc(0) };
      if (command[0] === 'sh' && command[2]?.startsWith('printf')) return { stdout: Buffer.from('/home/dev\n'), stderr: Buffer.alloc(0) };
      return { stdout: Buffer.from('sha256sum\nsort\n'), stderr: Buffer.alloc(0) };
    });

    await expect(probeDesktopWSLDistribution('Ubuntu', run)).resolves.toMatchObject({
      missing_commands: ['sha256sum', 'sort'],
    });
  });
});
