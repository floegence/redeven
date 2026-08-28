import { describe, expect, it } from 'vitest';

import {
  isRedevenCloudOrigin,
  redevenCloudAllowedOrigins,
  REDEVEN_CLOUD_DEVELOPMENT_ORIGIN,
  REDEVEN_CLOUD_ORIGIN,
  requireRedevenCloudOrigin,
} from './redevenCloud';

describe('Redeven Cloud origin policy', () => {
  it('accepts only the official HTTPS origin in packaged builds', () => {
    const policy = { allow_development: false } as const;

    expect(redevenCloudAllowedOrigins(policy)).toEqual([REDEVEN_CLOUD_ORIGIN]);
    expect(isRedevenCloudOrigin(`${REDEVEN_CLOUD_ORIGIN}/`, policy)).toBe(true);
    expect(isRedevenCloudOrigin(REDEVEN_CLOUD_ORIGIN.replace('https:', 'http:'), policy)).toBe(false);
    expect(isRedevenCloudOrigin(`https://www.${new URL(REDEVEN_CLOUD_ORIGIN).hostname}`, policy)).toBe(false);
    expect(isRedevenCloudOrigin(REDEVEN_CLOUD_DEVELOPMENT_ORIGIN, policy)).toBe(false);
    expect(isRedevenCloudOrigin('https://cloud.example.com', policy)).toBe(false);
  });

  it('adds only the fixed test origin in development builds', () => {
    const policy = { allow_development: true } as const;

    expect(redevenCloudAllowedOrigins(policy)).toEqual([
      REDEVEN_CLOUD_ORIGIN,
      REDEVEN_CLOUD_DEVELOPMENT_ORIGIN,
    ]);
    expect(requireRedevenCloudOrigin('https://redeven.test/path', policy)).toBe(REDEVEN_CLOUD_DEVELOPMENT_ORIGIN);
    expect(() => requireRedevenCloudOrigin('https://custom.redeven.test', policy))
      .toThrow('Redeven Desktop supports Redeven Cloud only.');
  });
});
