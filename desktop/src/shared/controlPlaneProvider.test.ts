import { describe, expect, it } from 'vitest';

import {
  normalizeControlPlaneDisplayLabel,
  normalizeControlPlaneOrigin,
  normalizeDesktopControlPlaneAccount,
  normalizeDesktopControlPlaneProvider,
  normalizeDesktopProviderEnvironmentList,
  suggestControlPlaneDisplayLabel,
} from './controlPlaneProvider';

describe('controlPlaneProvider', () => {
  it('normalizes provider origins to a stable root URL', () => {
    expect(normalizeControlPlaneOrigin(' https://cp.example.invalid/env/list?q=1#hash ')).toBe(
      'https://cp.example.invalid',
    );
    expect(normalizeControlPlaneOrigin('http://127.0.0.1:8094/base/')).toBe(
      'http://127.0.0.1:8094',
    );
  });

  it('rejects invalid provider origins', () => {
    expect(() => normalizeControlPlaneOrigin('')).toThrow('Provider URL is required.');
    expect(() => normalizeControlPlaneOrigin('cp.example.invalid')).toThrow(
      'Provider URL must be a valid absolute URL.',
    );
    expect(() => normalizeControlPlaneOrigin('ftp://cp.example.invalid')).toThrow(
      'Provider URL must start with http:// or https://.',
    );
  });

  it('derives stable local display labels from provider origins', () => {
    expect(suggestControlPlaneDisplayLabel('https://cp.example.invalid/root/path')).toBe('cp.example.invalid');
    expect(suggestControlPlaneDisplayLabel(' http://127.0.0.1:8094/desktop/connect ')).toBe('127.0.0.1');
    expect(normalizeControlPlaneDisplayLabel('', 'https://cp.example.invalid')).toBe('cp.example.invalid');
    expect(normalizeControlPlaneDisplayLabel(' Team Control Plane ', 'https://cp.example.invalid')).toBe('Team Control Plane');
  });

  it('normalizes discovery payloads', () => {
    expect(normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: ' example_control_plane ',
      display_name: ' Example Control Plane ',
      provider_origin: 'https://cp.example.invalid/root/path',
      documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
    })).toEqual({
      protocol_version: 'rcpp-v1',
      provider_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
    });
    expect(normalizeDesktopControlPlaneProvider({
      protocol_version: 'unknown',
      provider_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
    })).toBeNull();
  });

  it('normalizes provider accounts from me responses', () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
    });
    expect(provider).not.toBeNull();

    expect(normalizeDesktopControlPlaneAccount({
      user_public_id: ' user_demo ',
      user_display_name: ' Demo User ',
      authorization_expires_at_unix_ms: 1_770_000_000_000,
    }, {
      provider: provider!,
    })).toEqual({
      provider_id: 'example_control_plane',
      provider_origin: 'https://cp.example.invalid',
      display_name: 'Example Control Plane',
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: 1_770_000_000_000,
    });
  });

  it('normalizes provider environment lists while dropping malformed rows', () => {
    const provider = normalizeDesktopControlPlaneProvider({
      protocol_version: 'rcpp-v1',
      provider_id: 'example_control_plane',
      display_name: 'Example Control Plane',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
    });
    expect(provider).not.toBeNull();

    expect(normalizeDesktopProviderEnvironmentList({
      environments: [
        {
          env_public_id: ' env_123 ',
          name: ' Staging ',
          environment_url: ' https://cp.example.invalid/env/env_123 ',
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
      provider: provider!,
    })).toEqual([
      {
        provider_id: 'example_control_plane',
        provider_origin: 'https://cp.example.invalid',
        env_public_id: 'env_123',
        label: 'Staging',
        environment_url: 'https://cp.example.invalid/env/env_123',
        description: 'team sandbox',
        namespace_public_id: 'ns_demo',
        namespace_name: 'Demo Team',
        status: 'online',
        lifecycle_status: 'active',
        last_seen_at_unix_ms: 10,
      },
    ]);
  });
});
