import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeContainerReference,
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

  it('normalizes container placement with a stable container reference', () => {
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
      container_ref: 'dev-container',
      container_label: 'dev-container',
      runtime_install_root: '/workspace/.redeven',
      runtime_state_root: '/workspace/.redeven',
      bridge_strategy: 'exec_stream',
    });
  });

  it('falls back to legacy container ids when no stable reference is stored', () => {
    const placement = normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'abc123',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_state_root: '/var/lib/redeven',
    });

    expect(placement).toMatchObject({
      container_id: 'abc123',
      container_ref: 'abc123',
      container_label: 'abc123',
    });
    expect(placement.kind).toBe('container_process');
    if (placement.kind === 'container_process') {
      expect(desktopRuntimeContainerReference(placement)).toBe('abc123');
    }
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
      container_ref: 'dev-container',
      container_label: 'renamable-label',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_state_root: '/var/lib/redeven',
    });

    expect(desktopRuntimeTargetID(localHost, { kind: 'host_process', install_dir: '' }, 'local')).toBe('local:host:local');
    expect(desktopRuntimeTargetID(localHost, container)).toMatch(/^local:container:podman:dev-container:/u);
    expect(desktopRuntimeTargetID(sshHost, container)).toMatch(/^ssh:container:root%40gzcom:podman:dev-container:/u);
  });

  it('keeps container target ids stable when concrete container ids change', () => {
    const localHost = normalizeDesktopRuntimeHostAccess({ kind: 'local_host' });
    const firstPlacement = normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'old-concrete-id',
      container_ref: 'redeven-nginx-dev',
      container_label: 'redeven-nginx-dev',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_state_root: '/var/lib/redeven',
    });
    const rebuiltPlacement = normalizeDesktopRuntimePlacement({
      ...firstPlacement,
      container_id: 'new-concrete-id',
    });

    expect(desktopRuntimeTargetID(localHost, rebuiltPlacement)).toBe(desktopRuntimeTargetID(localHost, firstPlacement));
  });

  it('rejects malformed container placement instead of falling back', () => {
    expect(() => normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'lxc',
      container_id: 'abc123',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_state_root: '/var/lib/redeven',
    })).toThrow('Container engine');
    expect(() => normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: '',
      runtime_install_root: '/opt/redeven-desktop/runtime',
      runtime_state_root: '/var/lib/redeven',
    })).toThrow('Container ID');
  });
});
