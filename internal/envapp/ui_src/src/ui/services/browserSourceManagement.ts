import { browserInstallationForSession } from '../../../../../flower_ui/host/browserInstallationController';
import { browserPackageBridge } from '../../../../../flower_ui/host/browserPackageBridge';
import { remoteBrowserPreparation } from '../../../../../flower_ui/host/remoteBrowserPreparation';
import type { FlowerComputerManagement } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { fetchSessionJSON } from './sessionHTTP';
import type { BrowserSourceService } from './browserSourceContract';

export function browserSourceManagement(environment: string, revealApplication?: (applicationID: string) => void) {
  const request = <T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal): Promise<T> =>
    fetchSessionJSON(path, { method, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const desktop = browserPackageBridge();
  const installation = browserInstallationForSession(`environment:${environment}`, request, desktop);
  return {
    browserDesktopAvailable: Boolean(desktop),
    subscribeBrowserInstallation: listener => installation.subscribe(listener),
    loadBrowserInstallation: () => installation.load(),
    saveBrowserEnabled: enabled => installation.setEnabled(enabled),
    installBrowser: input => installation.install(input),
    setupExtension: installationID => request('POST', '/_redeven_proxy/api/browser/extension/setup', { installation_id: installationID }),
    openExtension: (action, installationID) => request('POST', '/_redeven_proxy/api/browser/extension/open', { action, installation_id: installationID }),
    loadExtensionStatus: () => request('GET', '/_redeven_proxy/api/browser/extension/status'),
    prepareRemoteBrowser: revealApplication ? remoteBrowserPreparation(request, revealApplication) : undefined,
  } satisfies Pick<FlowerComputerManagement, 'browserDesktopAvailable' | 'subscribeBrowserInstallation' | 'loadBrowserInstallation' | 'saveBrowserEnabled' | 'installBrowser' | 'setupExtension' | 'openExtension' | 'loadExtensionStatus' | 'prepareRemoteBrowser'>;
}

export function browserSourceService(environment: string, revealApplication?: (applicationID: string) => void): BrowserSourceService {
  const api = <T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> => fetchSessionJSON(`/_redeven_proxy/api/browser/${path}`, {
    method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  });
  return {
    management: browserSourceManagement(environment, revealApplication),
    preference: signal => api('preference', signal),
    profiles: signal => api('profiles', signal),
    createProfile: (name, signal) => api('profiles', signal, { name }),
    status: signal => api('extension/status', signal),
    tabs: (profile, signal) => api(`extension/tabs?profile_id=${encodeURIComponent(profile)}`, signal),
    discover: (endpoint, signal) => api('connections/cdp', signal, { endpoint }),
  };
}
