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
      },
    })).toMatchObject({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: 2222,
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
      runtime_root: '/workspace/.redeven',
      bridge_strategy: 'exec_stream',
    });
  });

  it('uses the concrete container id as the stable reference when no label is stored', () => {
    const placement = normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: 'abc123',
      runtime_root: '/root/.redeven',
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
      },
    });
    const container = normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'podman',
      container_id: 'container-stable-id',
      container_ref: 'dev-container',
      container_label: 'renamable-label',
      runtime_root: '/root/.redeven',
    });

    expect(desktopRuntimeTargetID(localHost, { kind: 'host_process', runtime_root: '' }, 'local')).toBe('local:host:local');
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
      runtime_root: '/root/.redeven',
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
      runtime_root: '/root/.redeven',
    })).toThrow('Container engine');
    expect(() => normalizeDesktopRuntimePlacement({
      kind: 'container_process',
      container_engine: 'docker',
      container_id: '',
      runtime_root: '/root/.redeven',
    })).toThrow('Container ID');
  });
});
