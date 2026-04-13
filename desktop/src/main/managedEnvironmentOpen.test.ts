import { describe, expect, it } from 'vitest';

import { resolveManagedEnvironmentOpenTarget } from './managedEnvironmentOpen';
import {
  testManagedControlPlaneEnvironment,
} from '../testSupport/desktopTestHelpers';

describe('managedEnvironmentOpen', () => {
  it('uses the preferred remote route when both local hosting and remote desktop are available', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      preferredOpenRoute: 'remote_desktop',
    });

    expect(resolveManagedEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'remote_desktop',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    });
  });

  it('falls back to remote desktop when local hosting exists but the provider only returned a remote session', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');

    expect(resolveManagedEnvironmentOpenTarget(environment, {
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'remote_desktop',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    });
  });

  it('opens remote desktop for control-plane environments that are not hosted on this device', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });

    expect(resolveManagedEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'remote_desktop',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    });
  });

  it('rejects explicit local opens for environments that are not hosted on this device', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });

    expect(() => resolveManagedEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    }, 'local_host')).toThrow('This environment is not hosted on this device.');
  });

  it('fails instead of silently local-starting an unhosted environment when remote desktop is unavailable', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });

    expect(() => resolveManagedEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
    })).toThrow('Remote desktop access is unavailable for this environment.');
  });
});
