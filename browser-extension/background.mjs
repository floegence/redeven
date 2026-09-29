import { createBrowserLineage } from './computerBrowserLineage.mjs';
import { restoreDiscardedTab } from './tabLifecycle.mjs';
const bindings = new Map();
let native;
let profile;
let nativeName = '';
let lastError = '';
let pending = new Map();
let ready = false;
let lifecycle = Promise.resolve();
const reconnectAlarm = 'redeven-native-reconnect';
const schedule = operation => {
  const result = lifecycle.then(operation);
  lifecycle = result.catch(() => {});
  return result;
};
const notifyConnectionChanged = () => {
  // A popup may be closed. Its listener reads the canonical status after the
  // current lifecycle operation; never wait for it from inside that operation.
  void chrome.runtime.sendMessage({ type: 'connection_changed' }).catch(() => {});
};

const receipts = new Map();
const sourceReceipts = new Map();
let receiptSequence = 0, receiptBytes = 0;
function postPayload(port, message, binding) {
  const bytes = new TextEncoder().encode(JSON.stringify(message)).length;
  const source = sourceReceipts.get(binding) || { bytes: 0, count: 0 };
  if (bytes > 24 * 1024 * 1024 || source.bytes + bytes > 32 * 1024 * 1024 || source.count >= 512 || receiptBytes + bytes > 64 * 1024 * 1024 || receipts.size >= 1024) {
    // Native ports have no backpressure API. Retire only the source producing
    // excess traffic; other admitted tabs retain their current native carrier.
    const entry = [...bindings].find(([, value]) => value.id === binding);
    if (entry) { targetUnavailable(entry[0], 'native_backpressure'); void chrome.debugger.detach({ tabId: entry[0] }).catch(() => {}); }
    return false;
  }
  const sequence = ++receiptSequence;
  receipts.set(sequence, { bytes, binding }); receiptBytes += bytes;
  source.bytes += bytes; source.count++; sourceReceipts.set(binding, source);
  port.postMessage({ ...message, sequence }); return true;
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  const binding = bindings.get(source.tabId);
  if (!binding || !native || !ready) return;
  if (source.sessionId && !binding.children.has(source.sessionId)) return;
  if (method === 'Target.attachedToTarget') {
    if (params.targetInfo.type !== 'iframe' || binding.children.size >= 128) { void unbind(source.tabId); return; }
    binding.children.add(params.sessionId);
  }
  if (method === 'Target.detachedFromTarget') binding.children.delete(params.sessionId);
  postPayload(native, { type: 'cdp_event', binding: binding.id, tab_id: String(source.tabId), session: source.sessionId || '', method, params }, binding.id);
});
function targetUnavailable(tabId, reason = 'source_disconnected') {
  const binding = bindings.get(tabId);
  if (!binding) return;
  retireCredits(binding.id);
  bindings.delete(tabId);
  if (native && ready) native.postMessage({ type: 'target_unavailable', tab_id: String(tabId), binding: binding.id, reason });
}
chrome.debugger.onDetach.addListener((source, reason) => targetUnavailable(source.tabId, ['target_closed', 'canceled_by_user', 'replaced_with_devtools'].includes(reason) ? reason : 'debugger_detached'));
const popupLineage = createBrowserLineage(() => true);
let lineageUnavailable = false;
const nativeTargets = new Map(), closedNativeTabs = new Set();
async function rememberNativeTargets() {
  const port = native;
  let targets;
  try { targets = await chrome.debugger.getTargets(); }
  catch (error) { if (port !== native || !ready) return; throw error; }
  if (port !== native || !ready) return;
  for (const target of targets) {
    if (target.type !== 'page' || !Number.isSafeInteger(target.tabId)) continue;
    const tab = String(target.tabId);
    if (!nativeTargets.has(tab) && nativeTargets.size >= 1024) { lineageUnavailable = true; throw new Error('browser directory limit'); }
    nativeTargets.set(tab, target.id);
  }
}
// tabs.openerTabId describes tab grouping, not the window.open source. Chrome's
// navigation event supplies the actual source even for a background tab.
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  const parent = String(details.sourceTabId);
  if (!bindings.has(details.sourceTabId) && !popupLineage.nativeAncestors('profile', parent).length) return;
  const port = native;
  try { popupLineage.observe('profile', String(details.tabId), parent); void rememberNativeTargets().catch(() => { if (native === port && ready) lineageUnavailable = true; }); }
  catch { lineageUnavailable = true; }
});
chrome.tabs.onRemoved.addListener(tabId => {
  targetUnavailable(tabId, 'tab_closed');
  popupLineage.remove('profile', String(tabId));
  if (nativeTargets.has(String(tabId))) closedNativeTabs.add(String(tabId));
  for (const tab of closedNativeTabs) if (!popupLineage.contains('profile', tab)) { nativeTargets.delete(tab); closedNativeTabs.delete(tab); }
});

// Chrome owns tab identity and order. One snapshot and ordered native deltas
// feed explicitly opened workspaces; no timer discovers or reconnects pages.
let watchingTabs = false, directoryRevision = 0, directoryTabs = [], directoryWork, directoryDirty = false, directorySnapshotPending = false;
async function nativeTab(args, requireIdentity = false) {
  if (requireIdentity && (typeof args.native_target_id !== 'string' || !/^[a-f0-9]{32}$/iu.test(args.native_target_id))) throw new Error('tab identity required');
  const tab = await chrome.tabs.get(Number(args.tab_id));
  if (tab.incognito) throw new Error('private tab');
  if (args.native_target_id) {
    await rememberNativeTargets();
    if (nativeTargets.get(String(tab.id)) !== args.native_target_id) throw new Error('tab identity changed');
  }
  return tab;
}
async function inventory() {
  if (lineageUnavailable) throw new Error('browser directory unavailable');
  const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito && !(tab.url || '').startsWith(chrome.runtime.getURL('')))
    .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  if (tabs.length > 128) throw new Error('inventory limit');
  await rememberNativeTargets();
  const retained = new Set(tabs.flatMap(tab => [String(tab.id), ...popupLineage.nativeAncestors('profile', String(tab.id))]));
  for (const tab of nativeTargets.keys()) if (!retained.has(tab)) { nativeTargets.delete(tab); closedNativeTabs.delete(tab); }
  return tabs.map(tab => {
    const nativeTarget = nativeTargets.get(String(tab.id));
    if (!nativeTarget) throw new Error('refresh browser directory');
    const ancestors = popupLineage.nativeAncestors('profile', String(tab.id));
    if (ancestors.length > 128) throw new Error('browser directory depth limit');
    const url = tab.url || tab.pendingUrl || 'about:blank';
    return { id: String(tab.id), native_target_id: nativeTarget, opener_native_target_ids: ancestors.map(id => nativeTargets.get(id)).filter(Boolean), profile_id: profile.id,
      title: (tab.title || '').slice(0, 512), url, pinned: !!tab.pinned, loading: tab.status === 'loading', discarded: !!tab.discarded, frozen: !!tab.frozen, window_id: tab.windowId, index: tab.index,
      ...(!/^(https?:\/\/|about:blank$)/u.test(url) ? { availability: 'unsupported' } : {}),
      ...(ancestors.length ? { opener_tab_id: ancestors[0], opener_tab_ids: ancestors } : {}),
    };
  });
}
function queueDirectory(snapshot = false) {
  if (!watchingTabs || !ready) return Promise.resolve();
  directoryDirty = true;
  directorySnapshotPending ||= snapshot;
  if (directoryWork) return directoryWork;
  const port = native;
  const current = () => native === port && ready && watchingTabs;
  const work = (async () => {
    while (current() && directoryDirty) {
      directoryDirty = false;
      let tabs;
      try { tabs = await inventory(); }
      catch (error) {
        // A native event invalidated the in-flight snapshot. Consume that
        // event's pending update instead of treating an ordinary close as loss
        // of the whole profile. There is no timer or speculative retry.
        if (current() && directoryDirty) continue;
        throw error;
      }
      if (!current()) return;
      if (directoryDirty) continue;
      if (!directorySnapshotPending && JSON.stringify(tabs) === JSON.stringify(directoryTabs)) continue;
      const old = new Map(directoryTabs.map(tab => [tab.id, tab]));
      const ids = new Set(tabs.map(tab => tab.id));
      const change = directorySnapshotPending ? { tabs } : {
        upsert: tabs.filter(tab => JSON.stringify(old.get(tab.id)) !== JSON.stringify(tab)),
        removed: directoryTabs.filter(tab => !ids.has(tab.id)).map(tab => tab.id), order: tabs.map(tab => tab.id),
      };
      directorySnapshotPending = false;
      directoryTabs = tabs;
      port.postMessage({ type: 'tabs_changed', revision: ++directoryRevision, ...change });
    }
  })();
  directoryWork = work;
  const settled = () => {
    if (directoryWork !== work) return;
    directoryWork = undefined;
    if (current() && directoryDirty) void queueDirectory().catch(() => {});
  };
  void work.then(settled, () => {
    if (current()) port.postMessage({ type: 'tabs_unavailable', reason: 'directory_unavailable' });
    settled();
  });
  return work;
}
for (const event of [chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced])
  event.addListener(() => { void queueDirectory().catch(() => {}); });

async function disconnect() {
  const port = native; native = undefined; ready = false;
  watchingTabs = false; directoryRevision = 0; directoryTabs = []; directoryWork = undefined; directoryDirty = false; directorySnapshotPending = false;
  const retired = pending; pending = new Map();
  for (const task of retired.values()) { task.cancelled = true; task.abort.abort(); }
  for (const tabId of bindings.keys()) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  bindings.clear(); popupLineage.close(); nativeTargets.clear(); closedNativeTabs.clear(); lineageUnavailable = false; receipts.clear(); sourceReceipts.clear(); receiptBytes = 0; port?.disconnect();
  // A retired bind may still be awaiting Chrome. Let its cancellation cleanup
  // finish before another connection can bind the same tab.
  await Promise.allSettled([...retired.values()].map(task => task.finished));
  notifyConnectionChanged();
}
async function attach(tabId, selection, signal) {
  if (lineageUnavailable) throw new Error('browser directory unavailable');
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('invalid tab');
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito || !/^(https?:\/\/|about:blank$)/u.test(tab.url || tab.pendingUrl || (selection ? '' : 'about:blank'))) throw new Error('unsupported tab');
  const validateSelection = current => {
    if (selection && (current.url !== selection.tab_url || (current.title || '').slice(0, 512) !== selection.tab_title || current.pendingUrl && current.pendingUrl !== selection.tab_url)) throw new Error('refresh tab selection');
  };
  validateSelection(tab);
  await restoreDiscardedTab(chrome, tab, signal);
  signal.throwIfAborted();
  let created = false;
  let binding;
  if (!bindings.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3');
    created = true;
    bindings.set(tabId, { id: crypto.randomUUID(), children: new Set(), streams: new Set() });
  }
  binding = bindings.get(tabId);
  try {
    signal.throwIfAborted();
    if (tab.frozen) await chrome.debugger.sendCommand({ tabId }, 'Page.setWebLifecycleState', { state: 'active' });
    validateSelection(await chrome.tabs.get(tabId));
    await rememberNativeTargets();
    signal.throwIfAborted();
    if (bindings.get(tabId) !== binding) throw new Error('browser binding changed');
    popupLineage.observe('profile', String(tabId));
    popupLineage.bind('profile', String(tabId), String(tabId));
    return { created, tab_id: String(tabId), title: tab.title || tab.url || '', native_target_id: nativeTargets.get(String(tabId)), binding: binding.id };
  } catch (error) {
    if (created && bindings.get(tabId) === binding) await unbind(tabId);
    throw error;
  }
}
function retireCredits(binding) {
  sourceReceipts.delete(binding);
  for (const [sequence, receipt] of receipts) if (receipt.binding === binding) { receipts.delete(sequence); receiptBytes -= receipt.bytes; }
}
async function unbind(tabId) {
  const binding = bindings.get(tabId);
  if (!binding) return;
  retireCredits(binding.id);
  bindings.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}
async function execute(message, task) {
  if (!task || task.cancelled) throw new Error('cancelled');
  const args = message.arguments || {};
  switch (message.command) {
    case 'status': {
      const binding = bindings.get(Number(args.tab_id));
      if (!binding) throw new Error('tab unavailable');
      await chrome.tabs.get(Number(args.tab_id)); return {};
    }
    case 'reveal': {
      const tabId = Number(args.tab_id);
      if (!bindings.has(tabId)) throw new Error('tab unavailable');
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return {};
    }
    case 'inventory': return inventory();
    case 'watch_tabs': {
      if (!watchingTabs) { watchingTabs = true; await queueDirectory(true); }
      return {};
    }
    case 'sync_tabs': { await queueDirectory(); return {}; }
    case 'close_tab': { await nativeTab(args, true); await chrome.tabs.remove(Number(args.tab_id)); await queueDirectory(); return {}; }
    case 'pin_tab': { if (typeof args.pinned !== 'boolean') throw new Error('invalid pin'); await nativeTab(args, true); await chrome.tabs.update(Number(args.tab_id), { pinned: args.pinned === true }); await queueDirectory(); return {}; }
    case 'move_tab': {
      const tab = await nativeTab(args, true);
      const before = args.before ? await nativeTab(args.before, true) : undefined;
      const peers = (await chrome.tabs.query({ windowId: before?.windowId ?? tab.windowId })).filter(item => item.id !== tab.id);
      await chrome.tabs.move(tab.id, { windowId: before?.windowId ?? tab.windowId, index: before ? peers.findIndex(item => item.id === before.id) : -1 });
      await queueDirectory(); return {};
    }
    case 'bind': {
      await nativeTab(args);
      if (!args.native_target_id && (typeof args.tab_url !== 'string' || !args.tab_url || typeof args.tab_title !== 'string')) throw new Error('select a current tab');
      const result = await attach(Number(args.tab_id), args.tab_url ? args : undefined, task.abort.signal);
      if (task.cancelled) { if (result.created && bindings.get(Number(result.tab_id))?.id === result.binding) await unbind(Number(result.tab_id)); throw new Error('cancelled'); }
      return result;
    }
    case 'new_tab': {
      // No activation, window focus, pointer movement, or clipboard access.
      const tab = await chrome.tabs.create({ active: false, url: 'about:blank' });
      // Creation and display have independent outcomes. Cancellation or a
      // failed debugger attachment must never close the confirmed native tab.
      await queueDirectory();
      await rememberNativeTargets();
      return { tab_id: String(tab.id), native_target_id: nativeTargets.get(String(tab.id)), title: tab.title || '', url: tab.url || 'about:blank' };
    }
    case 'unbind': {
      const binding = bindings.get(Number(args.tab_id));
      if (args.binding && binding?.id !== args.binding) return {};
      await unbind(Number(args.tab_id)); return {};
    }
    case 'cdp': {
      const binding = bindings.get(Number(args.tab_id));
      if (!binding || binding.id !== args.binding || (args.session && !binding.children.has(args.session))) throw new Error('tab unavailable');
      const method = args.method, params = args.params || {};
      // Only the trusted Runtime source owner speaks this private protocol.
      // Browser-wide discovery/attachment and arbitrary IO handles cannot turn
      // one selected personal tab into authority over the rest of the profile.
      if (typeof method !== 'string' || !/^(Page|Runtime|DOM|DOMSnapshot|CSS|Network|Fetch|Input|Emulation|Accessibility|IO|Target)\.[A-Za-z]+$/u.test(method)) throw new Error('command unavailable');
      if (method.startsWith('Target.') && !(method === 'Target.getTargetInfo' && !params.targetId || method === 'Target.setAutoAttach' && params.autoAttach === true && params.waitForDebuggerOnStart === true && params.flatten === true && JSON.stringify(params.filter) === JSON.stringify([{ type: 'iframe', exclude: false }, { exclude: true }]))) throw new Error('target unavailable');
      if (['Network.getAllCookies', 'Network.setCookie', 'Network.setCookies', 'Network.clearBrowserCookies', 'Network.clearBrowserCache', 'Page.setDownloadBehavior'].includes(method)) throw new Error('profile command unavailable');
      if (method.startsWith('IO.') && method !== 'IO.resolveBlob' && (!['IO.read', 'IO.close'].includes(method) || !binding.streams.has(params.handle))) throw new Error('stream unavailable');
      task.binding = binding;
      // Background tabs need virtual CDP focus for timely input. This does not
      // activate the physical tab, and debugger detach releases the override.
      if (method.startsWith('Input.')) {
        await chrome.debugger.sendCommand({ tabId: Number(args.tab_id) }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
        if (bindings.get(Number(args.tab_id)) !== binding || task.cancelled) throw new Error('tab unavailable');
      }
      const result = await chrome.debugger.sendCommand({ tabId: Number(args.tab_id), ...(args.session ? { sessionId: args.session } : {}) }, method, params);
      if (bindings.get(Number(args.tab_id)) !== binding || task.cancelled) throw new Error('tab unavailable');
      const stream = method === 'IO.resolveBlob' && /^[a-f0-9-]{36}$/iu.test(result.uuid || '') ? `blob:${result.uuid}` : method === 'Fetch.takeResponseBodyAsStream' ? result.stream : undefined;
      if (stream) {
        if (binding.streams.size >= 16) { await unbind(Number(args.tab_id)); throw new Error('stream limit'); }
        binding.streams.add(stream);
      }
      if (method === 'IO.close') binding.streams.delete(params.handle);
      return result;
    }
    default: throw new Error('unknown command');
  }
}
async function connect(name, label, remember = false) {
  if (typeof name !== 'string' || !/^dev\.floegence\.redeven\.r[a-f0-9]{16}$/u.test(name)
    || typeof label !== 'string' || !label.trim() || label.length > 120) throw new Error('invalid connection');
  await disconnect();
  const settings = await chrome.storage.local.get('profile');
  profile = settings.profile || { id: crypto.randomUUID() };
  profile.name = label.trim();
  if (remember) await chrome.storage.local.set({ profile, nativeName: name, autoConnect: false });
  nativeName = name; lastError = '';
  const port = chrome.runtime.connectNative(name); native = port;
  const requests = new Map(); pending = requests;
  const disconnectPort = () => schedule(async () => {
    if (native !== port) return;
    await disconnect();
    await restoreConnection();
  });
  let accepted, rejected;
  const handshake = new Promise((resolve, reject) => { accepted = resolve; rejected = reject; });
  const failure = code => Object.assign(new Error(code), { code });
  const timeout = setTimeout(() => rejected(failure('connection_timeout')), 5000);
  port.onDisconnect.addListener(() => {
    // Chrome only exposes lastError during this callback. Keep a closed reason,
    // never its raw text (which can contain local paths), in the UI snapshot.
    const message = chrome.runtime.lastError?.message || '';
    if (native !== port) return;
    lastError = message === 'Specified native messaging host not found.' ? 'native_host_missing'
      : message === 'Access to the specified native messaging host is forbidden.' ? 'native_host_forbidden'
      : message === 'Failed to start native messaging host.' ? 'native_host_failed' : 'runtime_unavailable';
    rejected(failure(lastError)); void disconnectPort();
  });
  port.onMessage.addListener(message => {
    if (native !== port) return;
    if (!ready && message.type === 'connection_error' && message.code === 'extension_update_required') {
      rejected(failure(message.code)); return;
    }
    if (!ready && message.type === 'ready' && message.protocol_version !== 9) {
      rejected(failure('extension_update_required')); return;
    }
    if (message.type === 'ready' && message.protocol_version === 9 && !ready) { ready = true; accepted(); return; }
    if (ready && message.type === 'cdp_ack') {
      const receipt = receipts.get(message.sequence);
      if (receipt) {
        receipts.delete(message.sequence); receiptBytes -= receipt.bytes;
        const source = sourceReceipts.get(receipt.binding);
        if (source) { source.bytes -= receipt.bytes; if (--source.count === 0) sourceReceipts.delete(receipt.binding); }
      }
      return;
    }
    if (!ready || typeof message.id !== 'string' || !message.id || message.id.length > 64) { void disconnectPort(); return; }
    if (message.type === 'cancel') {
      const task = requests.get(message.id);
      if (task) { task.cancelled = true; task.abort.abort(); }
      return;
    }
    if (requests.has(message.id) || requests.size >= 64) { void disconnectPort(); return; }
    const task = { cancelled: false, abort: new AbortController() }; requests.set(message.id, task);
    task.finished = (async () => {
      let response;
      try { response = { id: message.id, result: await execute(message, task) }; }
      catch { response = { id: message.id, error: 'EXTENSION_COMMAND_FAILED' }; }
      // Retire before sending: the Runtime can issue another request as soon
      // as it receives the reply. Never race a later .finally callback.
      requests.delete(message.id);
      if (native === port) {
        if (message.command === 'cdp' && bindings.get(Number(message.arguments?.tab_id))?.id === message.arguments?.binding) {
          if (!postPayload(port, response, message.arguments.binding)) port.postMessage({ id: message.id, error: 'EXTENSION_COMMAND_FAILED' });
        } else port.postMessage(response);
      }
    })();
  });
  port.postMessage({ type: 'hello', protocol_version: 9, profile_id: profile.id, profile_name: profile.name });
  try {
    await handshake;
    if (remember) await chrome.storage.local.set({ autoConnect: true });
    await ensureReconnectAlarm();
    notifyConnectionChanged();
  }
  catch (error) { lastError = error.code || 'connection_failed'; if (native === port) await disconnect(); throw error; }
  finally { clearTimeout(timeout); }

}

async function ensureReconnectAlarm() {
  if (!await chrome.alarms.get(reconnectAlarm)) await chrome.alarms.create(reconnectAlarm, { periodInMinutes: 0.5 });
}

async function restoreConnection() {
  const saved = await chrome.storage.local.get(['profile', 'nativeName', 'autoConnect']);
  if (saved.autoConnect !== true) { await chrome.alarms.clear(reconnectAlarm); return; }
  await ensureReconnectAlarm();
  if (native || ready) return;
  // This restores only the confirmed host transport. Runtime still owns every
  // tab binding and permission; cancelled commands are never replayed.
  try { await connect(saved.nativeName, saved.profile?.name); }
  catch { /* The classified connection error remains available to the popup. */ }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === reconnectAlarm) void schedule(restoreConnection);
});
chrome.runtime.onStartup.addListener(() => { void schedule(restoreConnection); });
void schedule(restoreConnection);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only this extension's own UI can confirm a host or disable reconnection.
  if (sender.id !== chrome.runtime.id || sender.url?.split('#')[0] !== chrome.runtime.getURL('popup.html')) return false;
  const run = async () => {
    if (message.command === 'connect') await connect(message.nativeHost, message.profileName, true);
    else if (message.command === 'disconnect') {
      await chrome.storage.local.set({ autoConnect: false });
      await chrome.alarms.clear(reconnectAlarm);
      await disconnect(); lastError = '';
    }
    else if (message.command !== 'status') throw new Error('invalid command');
    const saved = await chrome.storage.local.get(['profile', 'nativeName']);
    return { connected: Boolean(native) && ready, nativeHost: nativeName || saved.nativeName || '', profileName: profile?.name || saved.profile?.name || '', tabs: bindings.size, error: lastError };
  };
  void schedule(run).then(respond, () => respond({ connected: false, nativeHost: nativeName, error: lastError || 'connection_failed' }));
  return true;
});
