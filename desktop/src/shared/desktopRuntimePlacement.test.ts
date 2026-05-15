import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeTargetID,
  normalizeDesktopRuntimeHostAccess,
  normalizeDesktopRuntimePlacement,
} from './desktopRuntimePlacement';

describe('desktopRuntimePlacement', () => {
  it('normalizes local and SSH host access separately from placement', () => {
    expect(normalizeDesktopRuntimeHostAccess({ kind: 'local_host' })).toEqual({ kind: 'local_host' });
    expect(normalizeDesktopRuntimeHostAccess({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: ' devbox ',
        ssh_port: '2222',
        auth_mode: 'key_agent',
        remote_install_dir: '/opt/redeven',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: '',
      },
    })).toMatchObject({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: 2222,
        remote_install_dir: '/opt/redeven',
      },
    });
  });

  it('normalizes container placement using stable container ids instead of display names', () => {
    expect(normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'Docker',
      container_id: ' abc123 ',
      container_label: ' dev-container ',
      runtime_root: ' /workspace/.redeven ',
    })).toEqual({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'abc123',
      container_label: 'dev-container',
      runtime_root: '/workspace/.redeven',
      bridge_strategy: 'exec_stream',
    });
  });

  it('builds stable target ids from host access and placement', () => {
    const localHost = normalizeDesktopRuntimeHostAccess({ kind: 'local_host' });
    const sshHost = normalizeDesktopRuntimeHostAccess({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'root@gzcom',
        ssh_port: '',
        auth_mode: 'key_agent',
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'auto',
        release_base_url: '',
      },
    });
    const container = normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'podman',
      container_id: 'container-stable-id',
      container_label: 'renamable-label',
      runtime_root: '/var/lib/redeven/runtime',
    });

    expect(desktopRuntimeTargetID(localHost, { kind: 'host_process', install_dir: '' }, 'local')).toBe('local:host:local');
    expect(desktopRuntimeTargetID(localHost, container)).toMatch(/^local:container:podman:container-stable-id:/u);
    expect(desktopRuntimeTargetID(sshHost, container)).toMatch(/^ssh:container:root%40gzcom:podman:container-stable-id:/u);
  });

  it('rejects malformed container placement instead of falling back', () => {
    expect(() => normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'lxc',
      container_id: 'abc123',
      runtime_root: '/runtime',
    })).toThrow('Container engine');
    expect(() => normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: '',
      runtime_root: '/runtime',
    })).toThrow('Container ID');
  });
});
