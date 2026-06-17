import { describe, expect, it } from 'vitest';

import {
  normalizeControlPlaneDisplayLabel,
  normalizeControlPlaneOrigin,
  normalizeDesktopControlPlaneAccount,
  normalizeDesktopControlPlaneProvider,
  normalizeDesktopProviderEnvironmentList,
  suggestControlPlaneDisplayLabel,
} from './controlPlaneProvider';

function accessPoint(overrides: Record<string, unknown> = {}) {
  return {
    access_point_id: 'dev',
    region: 'dev',
    display_name: 'Development',
    description: 'Development access point',
    access_point_origin: 'https://dev.redeven.test',
    country_code: 'SG',
    city: 'Singapore',
    status: 'active',
    health_status: 'healthy',
    ...overrides,
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: 'rcpp-v2',
    provider_id: 'example_control_plane',
    display_name: 'Example Control Plane',
    provider_origin: 'https://redeven.test',
    documentation_url: 'https://redeven.test/help/control-plane-providers',
    access_points: [accessPoint()],
    ...overrides,
  };
}

describe('controlPlaneProvider', () => {
  it('normalizes provider origins to a stable root URL', () => {
    expect(normalizeControlPlaneOrigin(' https://provider.example.invalid/env/list?q=1#hash ')).toBe(
      'https://provider.example.invalid',
    );
    expect(normalizeControlPlaneOrigin('http://127.0.0.1:8094/base/')).toBe(
      'http://127.0.0.1:8094',
    );
  });

  it('rejects invalid provider origins', () => {
    expect(() => normalizeControlPlaneOrigin('')).toThrow('Provider URL is required.');
    expect(() => normalizeControlPlaneOrigin('provider.example.invalid')).toThrow(
      'Provider URL must be a valid absolute URL.',
    );
    expect(() => normalizeControlPlaneOrigin('ftp://provider.example.invalid')).toThrow(
      'Provider URL must start with http:// or https://.',
    );
  });

  it('derives stable local display labels from provider origins', () => {
    expect(suggestControlPlaneDisplayLabel('https://provider.example.invalid/root/path')).toBe('provider.example.invalid');
    expect(suggestControlPlaneDisplayLabel(' http://127.0.0.1:8094/desktop/connect ')).toBe('127.0.0.1');
    expect(normalizeControlPlaneDisplayLabel('', 'https://provider.example.invalid')).toBe('provider.example.invalid');
    expect(normalizeControlPlaneDisplayLabel(' Team Control Plane ', 'https://provider.example.invalid')).toBe('Team Control Plane');
  });

  it('normalizes discovery payloads', () => {
    expect(normalizeDesktopControlPlaneProvider(provider({
      provider_id: ' example_control_plane ',
      display_name: ' Example Control Plane ',
      provider_origin: 'https://redeven.test/root/path',
      access_points: [accessPoint({
        access_point_origin: 'https://dev.redeven.test/root/path',
      })],
    }))).toEqual({
      protocol_version: 'rcpp-v2',
      provider_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      provider_origin: 'https://redeven.test',
      documentation_url: 'https://redeven.test/help/control-plane-providers',
      access_points: [{
        access_point_id: 'dev',
        region: 'dev',
        display_name: 'Development',
        description: 'Development access point',
        access_point_origin: 'https://dev.redeven.test',
        country_code: 'SG',
        city: 'Singapore',
        status: 'active',
        health_status: 'healthy',
      }],
    });
    expect(normalizeDesktopControlPlaneProvider(provider({
      protocol_version: 'unknown',
    }))).toBeNull();
  });

  it('normalizes provider accounts from me responses', () => {
    const normalizedProvider = normalizeDesktopControlPlaneProvider(provider());
    expect(normalizedProvider).not.toBeNull();

    expect(normalizeDesktopControlPlaneAccount({
      user_public_id: ' user_demo ',
      user_display_name: ' Demo User ',
      authorization_expires_at_unix_ms: 1_770_000_000_000,
    }, {
      provider: normalizedProvider!,
    })).toEqual({
      provider_id: 'example_control_plane',
      provider_origin: 'https://redeven.test',
      display_name: 'Example Control Plane',
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: 1_770_000_000_000,
    });
  });

  it('normalizes provider environment lists while dropping malformed rows', () => {
    const normalizedProvider = normalizeDesktopControlPlaneProvider(provider());
    expect(normalizedProvider).not.toBeNull();

    expect(normalizeDesktopProviderEnvironmentList({
      environments: [
        {
          env_public_id: ' env_123 ',
          name: ' Staging ',
          region: 'dev',
          access_point_id: 'dev',
          access_point_origin: ' https://dev.redeven.test/path ',
          environment_url: ' https://dev.redeven.test/env/env_123 ',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 10,
        },
        {
          env_public_id: '',
          name: 'Broken',
        },
      ],
    }, {
      provider: normalizedProvider!,
    })).toEqual([
      {
        provider_id: 'example_control_plane',
        provider_origin: 'https://redeven.test',
        env_public_id: 'env_123',
        region: 'dev',
        access_point_id: 'dev',
        access_point_origin: 'https://dev.redeven.test',
        label: 'Staging',
        environment_url: 'https://dev.redeven.test/env/env_123',
        description: 'team sandbox',
        namespace_public_id: 'ns_demo',
        namespace_name: 'Demo Team',
        status: 'online',
        lifecycle_status: 'active',
        last_seen_at_unix_ms: 10,
      },
    ]);
  });

  it('allows access point ids and regions to differ when normalizing provider payloads', () => {
    expect(normalizeDesktopControlPlaneProvider(provider({
      access_points: [accessPoint({
        access_point_id: 'sg-edge',
        region: 'sg',
      })],
    }))).toEqual(expect.objectContaining({
      access_points: [
        expect.objectContaining({
          access_point_id: 'sg-edge',
          region: 'sg',
        }),
      ],
    }));

    const normalizedProvider = normalizeDesktopControlPlaneProvider(provider());
    expect(normalizedProvider).not.toBeNull();
    expect(normalizeDesktopProviderEnvironmentList({
      environments: [{
        env_public_id: 'env_123',
        name: 'Staging',
        region: 'sg',
        access_point_id: 'sg-edge',
        access_point_origin: 'https://sg.redeven.test',
      }],
    }, {
      provider: normalizedProvider!,
    })).toEqual([
      expect.objectContaining({
        region: 'sg',
        access_point_id: 'sg-edge',
      }),
    ]);
  });
});
