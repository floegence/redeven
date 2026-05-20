import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DesktopHostCommandNotFoundError,
  desktopHostCommandEnvironment,
  desktopHostCommandSearchPaths,
  resolveDesktopHostCommand,
} from './desktopHostCommand';

async function writeExecutable(dir: string, name: string): Promise<string> {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return filePath;
}

describe('desktopHostCommand', () => {
  it('resolves host commands from the process PATH first', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-command-path-'));
    const dockerPath = await writeExecutable(tempDir, 'docker');

    expect(resolveDesktopHostCommand('docker', {
      env: { PATH: tempDir },
      platform: 'darwin',
      defaultSearchPaths: [],
    })).toEqual({
      command: dockerPath,
      source: 'process_path',
      searched_paths: [tempDir],
    });
  });

  it('uses Desktop macOS default command paths when LaunchServices provides a short PATH', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-command-default-'));
    const dockerPath = await writeExecutable(tempDir, 'docker');

    expect(resolveDesktopHostCommand('docker', {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      platform: 'darwin',
      defaultSearchPaths: [tempDir],
    })).toEqual({
      command: dockerPath,
      source: 'desktop_default_path',
      searched_paths: ['/usr/bin', '/bin', '/usr/sbin', '/sbin', tempDir],
    });
  });

  it('reports a structured host command error when the executable is unavailable', () => {
    expect(() => resolveDesktopHostCommand('docker', {
      env: { PATH: '' },
      platform: 'darwin',
      defaultSearchPaths: [],
    })).toThrow(DesktopHostCommandNotFoundError);

    try {
      resolveDesktopHostCommand('docker', {
        env: { PATH: '' },
        platform: 'darwin',
        defaultSearchPaths: [],
      });
    } catch (error) {
      expect(error).toMatchObject({
        name: 'DesktopHostCommandNotFoundError',
        command_name: 'docker',
        searched_paths: [],
        message: 'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.',
      });
    }
  });

  it('builds a child process PATH with process paths before Desktop defaults', () => {
    const env = desktopHostCommandEnvironment({
      PATH: '/usr/bin:/bin',
    }, 'darwin');

    expect(desktopHostCommandSearchPaths(env, 'darwin').slice(0, 4)).toEqual([
      '/usr/bin',
      '/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]);
  });
});
