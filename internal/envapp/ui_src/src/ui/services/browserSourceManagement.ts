import { browserInstallationForSession } from '../../../../../flower_ui/host/browserInstallationController';
import { browserPackageBridge } from '../../../../../flower_ui/host/browserPackageBridge';
import type { FlowerComputerManagement } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { fetchSessionJSON } from './sessionHTTP';
import type { BrowserSourceService } from './browserSourceContract';

export function browserSourceManagement(environment: string) {
  const request = <T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> =>
    fetchSessionJSON(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const desktop = browserPackageBridge();
  const installation = browserInstallationForSession(`environment:${environment}`, request, desktop);
  return {
    browserDesktopAvailable: Boolean(desktop),
    subscribeBrowserInstallation: listener => installation.subscribe(listener),
    loadBrowserInstallation: () => installation.load(),
    saveBrowserEnabled: enabled => installation.setEnabled(enabled),
    installBrowser: input => installation.install(input),
    setupExtension: () => request('POST', '/_redeven_proxy/api/browser/extension/setup'),
    openExtension: action => request('POST', '/_redeven_proxy/api/browser/extension/open', { action }),
    loadExtensionStatus: () => request('GET', '/_redeven_proxy/api/browser/extension/status'),
  } satisfies Pick<FlowerComputerManagement, 'browserDesktopAvailable' | 'subscribeBrowserInstallation' | 'loadBrowserInstallation' | 'saveBrowserEnabled' | 'installBrowser' | 'setupExtension' | 'openExtension' | 'loadExtensionStatus'>;
}

export function browserSourceService(environment: string): BrowserSourceService {
  const api = <T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> => fetchSessionJSON(`/_redeven_proxy/api/browser/${path}`, {
    method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
  });
  return {
    management: browserSourceManagement(environment),
    profiles: signal => api('profiles', signal),
    createProfile: (name, signal) => api('profiles', signal, { name }),
    status: signal => api('extension/status', signal),
    tabs: (profile, signal) => api(`extension/tabs?profile_id=${encodeURIComponent(profile)}`, signal),
    discover: (endpoint, signal) => api('connections/cdp', signal, { endpoint }),
  };
}
