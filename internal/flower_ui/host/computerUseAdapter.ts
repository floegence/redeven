import { BrowserInstallationController, browserInstallationForSession } from './browserInstallationController';
import { browserPackageBridge } from './browserPackageBridge';
import type { FlowerComputerManagement } from '../src/contracts/flowerSurfaceContracts';

// Both product carriers use the same authenticated Runtime boundary.
export function computerManagementAdapter(request: <T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<T>, sessionKey?: string): FlowerComputerManagement {
  const path = '/_redeven_proxy/api/ai/computer';
  const desktop = browserPackageBridge();
  const browser = sessionKey ? browserInstallationForSession(sessionKey, request, desktop) : new BrowserInstallationController(request, desktop);
  return {
    browserDesktopAvailable: Boolean(desktop),
    subscribeBrowserInstallation: listener => browser.subscribe(listener),
    loadBrowserInstallation: () => browser.load(),
    saveBrowserEnabled: enabled => browser.setEnabled(enabled),
    installBrowser: body => browser.install(body),
    loadEnvironment: () => request('GET', `${path}/environment`),
    discoverBrowser: (threadID, cdpURL) => request('POST', `${path}/candidates`, { thread_id: threadID, cdp_url: cdpURL }),
    revealTarget: async (threadID, targetID) => { await request('POST', `${path}/reveal`, { thread_id: threadID, target_id: targetID }); },
    listCandidates: threadID => request('GET', `${path}/candidates?thread_id=${encodeURIComponent(threadID)}`),
    selectCandidate: (threadID, candidateRef) => request('POST', `${path}/select`, { thread_id: threadID, candidate_ref: candidateRef }),
    listManagedProfiles: () => request('GET', `${path}/managed/profiles`),
    createManagedProfile: name => request('POST', `${path}/managed/profiles`, { name }),
    openExtension: (action, installationID) => request('POST', `${path}/extension/open`, { action, installation_id: installationID }),
    setupExtension: installationID => request('POST', `${path}/extension/setup`, { installation_id: installationID }),
    loadExtensionStatus: () => request('GET', `${path}/extension/status`),
    loadAccess: (threadID) => request('GET', `${path}/access?thread_id=${encodeURIComponent(threadID)}`),
    saveAccess: async (threadID, access) => { await request('PUT', `${path}/access?thread_id=${encodeURIComponent(threadID)}`, access); },
  };
}
