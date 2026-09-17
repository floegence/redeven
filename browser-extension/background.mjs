import { BrowserComputerController } from './computerBrowserController.mjs';

const bindings = new Map();
let native;
let profile;
let nativeName = '';
let lastError = '';
let pending = new Map();
let ready = false;
let lifecycle = Promise.resolve();
const schedule = operation => {
  const result = lifecycle.then(operation);
  lifecycle = result.catch(() => {});
  return result;
};

class TabTransport {
  constructor(tabId, sessionId, root) {
    this.tabId = tabId;
    this.sessionId = sessionId;
    this.root = root || this;
    this.listeners = new Map();
    if (!root) this.children = new Map();
  }
  on(name, fn) { const set = this.listeners.get(name) || new Set(); set.add(fn); this.listeners.set(name, set); }
  off(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, value) { for (const fn of this.listeners.get(name) || []) fn(value); }
  send(method, params = {}) { return chrome.debugger.sendCommand({ tabId: this.tabId, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }, method, params); }
  async frameSessions() { return [...this.root.children.values(), this.root]; }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const binding = bindings.get(source.tabId);
  if (!binding) return;
  if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
    const child = new TabTransport(source.tabId, params.sessionId, binding.transport);
    binding.transport.children.set(params.sessionId, child);
    void binding.controller.page.initializeSession(child).then(() => child.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe', exclude: false }, { exclude: true }] })).then(() => child.send('Runtime.runIfWaitingForDebugger')).catch(() => binding.controller.close());
    binding.controller.page.invalidate();
  }
  if (method === 'Target.detachedFromTarget') {
    binding.transport.children.delete(params.sessionId); binding.controller.page.invalidate();
  }
  (source.sessionId ? binding.transport.children.get(source.sessionId) : binding.transport)?.emit(method, params);
});
function targetUnavailable(tabId) {
  const binding = bindings.get(tabId);
  if (!binding) return;
  binding.controller.close(); bindings.delete(tabId);
  if (native && ready) native.postMessage({ type: 'target_unavailable', tab_id: String(tabId) });
}
chrome.debugger.onDetach.addListener(source => targetUnavailable(source.tabId));
chrome.tabs.onRemoved.addListener(targetUnavailable);

async function disconnect() {
  const port = native; native = undefined; ready = false;
  const retired = pending; pending = new Map();
  for (const task of retired.values()) { task.cancelled = true; task.binding?.controller.cancel(); }
  for (const [tabId, binding] of bindings) {
    binding.controller.cancel();
    await binding.controller.page.releaseInput().catch(() => {});
    await binding.controller.page.releasePage();
    binding.controller.close();
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  bindings.clear(); port?.disconnect();
  // A retired bind may still be awaiting Chrome. Let its cancellation cleanup
  // finish before another connection can bind the same tab.
  await Promise.allSettled([...retired.values()].map(task => task.finished));
}
async function attach(tabId, selection) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('invalid tab');
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito || !/^(https?:\/\/|about:blank$)/u.test(tab.url || tab.pendingUrl || (selection ? '' : 'about:blank'))) throw new Error('unsupported tab');
  const validateSelection = current => {
    if (selection && (current.url !== selection.tab_url || (current.title || '').slice(0, 512) !== selection.tab_title || current.pendingUrl && current.pendingUrl !== selection.tab_url)) throw new Error('refresh tab selection');
  };
  validateSelection(tab);
  if (!bindings.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3');
    const transport = new TabTransport(tabId);
    const controller = new BrowserComputerController(transport);
    bindings.set(tabId, { transport, controller });
    try {
      await controller.initialize();
      await transport.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe', exclude: false }, { exclude: true }] });
      validateSelection(await chrome.tabs.get(tabId));
    } catch (error) { await controller.page.releasePage(); controller.close(); bindings.delete(tabId); await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
  }
  return { tab_id: String(tabId), title: tab.title || tab.url || '' };
}
async function unbind(tabId) {
  const binding = bindings.get(tabId);
  if (!binding) return;
  binding.controller.cancel();
  await binding.controller.page.releaseInput().catch(() => {});
  await binding.controller.page.releasePage();
  binding.controller.close(); bindings.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}
async function execute(message, task) {
  if (!task || task.cancelled) throw new Error('cancelled');
  const args = message.arguments || {};
  switch (message.command) {
    case 'status': {
      const binding = bindings.get(Number(args.tab_id));
      if (!binding || binding.controller.page.invalid) throw new Error('tab unavailable');
      await chrome.tabs.get(Number(args.tab_id)); return {};
    }
    case 'inventory': {
      const tabs = (await chrome.tabs.query({})).filter(tab => !tab.incognito && /^(https?:\/\/|about:blank$)/u.test(tab.url || ''));
      if (tabs.length > 128) throw new Error('inventory limit');
      return tabs.map(tab => ({ id: String(tab.id), profile_id: profile.id, title: (tab.title || '').slice(0, 512), url: tab.url }));
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
      await unbind(Number(args.tab_id)); return {};
    }
    case 'execute': {
      const binding = bindings.get(Number(args.tab_id));
      if (!binding) return { error: 'TARGET_CONNECTION_REQUIRED' };
      if (binding.busy) throw new Error('target busy');
      binding.busy = true; task.binding = binding;
      try { return await binding.controller.execute(args.request); }
      finally { binding.busy = false; }

    }
    default: throw new Error('unknown command');
  }
}
async function connect(name, label) {
  if (!/^dev\.floegence\.redeven\.r[a-f0-9]{16}$/u.test(name) || !label.trim() || label.length > 120) throw new Error('invalid connection');
  await disconnect();
  const settings = await chrome.storage.local.get('profile');
  profile = settings.profile || { id: crypto.randomUUID() };
  profile.name = label.trim();
  await chrome.storage.local.set({ profile, nativeName: name });
  nativeName = name; lastError = '';
  const port = chrome.runtime.connectNative(name); native = port;
  const requests = new Map(); pending = requests;
  const disconnectPort = () => schedule(() => native === port ? disconnect() : undefined);
  port.onDisconnect.addListener(() => {
    if (native === port) { lastError = 'disconnected'; void disconnectPort(); }
  });
  let accepted, rejected;
  const handshake = new Promise((resolve, reject) => { accepted = resolve; rejected = reject; });
  const timeout = setTimeout(() => rejected(new Error('connection timeout')), 5000);
  port.onDisconnect.addListener(() => rejected(new Error('disconnected')));
  port.onMessage.addListener(message => {
    if (native !== port) return;
    if (message.type === 'ready' && message.protocol_version === 3 && !ready) { ready = true; accepted(); return; }
    if (!ready || typeof message.id !== 'string' || !message.id || message.id.length > 64) { void disconnectPort(); return; }
    if (message.type === 'cancel') {
      const task = requests.get(message.id);
      if (task) { task.cancelled = true; task.binding?.controller.cancel(); }
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
      if (native === port) port.postMessage(response);
    })();
  });
  port.postMessage({ type: 'hello', protocol_version: 3, profile_id: profile.id, profile_name: profile.name });
  try { await handshake; }
  catch (error) { if (native === port) await disconnect(); throw error; }
  finally { clearTimeout(timeout); }

}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only this extension's own UI can set up or disconnect its native port.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  const run = async () => {
    if (message.command === 'connect') await connect(message.nativeHost, message.profileName);
    else if (message.command === 'disconnect') await disconnect();
    else if (message.command !== 'status') throw new Error('invalid command');
    const saved = await chrome.storage.local.get(['profile', 'nativeName']);
    return { connected: Boolean(native) && ready, nativeHost: nativeName || saved.nativeName || '', profileName: profile?.name || saved.profile?.name || '', tabs: bindings.size, error: lastError };
  };
  void schedule(run).then(respond, () => respond({ error: 'connection_failed' }));
  return true;
});
