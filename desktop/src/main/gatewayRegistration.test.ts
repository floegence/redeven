import { describe, expect, it } from 'vitest';
import { normalizeDesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';
import { gatewayConnectionFromSetup } from './gatewayRegistration';

const ssh = { kind: 'ssh_host', ssh: { ssh_destination: 'dev@bastion', ssh_port: 2222, auth_mode: 'password' } };
const host = { kind: 'host_process', runtime_root: '/data/gateway' };
const container = { kind: 'container_process', runtime_root: '/data/gateway', container_engine: 'docker', container_id: 'abc', container_ref: 'office', container_label: 'Office' };

describe('explicit Gateway registration boundary', () => {
  it('rejects URL profile authorization without a pairing code', () => {
    expect(() => gatewayConnectionFromSetup({ kind: 'upsert_gateway', connection_kind: 'url',
      display_name: 'Office', gateway_url: 'https://gateway.example/', profile_write: true, allow_loopback_http: false }))
      .toThrow('pairing code');
  });
  it.each([
    ['local_host', { kind: 'local_host' }, host], ['local_container', { kind: 'local_host' }, container],
    ['ssh_host', ssh, host], ['ssh_container', ssh, container],
  ])('retains the %s service placement without a Runtime mapping', (kind, hostAccess, placement) => {
    const request = normalizeDesktopLauncherActionRequest({ kind: 'upsert_gateway', connection_kind: kind,
      gateway_id: 'office', display_name: 'Office', host_access: hostAccess, placement,
      ssh_password: ' password ', ssh_password_mode: 'replace', runtime_environment_id: 'injected-runtime',
      profile_write: true, proof: 'injected-proof', client_private_key: 'injected-key' });
    expect(request?.kind).toBe('upsert_gateway');
    if (request?.kind !== 'upsert_gateway') throw new Error('Fixture registration must normalize');
    const connection = gatewayConnectionFromSetup(request);
    expect(connection).toMatchObject({ kind, runtime_root: '/data/gateway' });
    expect(request).toMatchObject({ profile_write: true, ssh_password: ' password ' });
    expect(JSON.stringify(request)).not.toContain('injected-');
    expect(JSON.stringify(connection)).not.toContain('password ');
    expect(connection).not.toHaveProperty('runtime_state_root');
    if (String(kind).includes('container')) expect(connection).toMatchObject({ container_ref: 'office' });
  });

  it.each([
    { connection_kind: 'ssh_host', host_access: { kind: 'local_host' }, placement: host },
    { connection_kind: 'local_host', host_access: {}, placement: {} },
    { connection_kind: 'local_host', host_access: { kind: 'wsl_host', distribution_name: 'Ubuntu', linux_user: 'dev' }, placement: host },
    { connection_kind: 'local_host', host_access: { kind: 'local_host' }, placement: { ...host, runtime_state_root: '/runtime/private' } },
  ])('rejects ambiguous or cross-boundary service coordinates: %j', input => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'upsert_gateway', display_name: 'Office', ...input })).toBeNull();
  });
});
