import type { ProviderDesktopOpenSession } from './controlPlaneProviderClient';
import type { DesktopLocalEnvironmentStateSessionRoute } from './desktopTarget';
import {
  localEnvironmentDefaultOpenRoute,
  localEnvironmentSupportsLocalHosting,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';

export type ResolvedManagedEnvironmentOpenTarget = Readonly<
  | {
      route: 'local_host';
      bootstrap_ticket: string;
    }
  | {
      route: 'remote_desktop';
      remote_session_url: string;
    }
>;

type ManagedEnvironmentOpenSession = Readonly<Pick<ProviderDesktopOpenSession, 'bootstrap_ticket' | 'remote_session_url'>>;

export function resolveManagedEnvironmentOpenTarget(
  environment: DesktopLocalEnvironmentState,
  openSession: ManagedEnvironmentOpenSession,
  requestedRoute: 'auto' | DesktopLocalEnvironmentStateSessionRoute = 'auto',
): ResolvedManagedEnvironmentOpenTarget {
  if (requestedRoute === 'local_host') {
    if (!localEnvironmentSupportsLocalHosting(environment)) {
      throw new Error('This environment is not hosted on this device.');
    }
    if (!openSession.bootstrap_ticket) {
      throw new Error('Desktop could not obtain a local host bootstrap ticket for this environment.');
    }
    return {
      route: 'local_host',
      bootstrap_ticket: openSession.bootstrap_ticket,
    };
  }

  if (requestedRoute === 'remote_desktop') {
    if (!openSession.remote_session_url) {
      throw new Error('Remote desktop access is unavailable for this environment.');
    }
    return {
      route: 'remote_desktop',
      remote_session_url: openSession.remote_session_url,
    };
  }

  const defaultRoute = localEnvironmentDefaultOpenRoute(environment);
  if (
    defaultRoute === 'local_host'
    && localEnvironmentSupportsLocalHosting(environment)
    && openSession.bootstrap_ticket
  ) {
    return {
      route: 'local_host',
      bootstrap_ticket: openSession.bootstrap_ticket,
    };
  }
  if (defaultRoute === 'remote_desktop' && openSession.remote_session_url) {
    return {
      route: 'remote_desktop',
      remote_session_url: openSession.remote_session_url,
    };
  }
  if (localEnvironmentSupportsLocalHosting(environment) && openSession.bootstrap_ticket) {
    return {
      route: 'local_host',
      bootstrap_ticket: openSession.bootstrap_ticket,
    };
  }
  if (openSession.remote_session_url) {
    return {
      route: 'remote_desktop',
      remote_session_url: openSession.remote_session_url,
    };
  }
  if (localEnvironmentSupportsLocalHosting(environment)) {
    throw new Error('Desktop could not obtain a local host bootstrap ticket for this environment.');
  }
  throw new Error('Remote desktop access is unavailable for this environment.');
}
