import { observeManagedBrowserDownloads } from './computerManagedDownloads.mjs';
import { createBrowserLineage } from './computerBrowserLineage.mjs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createComputerBrowserSource, createExtensionBrowserSource } from './computerBrowserSource.mjs';

async function admittedPage(browser, tab, contextID) {
  // Runtime creation and Playwright page readiness travel through different
  // debugger sessions. Subscribe before probing, so their event ordering does
  // not turn a freshly created page into a missing target.
  let resolvePage, rejectPage;
  const ready = new Promise((resolve, reject) => { resolvePage = resolve; rejectPage = reject; });
  const seen = new Set();
  const inspect = page => {
    if (seen.has(page)) return;
    seen.add(page);
    void (async () => {
      let probe;
      try {
        probe = await page.context().newCDPSession(page);
        const { targetInfo } = await probe.send('Target.getTargetInfo');
        if (targetInfo.targetId === tab && (targetInfo.browserContextId || 'default') === contextID) resolvePage(page);
      } catch { /* A different page can close while the directory is read. */ }
      finally { await probe?.detach().catch(() => {}); }
    })();
  };
  const unavailable = () => rejectPage(new Error('BROWSER_SOURCE_UNAVAILABLE'));
  const contexts = browser.contexts();
  for (const context of contexts) context.on('page', inspect);
  browser.on('disconnected', unavailable);
  const timer = setTimeout(unavailable, 20000);
  let inventory;
  try {
    inventory = await browser.newBrowserCDPSession();
    const { targetInfo } = await inventory.send('Target.getTargetInfo', { targetId: tab });
    if (targetInfo.type !== 'page' || (targetInfo.browserContextId || 'default') !== contextID) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    for (const context of contexts) for (const page of context.pages()) inspect(page);
    return await ready;
  } finally {
    clearTimeout(timer);
    for (const context of contexts) context.off('page', inspect);
    browser.off('disconnected', unavailable);
    // Install a handler even when the exact target inventory failed first.
    void ready.catch(() => {});
    await inventory?.detach().catch(() => {});
  }
}

// One Runtime helper owns the admitted sources. Connections are shared by
// endpoint, and only exact Runtime-selected tabs become sources. Inventory,
// popups and unrelated personal pages never create projection or AI grants.
export async function createComputerBrowserHost(options) {
  const connections = new Map();
  const sources = new Map();
  const nativeSources = new Map();
  const pending = new Map();
  const retirements = new Map();
  const popupProbes = new Set();
  const directories = new Map();
  const nativeDirectories = new Map();
  const privateTargets = new Set();
  const nativeScope = 'chromium';
  const setNativeDirectory = (endpoint, ids) => {
    if (!nativeDirectories.has(endpoint) && nativeDirectories.size >= 128) throw new Error('BROWSER_SOURCE_DIRECTORY_LIMIT');
    nativeDirectories.set(endpoint, ids);
  };
  const reconcileNative = () => lineage.reconcile(nativeScope, [...nativeDirectories.values()].flatMap(ids => [...ids]));
  const nativeIdentity = id => {
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/iu.test(id)) throw new Error('BROWSER_SOURCE_IDENTITY_CHANGED');
    return id;
  };
  const lineage = createBrowserLineage(target => privateTargets.has(target));
  let closed = false;
  const isPrivate = target => [target, ...lineage.ancestors(target)].some(id => privateTargets.has(id));
  const requireSource = id => {
    const source = sources.get(id);
    if (closed || !source || source.owner.source.isClosed()) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    return source;
  };

  const connection = endpoint => {
    if (!connections.has(endpoint)) {
      const work = chromium.connectOverCDP(endpoint, { timeout: 20000, noDefaults: true }).then(async browser => {
        const directory = await browser.newBrowserCDPSession();
        directories.set(endpoint, directory);
        const inventory = new Set(); setNativeDirectory(endpoint, inventory);
        const remember = ({ targetInfo }) => {
          if (targetInfo.type !== 'page') return;
          try {
            inventory.add(nativeIdentity(targetInfo.targetId)); lineage.observe(nativeScope, targetInfo.targetId, targetInfo.openerId);
          }
          catch { void browser.close(); }
        };
        directory.on('Target.targetCreated', remember);
        directory.on('Target.targetInfoChanged', remember);
        directory.on('Target.targetDestroyed', ({ targetId }) => { inventory.delete(targetId); reconcileNative(); });
        await directory.send('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'page', exclude: false }, { exclude: true }] });
        return browser;
      });
      connections.set(endpoint, work);
      void work.then(browser => browser.on('disconnected', () => {
        connections.delete(endpoint);
        directories.delete(endpoint);
        for (const source of sources.values()) if (source.descriptor.endpoint === endpoint) retire(source);
        nativeDirectories.delete(endpoint); reconcileNative();
      }), () => { if (connections.get(endpoint) === work) { connections.delete(endpoint); directories.delete(endpoint); nativeDirectories.delete(endpoint); reconcileNative(); } });
    }
    return connections.get(endpoint);
  };
  const retire = source => {
    if (sources.get(source.id) !== source) return source.retiring;
    sources.delete(source.id);
    source.owner.source.off('close', source.onClose);
    options.onSourceClosed?.(source.id, source.descriptor.binding);
    source.retiring = source.owner.dispose().finally(() => {
      if (nativeSources.get(source.key) === source.id) nativeSources.delete(source.key);
      if (retirements.get(source.id) === source.retiring) retirements.delete(source.id);
    });
    retirements.set(source.id, source.retiring);
    // Explicit callers receive the drain error. The callback carries only the
    // target identity, never a raw debugger exception or private page content.
    void source.retiring.catch(() => options.onSourceFault?.(source.id, source.descriptor.binding));
    return source.retiring;
  };
  const attach = async descriptor => {
    const { id, endpoint, tab, context: contextID, downloadDirectory } = descriptor;
    if (closed || !id || !tab || (!descriptor.extension && (!endpoint || !contextID))) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    let extensionTransport;
    if (descriptor.extension) {
      extensionTransport = options.extensionTransport?.(descriptor.extension);
      if (!extensionTransport || extensionTransport.tabId !== tab) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    }
    const key = nativeIdentity(descriptor.extension ? (await extensionTransport.send('Target.getTargetInfo')).targetInfo.targetId : tab);
    const existing = sources.get(id);
    if (existing) {
      if (existing.key !== key || existing.descriptor.downloadDirectory !== downloadDirectory || existing.descriptor.managed !== descriptor.managed) throw new Error('BROWSER_SOURCE_IDENTITY_CHANGED');
      return id;
    }
    if (sources.size + pending.size >= 128) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    if (nativeSources.has(key)) throw new Error('BROWSER_SOURCE_ALREADY_ADMITTED');
    nativeSources.set(key, id);
    let owner;
    try {
      if (descriptor.extension) {
        const transport = extensionTransport;
        const scope = `extension:${descriptor.extensionProfile}`;
        if (typeof descriptor.extensionProfile !== 'string' || !descriptor.extensionProfile) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
        if (!nativeDirectories.has(scope)) setNativeDirectory(scope, new Set());
        nativeDirectories.get(scope).add(key);
        lineage.observe(nativeScope, key); lineage.bind(nativeScope, key, id);
        owner = await createExtensionBrowserSource(transport, id);
      } else {
      const browser = await connection(endpoint);
      // Probe identity only. The admitted page's source adapter is the sole
      // owner of debugger domains, child sessions and semantic observation.
      const selected = await admittedPage(browser, tab, contextID);
      if (!selected || closed) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
      lineage.bind(nativeScope, key, id);
      owner = await createComputerBrowserSource(selected, id, {
        captureDownloads: !descriptor.managed,
        nativeDownloads: false,
        windowViewport: descriptor.managed === true,
        onPopup: async (popup, _opener, foreground) => {
          // Only the owned managed profile has directory-wide product authority.
          // External pages remain explicitly selected. Managed popups inherit
          // their native ancestors' privacy before any view can observe them.
          if (!descriptor.managed || closed || popupProbes.size >= 16) return;
          const reservation = {}; popupProbes.add(reservation);
          let probe;
          try {
            probe = await popup.context().newCDPSession(popup);
            const { targetInfo } = await probe.send('Target.getTargetInfo');
            if (!closed && sources.has(id) && targetInfo.type === 'page'
              && (targetInfo.browserContextId || 'default') === contextID) options.onSourcePopup?.(id, targetInfo.targetId, foreground);
          } finally { await probe?.detach().catch(() => {}); popupProbes.delete(reservation); }
        },
      });
      }
      if (closed) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
      if (downloadDirectory) {
        if (!path.isAbsolute(downloadDirectory)) throw new Error('BROWSER_DOWNLOAD_DIRECTORY_INVALID');
        owner.source.transport.resolveDownload = async download => {
          if (!/^[a-f0-9-]{36}$/u.test(download)) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE');
          const filename = path.join(downloadDirectory, download);
          const stat = await lstat(filename);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE');
          return { path: filename, size_bytes: stat.size };
        };
        const stopDownloads = observeManagedBrowserDownloads(owner.source, owner.controller.page, downloadDirectory);
        const dispose = owner.dispose;
        owner.dispose = async () => { stopDownloads(); await dispose(); };
      }
      const source = { id, key, descriptor: { ...descriptor }, owner, onClose: undefined, retiring: undefined, busy: false };
      source.onClose = () => { void retire(source); };
      owner.source.on('close', source.onClose);
      sources.set(id, source);
      return id;
    } catch (error) {
      nativeSources.delete(key);
      await owner?.dispose();
      throw error;
    }
  };

  return {
    ready(id) {
      const source = requireSource(id);
      if (source.owner.controller.page.invalid) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    },
    admit(descriptor) {
      // Repeated admission waits on the exact same descriptor; an alias or
      // changed identity cannot attach another debugger during startup.
      const previous = pending.get(descriptor.id);
      if (previous) {
        if (JSON.stringify(previous.descriptor) !== JSON.stringify(descriptor)) return Promise.reject(new Error('BROWSER_SOURCE_IDENTITY_CHANGED'));
        return previous.work;
      }
      const work = attach(descriptor);
      pending.set(descriptor.id, { descriptor: { ...descriptor }, work });
      void work.finally(() => pending.delete(descriptor.id)).catch(() => {});
      return work;
    },
    async tool(id, request) {
      const source = requireSource(id);
      const provenance = { id: request.id, target_id: source.id, execution_location: source.descriptor.managed ? `${process.platform}_headless_browser` : 'connected_browser' };
      if (request.target_id && request.target_id !== source.id) throw new Error('BROWSER_SOURCE_IDENTITY_CHANGED');
      if (source.busy || isPrivate(id) && request.user_control !== true && request.recovery_observation !== true) return { ...provenance, error: 'TARGET_IN_USE' };
      source.busy = true;
      let completed;
      const task = { cancelled: false, done: new Promise(resolve => { completed = resolve; }) };
      source.toolTask = task;
      try {
        // Only a Runtime command admitted through its target gate reaches here.
        // This changes navigation authority, never thread/run ownership.
        if (request.recovery_observation === true) await source.owner.prepareRecoveryObservation();
        else await source.owner.setUserBrowsing(false);
        if (task.cancelled) throw new Error('BROWSER_TOOL_CANCELLED');
        return { ...provenance, ...await source.owner.controller.execute(request) };
      } finally { source.busy = false; source.toolTask = undefined; completed(); }
    },
    async cancel(id) {
      const source = requireSource(id);
      const task = source.toolTask;
      if (!task) return;
      task.cancelled = true;
      source.owner.controller.cancel();
      await task.done;
    },
    privacy(id, privateMode) {
      requireSource(id);
      if (privateMode) privateTargets.add(id);
      else privateTargets.delete(id);
      lineage.refresh();
    },
    async remove(id) {
      const source = sources.get(id);
      if (!source) return retirements.get(id);
      source.owner.controller.cancel();
      await retire(source);
    },
    async publicInventory(endpoint, tabs) {
      const extension = endpoint.startsWith('extension:');
      const live = new Set();
      for (const tab of tabs) {
        const id = nativeIdentity(extension ? tab.native_target_id : tab.id);
        const parents = extension ? tab.opener_native_target_ids ?? [] : tab.opener_tab_ids ?? (tab.opener_tab_id ? [tab.opener_tab_id] : []);
        if (!Array.isArray(parents) || parents.length > 128 || new Set([id, ...parents]).size !== parents.length + 1) throw new Error('BROWSER_SOURCE_DIRECTORY_INVALID');
        for (const parent of parents) nativeIdentity(parent);
        for (let index = parents.length - 1; index >= 0; index--) lineage.observe(nativeScope, parents[index], parents[index + 1]);
        lineage.observe(nativeScope, id, parents[0]);
        live.add(id);
      }
      setNativeDirectory(endpoint, live);
      reconcileNative();
      return tabs.map(tab => lineage.lineage(nativeScope, extension ? tab.native_target_id : tab.id).some(id => privateTargets.has(id)) ? { ...tab, title: '', url: '', private: true } : tab);
    },
    async close() {
      closed = true;
      await Promise.allSettled([...pending.values()].map(item => item.work));
      const draining = [...sources.values()].map(source => retire(source));
      const results = await Promise.allSettled(draining);
      await Promise.allSettled([...connections.values()].map(async work => (await work).close()));
      connections.clear(); nativeDirectories.clear(); privateTargets.clear();
      lineage.close();
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
}
