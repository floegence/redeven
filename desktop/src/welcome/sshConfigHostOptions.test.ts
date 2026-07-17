import { describe, expect, it } from 'vitest';

import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';
import { filterAndRankSSHConfigHosts, sshConfigHostEndpointLabel } from './sshConfigHostOptions';

function host(
  alias: string,
  overrides: Partial<DesktopSSHConfigHost> = {},
): DesktopSSHConfigHost {
  return {
    alias,
    host_name: `${alias}.internal`,
    user: 'ops',
    port: null,
    source_path: '/Users/tester/.ssh/config',
    ...overrides,
  };
}

describe('sshConfigHostOptions', () => {
  it('keeps every concrete host visible when the destination is blank', () => {
    const hosts = Array.from({ length: 23 }, (_, index) => host(`host-${String(23 - index).padStart(2, '0')}`));

    const result = filterAndRankSSHConfigHosts(hosts, '');

    expect(result).toHaveLength(23);
    expect(result.map((candidate) => candidate.alias)).toEqual(
      Array.from({ length: 23 }, (_, index) => `host-${String(index + 1).padStart(2, '0')}`),
    );
  });

  it('ranks exact, prefix, substring, and metadata matches in that order', () => {
    const hosts = [
      host('team-gpu'),
      host('gpu-prod'),
      host('gpu'),
      host('build', { host_name: 'gpu.internal' }),
      host('database', { user: 'gpu-admin' }),
      host('port-only', { user: '', port: 2222 }),
    ];

    expect(filterAndRankSSHConfigHosts(hosts, 'gpu').map((candidate) => candidate.alias)).toEqual([
      'gpu',
      'gpu-prod',
      'team-gpu',
      'build',
      'database',
    ]);
    expect(filterAndRankSSHConfigHosts(hosts, '2222').map((candidate) => candidate.alias)).toEqual([
      'port-only',
    ]);
  });

  it('uses alias ordering to keep equal-rank search results stable', () => {
    const hosts = [host('zeta', { host_name: 'shared.internal' }), host('alpha', { host_name: 'shared.internal' })];

    expect(filterAndRankSSHConfigHosts(hosts, 'shared').map((candidate) => candidate.alias)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('formats the effective endpoint without changing the selectable alias', () => {
    expect(sshConfigHostEndpointLabel(host('prod', {
      host_name: 'prod.internal',
      user: 'deploy',
    }))).toBe('deploy@prod.internal');
    expect(sshConfigHostEndpointLabel(host('direct', {
      host_name: '',
      user: '',
    }))).toBe('direct');
  });
});
