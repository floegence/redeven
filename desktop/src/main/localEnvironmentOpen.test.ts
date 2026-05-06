import { describe, expect, it } from 'vitest';

import { resolveLocalEnvironmentOpenTarget } from './localEnvironmentOpen';
import {
  testProviderBoundLocalEnvironment,
} from '../testSupport/desktopTestHelpers';

describe('localEnvironmentOpen', () => {
  it('uses the preferred remote route when both local hosting and remote desktop are available', () => {
    const environment = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
      preferredOpenRoute: 'remote_desktop',
    });

    expect(resolveLocalEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'remote_desktop',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    });
  });

  it('falls back to remote desktop when local hosting exists but the provider only returned a remote session', () => {
    const environment = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');

    expect(resolveLocalEnvironmentOpenTarget(environment, {
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'remote_desktop',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    });
  });

  it('uses local host for linked-local projections when a bootstrap ticket is available', () => {
    const environment = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');

    expect(resolveLocalEnvironmentOpenTarget(environment, {
      bootstrap_ticket: 'ticket-123',
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    })).toEqual({
      route: 'local_host',
      bootstrap_ticket: 'ticket-123',
    });
  });

  it('rejects explicit local opens when the provider did not return a bootstrap ticket', () => {
    const environment = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');

    expect(() => resolveLocalEnvironmentOpenTarget(environment, {
      remote_session_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
    }, 'local_host')).toThrow('Desktop could not obtain a local host bootstrap ticket for this environment.');
  });

  it('fails instead of silently remote-opening when neither route has credentials', () => {
    const environment = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');

    expect(() => resolveLocalEnvironmentOpenTarget(environment, {})).toThrow(
      'Desktop could not obtain a local host bootstrap ticket for this environment.',
    );
  });
});
