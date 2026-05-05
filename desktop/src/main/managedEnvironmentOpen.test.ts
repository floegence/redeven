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

  it('uses local host for provider-local projections when a bootstrap ticket is available', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');

    expect(resolveManagedEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'local_host',
      bootstrap_ticket: 'ticket-123',
    });
  });

  it('rejects explicit local opens when the provider did not return a bootstrap ticket', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');

    expect(() => resolveManagedEnvironmentOpenTarget(environment, {
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    }, 'local_host')).toThrow('Desktop could not obtain a local host bootstrap ticket for this environment.');
  });

  it('fails instead of silently remote-opening when neither route has credentials', () => {
    const environment = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');

    expect(() => resolveManagedEnvironmentOpenTarget(environment, {})).toThrow(
      'Desktop could not obtain a local host bootstrap ticket for this environment.',
    );
  });
});
