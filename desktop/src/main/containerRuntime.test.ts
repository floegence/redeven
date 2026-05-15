import { describe, expect, it } from 'vitest';

import {
  containerInspectCommand,
  containerListCommand,
  containerRuntimePlatformProbeCommand,
  containerRuntimeProbeCommand,
  containerRuntimeExecCommand,
  containerRuntimeUploadedInstallCommand,
  parseContainerListOutput,
  parseContainerInspectJSON,
  parseContainerPlatformProbeOutput,
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
      status: 'stopped',
    });
  });

  it('parses running container list output for picker options', () => {
    expect(parseContainerListOutput('docker', [
      JSON.stringify({
        ID: 'container-stable-id',
        Names: 'dev-container',
        Image: 'redeven-dev:latest',
        Status: 'Up 2 minutes',
      }),
      '',
      JSON.stringify({
        ID: 'other-container-id',
        Names: 'api,api-alias',
        Image: 'api:local',
        Status: 'Up 1 hour',
      }),
    ].join('\n'))).toEqual([
      {
        engine: 'docker',
        container_id: 'other-container-id',
        container_label: 'api',
        image: 'api:local',
        status_text: 'Up 1 hour',
      },
      {
        engine: 'docker',
        container_id: 'container-stable-id',
        container_label: 'dev-container',
        image: 'redeven-dev:latest',
        status_text: 'Up 2 minutes',
      },
    ]);
  });

  it('builds explicit inspect and exec commands without relying on published ports', () => {
    expect(containerInspectCommand('docker', 'dev-container')).toEqual([
      'docker',
      'inspect',
      'dev-container',
    ]);
    expect(containerListCommand('docker')).toEqual([
      'docker',
      'ps',
      '--no-trunc',
      '--format',
      '{{json .}}',
    ]);
    expect(containerRuntimeExecCommand({
      engine: 'podman',
      container_id: 'podman-stable-id',
      argv: ['redeven', 'desktop-bridge'],
      env: {
        REDEVEN_DESKTOP_OWNER_ID: undefined,
        'BAD-NAME': 'ignored',
      },
    })).toEqual([
      'podman',
      'exec',
      '-i',
      '--env',
      'REDEVEN_DESKTOP_OWNER_ID',
      'podman-stable-id',
      'redeven',
      'desktop-bridge',
    ]);
  });

  it('builds container bootstrap commands before bridge startup', () => {
    expect(parseContainerPlatformProbeOutput('Linux\nx86_64\n')).toMatchObject({
      platform_id: 'linux_amd64',
      release_package_name: 'redeven_linux_amd64.tar.gz',
    });
    expect(containerRuntimePlatformProbeCommand({
      engine: 'docker',
      container_id: 'dev',
    })).toEqual([
      'docker',
      'exec',
      '-i',
      'dev',
      'sh',
      '-c',
      'set -eu\nuname -s\nuname -m',
    ]);
    expect(containerRuntimeProbeCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_release_tag: 'v1.2.3',
    })).toEqual(expect.arrayContaining([
      'redeven-container-runtime-probe',
      '/opt/redeven-desktop/runtime',
      'v1.2.3',
    ]));
    const installCommand = containerRuntimeUploadedInstallCommand({
      engine: 'podman',
      container_id: 'dev',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_release_tag: 'v1.2.3',
    });
    expect(installCommand).toEqual(expect.arrayContaining([
      'podman',
      'exec',
      '-i',
      'dev',
      'redeven-container-upload-driver',
      '/opt/redeven-desktop/runtime',
      'v1.2.3',
    ]));
    expect(installCommand.join('\n')).toContain('cat > "$archive_path"');
    expect(installCommand.join('\n')).toContain('write_runtime_stamp "desktop_upload"');
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
