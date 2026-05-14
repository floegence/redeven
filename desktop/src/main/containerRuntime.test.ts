import { describe, expect, it } from 'vitest';

import {
  containerInspectCommand,
  containerRuntimeExecCommand,
  parseContainerInspectJSON,
} from './containerRuntime';

describe('containerRuntime', () => {
  it('parses Docker inspect records into stable container facts', () => {
    expect(parseContainerInspectJSON('docker', JSON.stringify([{
      Id: 'container-stable-id',
      Name: '/dev-container',
      State: { Running: true, Status: 'running' },
      Config: {
        Labels: {
          'com.redeven.desktop.managed_by': 'redeven-desktop',
        },
      },
    }]))).toEqual({
      engine: 'docker',
      container_id: 'container-stable-id',
      container_label: 'dev-container',
      owner: 'desktop',
      status: 'running',
    });
  });

  it('parses Podman stopped external containers without taking ownership', () => {
    expect(parseContainerInspectJSON('podman', JSON.stringify({
      Id: 'podman-stable-id',
      Name: 'web',
      State: { Running: false, Status: 'exited' },
      Config: { Labels: {} },
    }))).toEqual({
      engine: 'podman',
      container_id: 'podman-stable-id',
      container_label: 'web',
      owner: 'external',
      status: 'stopped',
    });
  });

  it('builds explicit inspect and exec commands without relying on published ports', () => {
    expect(containerInspectCommand('docker', 'dev-container')).toEqual([
      'docker',
      'inspect',
      'dev-container',
    ]);
    expect(containerRuntimeExecCommand({
      engine: 'podman',
      container_id: 'podman-stable-id',
      argv: ['redeven', 'desktop-bridge'],
    })).toEqual([
      'podman',
      'exec',
      '-i',
      'podman-stable-id',
      'redeven',
      'desktop-bridge',
    ]);
  });

  it('rejects malformed command inputs instead of falling back', () => {
    expect(() => containerInspectCommand('docker', '')).toThrow('Container reference');
    expect(() => containerRuntimeExecCommand({
      engine: 'docker',
      container_id: '',
      argv: ['redeven'],
    })).toThrow('Container ID');
    expect(() => containerRuntimeExecCommand({
      engine: 'docker',
      container_id: 'container-stable-id',
      argv: [],
    })).toThrow('argv');
  });
});
