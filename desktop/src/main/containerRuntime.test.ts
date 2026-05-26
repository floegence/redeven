import { describe, expect, it } from 'vitest';

import {
  containerInspectCommand,
  containerListCommand,
  containerRuntimePlatformProbeCommand,
  containerRuntimeProbeCommand,
  containerRuntimeDaemonStartCommand,
  containerRuntimeDaemonStatusCommand,
  containerRuntimeDaemonStopCommand,
  containerRuntimeExecCommand,
  containerRuntimeUploadedInstallCommand,
  parseContainerListOutput,
  parseContainerInspectJSON,
  parseContainerPlatformProbeOutput,
  resolveRuntimeContainerPlacement,
  type DesktopRuntimeContainerResolver,
} from './containerRuntime';
import { DesktopHostCommandNotFoundError } from './desktopHostCommand';

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
      container_ref: 'dev-container',
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
      container_ref: 'web',
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
        container_ref: 'api',
        container_label: 'api',
        image: 'api:local',
        status_text: 'Up 1 hour',
      },
      {
        engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
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
    const probeCommand = containerRuntimeProbeCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_root: '/root/.redeven',
      runtime_release_tag: 'v1.2.3',
    });
    expect(probeCommand).toEqual(expect.arrayContaining([
      'redeven-container-runtime-probe',
      '/root/.redeven',
      'v1.2.3',
    ]));
    expect(probeCommand.join('\n')).toContain('runtime/managed');
    expect(probeCommand.join('\n')).toContain('managed-runtime.stamp');
    expect(probeCommand.join('\n')).toContain('slot_release_tag=');
    expect(probeCommand.join('\n')).toContain('reported_release_tag=');
    expect(probeCommand.join('\n')).toContain('target_release_tag=');
    expect(probeCommand.join('\n')).toContain('runtime/releases');
    expect(probeCommand.join('\n')).not.toContain('runtime/releases/${runtime_release_tag}');
    expect(probeCommand.join('\n')).not.toContain('runtime/releases/${target_release_tag}');
    expect(probeCommand.join('\n')).not.toContain('runtime/releases/${release_tag}');
    const installCommand = containerRuntimeUploadedInstallCommand({
      engine: 'podman',
      container_id: 'dev',
      runtime_root: '/root/.redeven',
      runtime_release_tag: 'v1.2.3',
    });
    expect(installCommand).toEqual(expect.arrayContaining([
      'podman',
      'exec',
      '-i',
      'dev',
      'redeven-container-upload-driver',
      '/root/.redeven',
      'v1.2.3',
    ]));
    expect(installCommand.join('\n')).toContain('cat > "$archive_path"');
    expect(installCommand.join('\n')).toContain('write_runtime_stamp "desktop_upload"');
    expect(installCommand.join('\n')).toContain('runtime/managed');
    expect(installCommand.join('\n')).toContain('managed-runtime.stamp');
    expect(installCommand.join('\n')).toContain('schema_version=2');
    expect(installCommand.join('\n')).toContain('slot_release_tag=');
    expect(installCommand.join('\n')).toContain('installed_at_unix_ms=');
    expect(installCommand.join('\n')).toContain('staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"');
    expect(installCommand.join('\n')).toContain('if [ "$staged_release_tag" != "$target_release_tag" ]; then');
    expect(installCommand.join('\n')).toContain('switch_staged_runtime');
    expect(installCommand.join('\n')).toContain('if mv "$staging_root" "$managed_root"; then');
    expect(installCommand.join('\n')).not.toContain('mv "$temp_binary" "$binary"');
    expect(installCommand.join('\n')).toContain('runtime/releases');
    expect(installCommand.join('\n')).not.toContain('release_root="${runtime_root%/}/runtime/releases');
    expect(installCommand.join('\n')).not.toContain('runtime/releases/${runtime_release_tag}');
    expect(installCommand.join('\n')).not.toContain('runtime/releases/${target_release_tag}');
    expect(installCommand.join('\n')).not.toContain('runtime/releases/${release_tag}');
  });

  it('builds daemon lifecycle commands separately from bridge attach', () => {
    expect(containerRuntimeDaemonStartCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      runtime_root: '/root/.redeven',
      desktop_owner_id: 'desktop-owner',
    })).toEqual([
      'docker',
      'exec',
      '-d',
      '--env',
      'REDEVEN_DESKTOP_OWNER_ID=desktop-owner',
      'dev',
      '/root/.redeven/runtime/managed/bin/redeven',
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--presentation',
      'machine',
      '--state-root',
      '/root/.redeven',
      '--local-ui-bind',
      '127.0.0.1:0',
    ]);
    expect(containerRuntimeDaemonStatusCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      runtime_root: '/root/.redeven',
    })).toEqual([
      'docker',
      'exec',
      '-i',
      'dev',
      '/root/.redeven/runtime/managed/bin/redeven',
      'desktop-runtime-status',
      '--state-root',
      '/root/.redeven',
    ]);
    expect(containerRuntimeDaemonStopCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      runtime_root: '/root/.redeven',
    })).toEqual([
      'docker',
      'exec',
      '-i',
      'dev',
      '/root/.redeven/runtime/managed/bin/redeven',
      'desktop-runtime-stop',
      '--state-root',
      '/root/.redeven',
    ]);
  });

  it('keeps daemon stop scoped to the runtime process and pairs with status verification', () => {
    const stopCommand = containerRuntimeDaemonStopCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      runtime_root: '/root/.redeven',
    });
    const statusCommand = containerRuntimeDaemonStatusCommand({
      engine: 'docker',
      container_id: 'dev',
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      runtime_root: '/root/.redeven',
    });

    expect(stopCommand).toEqual([
      'docker',
      'exec',
      '-i',
      'dev',
      '/root/.redeven/runtime/managed/bin/redeven',
      'desktop-runtime-stop',
      '--state-root',
      '/root/.redeven',
    ]);
    expect(statusCommand).toEqual([
      'docker',
      'exec',
      '-i',
      'dev',
      '/root/.redeven/runtime/managed/bin/redeven',
      'desktop-runtime-status',
      '--state-root',
      '/root/.redeven',
    ]);
    expect(stopCommand.join(' ')).not.toContain('docker stop');
    expect(stopCommand.join(' ')).not.toContain('podman stop');
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

  it('resolves rebuilt running containers through their stable reference', async () => {
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => {
        throw new Error('No such object: old-container-id');
      },
      listRunning: async () => [
        {
          engine: 'docker',
          container_id: 'new-container-id',
          container_ref: 'redeven-nginx-dev',
          container_label: 'redeven-nginx-dev',
          image: 'nginx:latest',
          status_text: 'Up 5 seconds',
        },
      ],
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-container-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toMatchObject({
      status: 'running',
      changed: true,
      placement: {
        container_id: 'new-container-id',
        container_ref: 'redeven-nginx-dev',
        container_label: 'redeven-nginx-dev',
      },
    });
  });

  it('uses structured host command diagnostics when recovering stale container ids', async () => {
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => {
        throw Object.assign(new Error('Desktop could not run the runtime host command on this device.'), {
          presentation: {
            diagnostics: [
              { text: 'exit code 1' },
              { text: 'Error: No such object: old-container-id' },
            ],
          },
        });
      },
      listRunning: async () => [
        {
          engine: 'docker',
          container_id: 'new-container-id',
          container_ref: 'redeven-nginx-dev',
          container_label: 'redeven-nginx-dev',
          image: 'nginx:latest',
          status_text: 'Up 5 seconds',
        },
      ],
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-container-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toMatchObject({
      status: 'running',
      changed: true,
      placement: {
        container_id: 'new-container-id',
      },
    });
  });

  it('does not accept a stale concrete id when it conflicts with the stable reference', async () => {
    const inspected = {
      engine: 'docker' as const,
      container_id: 'stale-container-id',
      container_ref: 'unrelated-container',
      container_label: 'unrelated-container',
      status: 'running' as const,
    };
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => inspected,
      listRunning: async () => [
        {
          ...inspected,
          image: 'busybox:latest',
          status_text: 'Up 1 minute',
        },
        {
          engine: 'docker',
          container_id: 'expected-container-id',
          container_ref: 'redeven-nginx-dev',
          container_label: 'redeven-nginx-dev',
          image: 'nginx:latest',
          status_text: 'Up 5 seconds',
        },
      ],
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'stale-container-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toMatchObject({
      status: 'running',
      placement: {
        container_id: 'expected-container-id',
      },
    });
  });

  it('reports unavailable container resolution precisely', async () => {
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => {
        throw new Error('No such object: old-container-id');
      },
      listRunning: async () => [],
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-container-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toEqual({
      status: 'missing',
      message: 'Container redeven-nginx-dev was not found. Choose a running container, then try again.',
    });
  });

  it('reports a missing local Docker CLI instead of treating the container as missing', async () => {
    let listed = false;
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => {
        throw new DesktopHostCommandNotFoundError('docker', ['/usr/bin', '/bin']);
      },
      listRunning: async () => {
        listed = true;
        return [];
      },
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-container-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toEqual({
      status: 'command_not_found',
      message: 'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.',
    });
    expect(listed).toBe(false);
  });

  it('does not collapse container engine failures into container-missing guidance', async () => {
    let listed = false;
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => {
        throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock.');
      },
      listRunning: async () => {
        listed = true;
        return [];
      },
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-container-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toEqual({
      status: 'engine_unavailable',
      message: 'Docker is unavailable. Make sure Docker is running and the docker CLI can reach it, then refresh and try again.',
    });
    expect(listed).toBe(false);
  });

  it('does not use arbitrary container-name prefixes as id matches', async () => {
    const resolver: DesktopRuntimeContainerResolver = {
      inspect: async () => {
        throw new Error('No such object: redeven');
      },
      listRunning: async () => [
        {
          engine: 'docker',
          container_id: 'redevenabcdef123456',
          container_ref: 'api',
          container_label: 'api',
          image: 'api:local',
          status_text: 'Up 1 minute',
        },
      ],
    };

    await expect(resolveRuntimeContainerPlacement(resolver, {
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-container-id',
      container_ref: 'redeven',
      container_label: 'redeven',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream',
    })).resolves.toMatchObject({
      status: 'missing',
    });
  });
});
