import { describe, expect, it } from 'vitest';

import {
  DESKTOP_PROVIDER_CATALOG_STALE_AFTER_MS,
  desktopProviderCatalogFreshness,
  desktopProviderEnvironmentAvailability,
  desktopProviderOnlineEnvironmentCount,
  desktopProviderRemoteRouteState,
} from './providerEnvironmentState';

describe('providerEnvironmentState', () => {
  it('derives online, offline, and unknown availability from provider runtime fields', () => {
    expect(desktopProviderEnvironmentAvailability('online', 'ready', 'active')).toBe('online');
    expect(desktopProviderEnvironmentAvailability('offline', 'offline', 'suspended')).toBe('offline');
    expect(desktopProviderEnvironmentAvailability('', '', '')).toBe('unknown');
  });

  it('counts provider environments that are currently online', () => {
    expect(desktopProviderOnlineEnvironmentCount([
      {
        status: 'online',
        lifecycle_status: 'active',
      },
      {
        status: 'ready',
        lifecycle_status: 'ready',
      },
      {
        status: 'offline',
        lifecycle_status: 'suspended',
      },
      {
        status: '',
        lifecycle_status: '',
      },
    ])).toBe(2);
  });

  it('marks provider catalogs as fresh, stale, or unknown', () => {
    const now = 100_000;
    expect(desktopProviderCatalogFreshness(0, { now })).toBe('unknown');
    expect(desktopProviderCatalogFreshness(now - 1_000, { now })).toBe('fresh');
    expect(desktopProviderCatalogFreshness(now - DESKTOP_PROVIDER_CATALOG_STALE_AFTER_MS - 1, { now })).toBe('stale');
  });

  it('derives remote route state from sync state, freshness, and provider status', () => {
    const now = 50_000;
    expect(desktopProviderRemoteRouteState({
      syncState: 'ready',
      environmentPresent: true,
      providerStatus: 'online',
      providerLifecycleStatus: 'active',
      lastSyncedAtMS: now,
      now,
    })).toBe('ready');
    expect(desktopProviderRemoteRouteState({
      syncState: 'ready',
      environmentPresent: true,
      providerStatus: 'offline',
      providerLifecycleStatus: 'suspended',
      lastSyncedAtMS: now,
      now,
    })).toBe('offline');
    expect(desktopProviderRemoteRouteState({
      syncState: 'ready',
      environmentPresent: false,
      lastSyncedAtMS: now,
      now,
    })).toBe('removed');
    expect(desktopProviderRemoteRouteState({
      syncState: 'ready',
      environmentPresent: true,
      providerStatus: 'online',
      providerLifecycleStatus: 'active',
      lastSyncedAtMS: 1,
      now,
    })).toBe('stale');
    expect(desktopProviderRemoteRouteState({
      syncState: 'auth_required',
      environmentPresent: true,
      providerStatus: 'online',
      providerLifecycleStatus: 'active',
      lastSyncedAtMS: now,
      now,
    })).toBe('auth_required');
    expect(desktopProviderRemoteRouteState({
      syncState: 'provider_unreachable',
      environmentPresent: true,
      providerStatus: 'online',
      providerLifecycleStatus: 'active',
      lastSyncedAtMS: now,
      now,
    })).toBe('provider_unreachable');
  });
});
