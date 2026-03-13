import { describe, expect, it } from 'vitest';

import {
  derivePortalBaseDomainFromSandboxBaseDomain,
  portalOriginFromSandboxLocation,
  trustedLauncherOriginFromSandboxLocation,
} from './sandboxOrigins';

describe('sandboxOrigins', () => {
  it('maps sandbox base domains back to the portal base domain', () => {
    expect(derivePortalBaseDomainFromSandboxBaseDomain('redeven-sandbox.test')).toBe('redeven.test');
    expect(derivePortalBaseDomainFromSandboxBaseDomain('redeven-sandbox.test')).toBe('redeven.test');
  });

  it('maps sandbox origins back to the regional portal origin', () => {
    expect(
      portalOriginFromSandboxLocation({
        protocol: 'https:',
        hostname: 'env-demo.dev.redeven-sandbox.test',
        port: '',
      }),
    ).toBe('https://dev.redeven.test');
  });

  it('preserves explicit ports when deriving the portal origin', () => {
    expect(
      portalOriginFromSandboxLocation({
        protocol: 'https:',
        hostname: 'env-demo.dev.redeven-sandbox.test',
        port: '8443',
      }),
    ).toBe('https://dev.redeven.test:8443');
  });

  it('derives other trusted launcher origins from the current sandbox origin', () => {
    expect(
      trustedLauncherOriginFromSandboxLocation(
        {
          protocol: 'https:',
          hostname: 'env-demo.dev.redeven-sandbox.test',
          port: '',
        },
        'cs',
        'space123',
      ),
    ).toBe('https://cs-space123.dev.redeven-sandbox.test');

    expect(
      trustedLauncherOriginFromSandboxLocation(
        {
          protocol: 'https:',
          hostname: 'env-demo.dev.redeven-sandbox.test',
          port: '8443',
        },
        'pf',
        'forward123',
      ),
    ).toBe('https://pf-forward123.dev.redeven-sandbox.test:8443');
  });

  it('rejects invalid sandbox hosts', () => {
    expect(() =>
      portalOriginFromSandboxLocation({
        protocol: 'https:',
        hostname: 'env-demo.dev.redeven.test',
        port: '',
      }),
    ).toThrow('Invalid sandbox base domain');
  });
});
