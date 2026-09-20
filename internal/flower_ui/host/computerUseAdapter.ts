import type { FlowerComputerManagement } from '../src/contracts/flowerSurfaceContracts';

// Both product carriers use the same authenticated Runtime boundary.
export function computerManagementAdapter(request: <T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<T>): FlowerComputerManagement {
  const path = '/_redeven_proxy/api/ai/computer';
  return {
    loadEnvironment: () => request('GET', `${path}/environment`),
    discoverBrowser: (threadID, cdpURL) => request('POST', `${path}/candidates`, { thread_id: threadID, cdp_url: cdpURL }),
    revealTarget: async (threadID, targetID) => { await request('POST', `${path}/reveal`, { thread_id: threadID, target_id: targetID }); },
    listCandidates: threadID => request('GET', `${path}/candidates?thread_id=${encodeURIComponent(threadID)}`),
    selectCandidate: (threadID, candidateRef) => request('POST', `${path}/select`, { thread_id: threadID, candidate_ref: candidateRef }),
    listManagedProfiles: () => request('GET', `${path}/managed/profiles`),
    createManagedProfile: name => request('POST', `${path}/managed/profiles`, { name }),
    openExtension: action => request('POST', `${path}/extension/open`, { action }),
    setupExtension: () => request('POST', `${path}/extension/setup`),
    loadExtensionStatus: () => request('GET', `${path}/extension/status`),
    loadAccess: (threadID) => request('GET', `${path}/access?thread_id=${encodeURIComponent(threadID)}`),
    saveAccess: async (threadID, access) => { await request('PUT', `${path}/access?thread_id=${encodeURIComponent(threadID)}`, access); },
  };
}
