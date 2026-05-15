import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL,
  normalizeDesktopRuntimeContainerListRequest,
  normalizeDesktopRuntimeContainerListResponse,
} from './desktopContainerRuntime';

describe('desktopContainerRuntime', () => {
  it('normalizes container-list IPC requests by host access and engine', () => {
    expect(DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL).toBe('redeven-desktop:launcher-list-runtime-containers');
    expect(normalizeDesktopRuntimeContainerListRequest({
      host_access: { kind: 'local_host' },
      engine: ' Docker ',
    })).toEqual({
      host_access: { kind: 'local_host' },
      engine: 'docker',
    });
    expect(normalizeDesktopRuntimeContainerListRequest({
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: ' devbox ',
          ssh_port: '2222',
          auth_mode: 'key_agent',
          remote_install_dir: 'remote_default',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
        },
      },
      engine: 'podman',
    })).toMatchObject({
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: 'devbox',
          ssh_port: 2222,
        },
      },
      engine: 'podman',
    });
    expect(normalizeDesktopRuntimeContainerListRequest({
      host_access: { kind: 'local_host' },
      engine: 'lxc',
    })).toBeNull();
  });

  it('normalizes container-list IPC responses without leaking malformed rows', () => {
    expect(normalizeDesktopRuntimeContainerListResponse({
      ok: true,
      containers: [
        {
          engine: ' Docker ',
          container_id: ' container-stable-id ',
          container_label: ' Dev Container ',
          image: ' redeven-dev:latest ',
          status_text: ' Up 2 minutes ',
        },
        {
          engine: 'lxc',
          container_id: 'bad',
        },
        {
          engine: 'podman',
          container_id: '',
        },
      ],
    })).toEqual({
      ok: true,
      containers: [
        {
          engine: 'docker',
          container_id: 'container-stable-id',
          container_label: 'Dev Container',
          image: 'redeven-dev:latest',
          status_text: 'Up 2 minutes',
        },
      ],
    });
    expect(normalizeDesktopRuntimeContainerListResponse({
      ok: false,
      message: ' docker is not available ',
    })).toEqual({
      ok: false,
      message: 'docker is not available',
    });
  });
});
