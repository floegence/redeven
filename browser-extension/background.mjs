import { createBrowserLineage } from './computerBrowserLineage.mjs';
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
    if (entry) { targetUnavailable(entry[0]); void chrome.debugger.detach({ tabId: entry[0] }).catch(() => {}); }
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
function targetUnavailable(tabId) {
  const binding = bindings.get(tabId);
  if (!binding) return;
  retireCredits(binding.id);
  bindings.delete(tabId);
  if (native && ready) native.postMessage({ type: 'target_unavailable', tab_id: String(tabId) });
}
chrome.debugger.onDetach.addListener(source => targetUnavailable(source.tabId));
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
  targetUnavailable(tabId);
  popupLineage.remove('profile', String(tabId));
  if (nativeTargets.has(String(tabId))) closedNativeTabs.add(String(tabId));
  for (const tab of closedNativeTabs) if (!popupLineage.contains('profile', tab)) { nativeTargets.delete(tab); closedNativeTabs.delete(tab); }
});

async function disconnect() {
  const port = native; native = undefined; ready = false;
  const retired = pending; pending = new Map();
  for (const task of retired.values()) task.cancelled = true;
  for (const tabId of bindings.keys()) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  bindings.clear(); popupLineage.close(); nativeTargets.clear(); closedNativeTabs.clear(); lineageUnavailable = false; receipts.clear(); sourceReceipts.clear(); receiptBytes = 0; port?.disconnect();
  // A retired bind may still be awaiting Chrome. Let its cancellation cleanup
  // finish before another connection can bind the same tab.
  await Promise.allSettled([...retired.values()].map(task => task.finished));
  notifyConnectionChanged();
}
async function attach(tabId, selection) {
  if (lineageUnavailable) throw new Error('browser directory unavailable');
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('invalid tab');
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito || !/^(https?:\/\/|about:blank$)/u.test(tab.url || tab.pendingUrl || (selection ? '' : 'about:blank'))) throw new Error('unsupported tab');
  const validateSelection = current => {
    if (selection && (current.url !== selection.tab_url || (current.title || '').slice(0, 512) !== selection.tab_title || current.pendingUrl && current.pendingUrl !== selection.tab_url)) throw new Error('refresh tab selection');
  };
  validateSelection(tab);
  if (!bindings.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3');
    bindings.set(tabId, { id: crypto.randomUUID(), children: new Set(), streams: new Set() });
    try { validateSelection(await chrome.tabs.get(tabId)); }
    catch (error) { bindings.delete(tabId); await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
  }
  await rememberNativeTargets();
  popupLineage.observe('profile', String(tabId));
  popupLineage.bind('profile', String(tabId), String(tabId));
  return { tab_id: String(tabId), title: tab.title || tab.url || '', binding: bindings.get(tabId).id };
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
    case 'inventory': {
      if (lineageUnavailable) throw new Error('browser directory unavailable');
      const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito && /^(https?:\/\/|about:blank$)/u.test(tab.url || ''));
      if (tabs.length > 128) throw new Error('inventory limit');
      await rememberNativeTargets();
      const retained = new Set(tabs.flatMap(tab => [String(tab.id), ...popupLineage.nativeAncestors('profile', String(tab.id))]));
      for (const tab of nativeTargets.keys()) if (!retained.has(tab)) { nativeTargets.delete(tab); closedNativeTabs.delete(tab); }
      return tabs.map(tab => {
        const nativeTarget = nativeTargets.get(String(tab.id));
        if (!nativeTarget) throw new Error('refresh browser directory');
        const ancestors = popupLineage.nativeAncestors('profile', String(tab.id));
        if (ancestors.length > 128) throw new Error('browser directory depth limit');
        return { id: String(tab.id), native_target_id: nativeTarget, opener_native_target_ids: ancestors.map(id => nativeTargets.get(id)).filter(Boolean), profile_id: profile.id, title: (tab.title || '').slice(0, 512), url: tab.url,
          ...(ancestors.length ? { opener_tab_id: ancestors[0], opener_tab_ids: ancestors } : {}),
        };
      });
    }
    case 'bind': {
      if (typeof args.tab_url !== 'string' || !args.tab_url || typeof args.tab_title !== 'string') throw new Error('select a current tab');
      const result = await attach(Number(args.tab_id), args);
      if (task.cancelled) { await unbind(Number(result.tab_id)); throw new Error('cancelled'); }
      return result;
    }
    case 'new_tab': {
      // No activation, window focus, pointer movement, or clipboard access.
      const tab = await chrome.tabs.create({ active: false, url: 'about:blank' });
      try {
        const result = await attach(tab.id);
        if (task.cancelled) { await unbind(tab.id); throw new Error('cancelled'); }
        return result;
      } catch (error) { await chrome.tabs.remove(tab.id); throw error; }
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
    if (!ready && message.type === 'ready' && message.protocol_version !== 7) {
      rejected(failure('extension_update_required')); return;
    }
    if (message.type === 'ready' && message.protocol_version === 7 && !ready) { ready = true; accepted(); return; }
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
      if (task) task.cancelled = true;
      return;
    }
    if (requests.has(message.id) || requests.size >= 64) { void disconnectPort(); return; }
    const task = { cancelled: false }; requests.set(message.id, task);
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
  port.postMessage({ type: 'hello', protocol_version: 7, profile_id: profile.id, profile_name: profile.name });
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
