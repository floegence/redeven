import type { FlowerComputerManagement } from '../src/contracts/flowerSurfaceContracts';

// Both product carriers use the same authenticated Runtime boundary.
export function computerManagementAdapter(request: <T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) => Promise<T>): FlowerComputerManagement {
  const path = '/_redeven_proxy/api/ai/computer';
  return {
    revealTarget: async (threadID, targetID) => { await request('POST', `${path}/reveal`, { thread_id: threadID, target_id: targetID }); },
    listCandidates: threadID => request('GET', `${path}/candidates?thread_id=${encodeURIComponent(threadID)}`),
    selectCandidate: (threadID, candidateRef) => request('POST', `${path}/select`, { thread_id: threadID, candidate_ref: candidateRef }),
    listManagedProfiles: () => request('GET', `${path}/managed/profiles`),
    createManagedProfile: name => request('POST', `${path}/managed/profiles`, { name }),
    listManagedTabs: profileID => request('GET', `${path}/managed/tabs?profile_id=${encodeURIComponent(profileID)}`),
    disconnectBrowser: async targetID => { await request('POST', `${path}/disconnect`, { target_id: targetID }); },
    setupExtension: () => request('POST', `${path}/extension/setup`),
    listExtensionProfiles: () => request('GET', `${path}/extension/profiles`),
    listExtensionTabs: (profileID) => request('GET', `${path}/extension/tabs?profile_id=${encodeURIComponent(profileID)}`),
    listTargets: () => request('GET', `${path}/targets`),
    listBrowserTabs: (cdpURL) => request('POST', `${path}/tabs`, { cdp_url: cdpURL }),
    loadAccess: (threadID) => request('GET', `${path}/access?thread_id=${encodeURIComponent(threadID)}`),
    saveAccess: async (threadID, access) => { await request('PUT', `${path}/access?thread_id=${encodeURIComponent(threadID)}`, access); },
    loadTarget: (threadID) => request('GET', `${path}/target?thread_id=${encodeURIComponent(threadID)}`),
    selectTarget: async (threadID, targetID) => { await request('PUT', `${path}/target`, { thread_id: threadID, target_id: targetID }); },
  };
}
