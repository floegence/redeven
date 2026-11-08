import { BrowserInstallationController, browserInstallationForSession } from './browserInstallationController';
import { remoteBrowserPreparation } from './remoteBrowserPreparation';
import { browserPackageBridge } from './browserPackageBridge';
import type { FlowerComputerManagement } from '../src/contracts/flowerSurfaceContracts';

// Both product carriers use the same authenticated Runtime boundary.
export function computerManagementAdapter(request: <T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, signal?: AbortSignal) => Promise<T>, sessionKey?: string, revealApplication?: (applicationID: string) => void, transferRequest = request): FlowerComputerManagement {
  const path = '/_redeven_proxy/api/ai/computer';
  const desktop = browserPackageBridge();
  const browser = sessionKey ? browserInstallationForSession(sessionKey, request, desktop) : new BrowserInstallationController(request, desktop);
  return {
    prepareRemoteBrowser: revealApplication ? remoteBrowserPreparation(request, revealApplication) : undefined,
    browserDesktopAvailable: Boolean(desktop),
    subscribeBrowserInstallation: listener => browser.subscribe(listener),
    loadBrowserInstallation: () => browser.load(request),
    saveBrowserEnabled: enabled => browser.setEnabled(enabled, request),
    // IMPORTANT: Admission belongs to the current panel grant; an admitted
    // transfer belongs to the exact environment, not the panel visibility.
    installBrowser: async body => { await request('GET', '/_redeven_proxy/api/browser/installation'); return browser.install(body, transferRequest); },
    loadEnvironment: () => request('GET', `${path}/environment`),
    verifyDesktop: () => request('POST', `${path}/desktop/verify`, {}),
    discoverBrowser: (threadID, cdpURL) => request('POST', `${path}/candidates`, { thread_id: threadID, cdp_url: cdpURL }),
    revealTarget: async (threadID, targetID) => { await request('POST', `${path}/reveal`, { thread_id: threadID, target_id: targetID }); },
    listCandidates: threadID => request('GET', `${path}/candidates?thread_id=${encodeURIComponent(threadID)}`),
    selectCandidate: (threadID, candidateRef) => request('POST', `${path}/select`, { thread_id: threadID, candidate_ref: candidateRef }),
    listManagedProfiles: () => request('GET', `${path}/managed/profiles`),
    createManagedProfile: name => request('POST', `${path}/managed/profiles`, { name }),
    manageBrowserProfile: (profileID, action) => request('POST', path + '/managed/lifecycle', { profile_id: profileID, action }),
    openExtension: (action, installationID) => request('POST', `${path}/extension/open`, { action, installation_id: installationID }),
    setupExtension: installationID => request('POST', `${path}/extension/setup`, { installation_id: installationID }),
    loadExtensionStatus: () => request('GET', `${path}/extension/status`),
    loadAccess: (threadID) => request('GET', `${path}/access?thread_id=${encodeURIComponent(threadID)}`),
    saveAccess: async (threadID, access) => { await request('PUT', `${path}/access?thread_id=${encodeURIComponent(threadID)}`, access); },
  };
}
