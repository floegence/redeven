import { browserKey } from './computerBrowserKeys.mjs';

// Sensitive-field transitions are observed in a CDP isolated world, including
// fields that appear and disappear during one action. Incidental user input is
// not a Flower pause request; explicit control remains owned by the Runtime.
const privacyObserverSource = `(() => {
  if (globalThis.__flowerPrivacyObserver) return;
  let observing = true, secretChanged = false;
  const roots = new WeakSet();
  const secret = node => node?.nodeType === 1 && node.matches('input[type="password"],input[autocomplete~="one-time-code"]');
  const scan = node => {
    if (secret(node) && (!node.isConnected || node.getClientRects().length)) secretChanged = true;
    for (const element of node?.querySelectorAll?.('*') || []) {
      if (secret(element) && (!element.isConnected || element.getClientRects().length)) secretChanged = true;
      if (element.shadowRoot) { watch(element.shadowRoot); scan(element.shadowRoot); }
    }
    if (node?.shadowRoot) { watch(node.shadowRoot); scan(node.shadowRoot); }
  };
  const mutations = records => {
    if (!observing) return;
    for (const record of records) {
      if (record.type === 'attributes') {
        if (secret(record.target) || (record.attributeName === 'type' && record.oldValue === 'password')
          || (record.attributeName === 'autocomplete' && (record.oldValue || '').split(/\\s+/u).includes('one-time-code'))) secretChanged = true;
      } else for (const node of [...record.addedNodes, ...record.removedNodes]) scan(node);
    }
  };
  const observer = new MutationObserver(mutations);
  const watch = root => { if (!roots.has(root)) { roots.add(root); observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['type','autocomplete'], attributeOldValue: true }); } };
  watch(document);
  const guard = {
    begin() {
      observing = false; observer.takeRecords(); secretChanged = false;
      // Subscribe to existing open shadow roots without treating their stable
      // hidden sign-in fields as a new sensitive transition.
      scan(document); secretChanged = false; observing = true;
    },
    secretChanged() { mutations(observer.takeRecords()); return secretChanged; },
  };
  Object.defineProperty(globalThis, '__flowerPrivacyObserver', { value: guard });

})();`;

// Trusted page operations shared by managed Chromium and the Chrome extension.
// Only this module speaks CDP. Guest scripts receive selectors and JSON facts.
export class BrowserComputerPage {
  constructor(transport, { allowedOrigins = [] } = {}) {
    this.transport = transport;
    this.allowedOrigins = new Set(allowedOrigins);
    this.fullAccess = false;
    this.references = new Map();
    this.revision = 0;
    this.prefix = crypto.randomUUID();
    this.listeners = new Set();
    this.sessions = new Map();
    this.requiredOrigin = undefined;
    this.openedPages = [];
    this.downloads = new Map();
    this.guardFailure = false;
    this.privateInput = false;
    this.observedFrames = new Set();
    this.stopped = false;
    this.invalid = false;
    this.heldInput = new Map();
    this.effectCount = 0;
    this.uncertainEffect = false;
    this.focusedSessions = new Set();

  }

  allowsOrigin(origin) { return this.allowedOrigins.has(origin) || (this.fullAccess && (origin.startsWith('https://') || origin.startsWith('http://'))); }

  invalidate() { this.revision++; this.references.clear(); this.observedFrames.clear(); this.changed(); }
  changed() { for (const listener of this.listeners) listener(); }
  close() { this.invalid = true; this.invalidate(); }
  cancel() { this.stopped = true; this.invalidate(); }
  handback() { this.openedPages = []; this.stopped = false; this.requiredOrigin = undefined; this.invalidate(); }

  async initialize() { await this.initializeSession(this.transport); }

  async initializeSession(session) {
    if (this.sessions.has(session)) return this.sessions.get(session);
    const ready = (async () => {
      for (const event of ['Page.frameAttached', 'Page.frameDetached', 'Page.frameNavigated', 'DOM.documentUpdated']) session.on(event, () => this.invalidate());
      for (const event of ['DOM.childNodeRemoved', 'DOM.attributeModified', 'DOM.childNodeInserted', 'Accessibility.nodesUpdated', 'Page.lifecycleEvent']) session.on(event, () => this.changed());
      session.on('Page.windowOpen', event => {
        // Opening a page completes an action; choosing that page is the
        // agent's next decision. It does not grant control or require a user.
        if (this.openedPages.length < 16) this.openedPages.push({ url: String(event.url || '').slice(0, 8192) });
        this.invalidate();
      });
      session.on('Page.downloadWillBegin', event => {
        if (this.downloads.size >= 32) this.downloads.delete(this.downloads.keys().next().value);
        this.downloads.set(event.guid, { id: event.guid, filename: String(event.suggestedFilename || '').slice(0, 512), state: 'in_progress' });
        this.changed();
      });
      session.on('Page.downloadProgress', event => {
        const download = this.downloads.get(event.guid);
        if (!download || !['inProgress','completed','canceled'].includes(event.state)) return;
        if (event.state === 'completed' && this.transport.resolveDownload) {
          void this.transport.resolveDownload(event.guid).then(facts => Object.assign(download, facts, { state: 'completed' }),
            () => { download.state = 'unavailable'; }).finally(() => this.changed());
        } else { download.state = event.state === 'inProgress' ? 'in_progress' : event.state; this.changed(); }
      });
      session.on('Fetch.requestPaused', event => {
        void (async () => {
          let allowed = this.privateInput;
          let origin;
          try { const url = new URL(event.request.url); origin = url.origin; allowed ||= ['http:', 'https:'].includes(url.protocol) && this.allowsOrigin(origin); }
          catch { /* Unsupported navigation has no ambient authority. */ }
          if (allowed) await session.send('Fetch.continueRequest', { requestId: event.requestId });
          else {
            this.requiredOrigin = origin;
            this.stopped = true; this.invalidate();
            await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
          }
        })().catch(() => { this.guardFailure = true; this.invalidate(); });
      });
      await session.send('Page.enable');
      await session.send('Runtime.enable');
      await session.send('DOM.enable');
      await session.send('Accessibility.enable');
      await session.send('Page.setLifecycleEventsEnabled', { enabled: true });
      await session.send('Page.addScriptToEvaluateOnNewDocument', { source: privacyObserverSource, worldName: 'flower-observation' });
      await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    })();
    this.sessions.set(session, ready);
    return ready;
  }

  async preparePage() {
    // Chromium virtual focus enables editing without selecting the physical
    // tab. Native popup behavior remains intact, including WindowProxy/forms.
    if (this.focusedSessions.has(this.transport) === this.privateInput) {
      await this.transport.send('Emulation.setFocusEmulationEnabled', { enabled: !this.privateInput });
      if (this.privateInput) this.focusedSessions.delete(this.transport);
      else this.focusedSessions.add(this.transport);
    }
  }

  async releasePage() {
    await Promise.allSettled([...this.focusedSessions].map(session => session.send('Emulation.setFocusEmulationEnabled', { enabled: false })));
    this.focusedSessions.clear();
  }

  async frames() {
    if (this.invalid) throw new Error('TARGET_CONNECTION_REQUIRED');
    const sessions = this.transport.frameSessions ? await this.transport.frameSessions() : [this.transport];
    const result = [];
    const seen = new Set();
    for (const session of sessions) {
      await this.initializeSession(session);
      const { frameTree } = await session.send('Page.getFrameTree');
      const walk = (tree) => {
        if (!seen.has(tree.frame.id)) { seen.add(tree.frame.id); result.push({ session, frame: tree.frame }); }
        for (const child of tree.childFrames || []) walk(child);
      };
      walk(frameTree);
    }
    for (const frame of result) {
      if (this.observedFrames.has(frame.frame.id)) continue;
      const { executionContextId } = await frame.session.send('Page.createIsolatedWorld', { frameId: frame.frame.id, worldName: 'flower-observation' });
      await frame.session.send('Runtime.evaluate', { contextId: executionContextId, expression: privacyObserverSource });
      this.observedFrames.add(frame.frame.id);
    }
    return result;
  }

  async inFrame(frame, expression) {
    const { executionContextId } = await frame.session.send('Page.createIsolatedWorld', { frameId: frame.frame.id, worldName: 'flower-observation' });
    const result = await frame.session.send('Runtime.evaluate', { contextId: executionContextId, expression, returnByValue: true });
    if (result.exceptionDetails) throw Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'), { observationStage: 'semantic_read' });
    return result.result.value;
  }

  async beginObservation() {
    for (const frame of await this.frames()) await this.inFrame(frame, 'globalThis.__flowerPrivacyObserver.begin()');
  }

  async safety() {
    const revision = this.revision;
    const reasons = new Set();
    const checkedSessions = new Set();
    let requiredOrigin = this.requiredOrigin;
    let scanFailed = false;
    if (this.guardFailure) throw new Error('TARGET_CONNECTION_REQUIRED');
    if (requiredOrigin) reasons.add('site_permission');
    if (this.stopped) reasons.add('user_control');
    let frames;
    try { frames = await this.frames(); }
    catch (error) {
      if (revision !== this.revision) throw new Error('OBSERVATION_INVALIDATED');
      throw error;
    }
    for (const frame of frames) {
      const url = frame.frame.url;
      if (url !== 'about:blank' && !url.startsWith('about:srcdoc')) {
        try { if (!this.allowsOrigin(new URL(url).origin)) { reasons.add('site_permission'); requiredOrigin ||= new URL(url).origin; } }
        catch { scanFailed = true; }
      }
      try {
        if (!checkedSessions.has(frame.session)) {
          checkedSessions.add(frame.session);
          // DOMSnapshot includes closed shadow roots, which isolated-world
          // querySelector cannot inspect. Keep only classifications; attribute
          // values and input contents never cross the tool boundary.
          const snapshot = await frame.session.send('DOMSnapshot.captureSnapshot', { computedStyles: [] });
          for (const document of snapshot.documents) {
            for (const index of document.layout.nodeIndex) {
              if (snapshot.strings[document.nodes.nodeName[index]] !== 'INPUT') continue;
              const raw = document.nodes.attributes[index] || [];
              const attributes = new Map();
              for (let i = 0; i < raw.length; i += 2) attributes.set(snapshot.strings[raw[i]], snapshot.strings[raw[i + 1]]);
              if ((attributes.get('type') || '').toLowerCase() === 'password') { reasons.add('login'); reasons.add('secret_input'); }
              if ((attributes.get('autocomplete') || '').toLowerCase().split(/\s+/u).includes('one-time-code')) { reasons.add('otp'); reasons.add('secret_input'); }
            }
          }
        }
        const found = await this.inFrame(frame, `(() => {
          const text = (document.body?.innerText || '').slice(0, 200000).toLowerCase();
          const roots = [document];
          for (let i = 0; i < roots.length; i++) for (const element of roots[i].querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
          const inputs = roots.flatMap(root => [...root.querySelectorAll('input')]).filter(x => x.getClientRects().length);
          const reasons = [];
          if (globalThis.__flowerPrivacyObserver.secretChanged()) reasons.push('secret_input');
          if (inputs.some(x => x.type === 'password')) reasons.push('login', 'secret_input');
          if (inputs.some(x => (x.autocomplete || '').split(/\\s+/u).includes('one-time-code'))) reasons.push('otp', 'secret_input');
          if (/captcha|i am not a robot|verify you are human/u.test(text)) reasons.push('captcha');
          if (/ignore (all )?(previous|prior) instructions|system message|developer message/u.test(text)) reasons.push('prompt_injection');
          return reasons;
        })()`);
        for (const reason of found) reasons.add(reason);
      } catch {
        // A destroyed document makes its privacy scan obsolete. The caller
        // must discard all observations; it must not turn navigation into a
        // secret-input handoff or retry the action that already completed.
        scanFailed = true;
      }
    }
    if (this.guardFailure) throw new Error('TARGET_CONNECTION_REQUIRED');
    if (this.requiredOrigin) { reasons.add('site_permission'); requiredOrigin = this.requiredOrigin; }
    if (this.stopped) reasons.add('user_control');
    if (!reasons.size && revision !== this.revision) throw new Error('OBSERVATION_INVALIDATED');
    if (!reasons.size && scanFailed) throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
    return { level: reasons.size ? 'takeover' : 'routine', reason_codes: [...reasons], safe_to_capture: !reasons.size, safe_to_send_to_model: !reasons.size, ...(requiredOrigin ? { required_origin: requiredOrigin } : {}) };
  }

  async observe({ limit = 200, root_ref } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_REQUEST');
    const root = root_ref ? await this.resolve({ ref: root_ref }) : undefined;
    const nodes = [];
    let total = 0;
    const layoutBySession = new Map();
    for (const frame of await this.frames()) {
      if (root && root.frame.frame.id !== frame.frame.id) continue;
      if (!layoutBySession.has(frame.session)) layoutBySession.set(frame.session, frame.session.send('DOMSnapshot.captureSnapshot', { computedStyles: [] }));
      const [snapshot, layout] = await Promise.all([
        frame.session.send('Accessibility.getFullAXTree', { frameId: frame.frame.id }),
        layoutBySession.get(frame.session),
      ]);
      const document = layout.documents.find(document => layout.strings[document.frameId] === frame.frame.id);
      const boundsByNode = new Map();
      for (let index = 0; index < (document?.layout.nodeIndex.length || 0); index++) {
        const nodeIndex = document.layout.nodeIndex[index];
        const [x, y, width, height] = document.layout.bounds[index];
        boundsByNode.set(document.nodes.backendNodeId[nodeIndex], { x: x - document.scrollOffsetX, y: y - document.scrollOffsetY, width, height });
      }
      const source = new Map(snapshot.nodes.map(node => [node.nodeId, node]));
      const allowed = root ? new Set() : undefined;
      const include = (id) => { if (allowed.has(id)) return; allowed.add(id); for (const child of source.get(id)?.childIds || []) include(child); };
      if (root) include(root.axNodeId);
      for (const node of snapshot.nodes) {
        if (node.ignored || !node.backendDOMNodeId || (allowed && !allowed.has(node.nodeId))) continue;
        const role = node.role?.value || 'unknown';
        if (['generic', 'none', 'InlineTextBox'].includes(role)) continue;
        total++;
        if (nodes.length >= limit) continue;
        const states = Object.fromEntries((node.properties || []).filter(prop => ['disabled', 'focused', 'checked', 'selected', 'expanded', 'readonly', 'required'].includes(prop.name)).map(prop => [prop.name, prop.value?.value]));
        const ref = `${this.prefix}:${this.revision}:${frame.frame.id}:${node.backendDOMNodeId}`;
        const entry = { ref, frame, backendNodeId: node.backendDOMNodeId, axNodeId: node.nodeId, role, name: (node.name?.value || '').slice(0, 2000), revision: this.revision };
        if (this.references.size >= 2000 && !this.references.has(ref)) this.references.delete(this.references.keys().next().value);
        this.references.set(ref, entry);
        const actions = ['read'];
        if (!states.disabled) actions.push('click');
        if (['textbox', 'searchbox', 'combobox'].includes(role) && !states.readonly && !states.disabled) actions.push('fill');
        const output = { ref, role, platform_role: role, frame_id: frame.frame.id, name: entry.name, states, actions };
        if (node.value?.value !== undefined) output.value = String(node.value.value).slice(0, 2000);
        if (boundsByNode.has(node.backendDOMNodeId)) output.bounds = boundsByNode.get(node.backendDOMNodeId);
        nodes.push(output);
      }
    }
    return { document_id: `${this.prefix}:${this.revision}`, nodes, truncated: total > nodes.length, total, execution_mode: 'background' };
  }

  async resolve(selector) {
    if (!selector || typeof selector !== 'object' || Object.keys(selector).some(key => !['ref', 'role', 'name'].includes(key))) throw new Error('INVALID_REQUEST');
    let entry;
    if (typeof selector.ref === 'string') {
      entry = this.references.get(selector.ref);
      if (!entry || entry.revision !== this.revision) throw new Error('STALE_REFERENCE');
    } else {
      if (typeof selector.role !== 'string' || typeof selector.name !== 'string') throw new Error('INVALID_REQUEST');
      const observed = await this.observe({ limit: 1000 });
      const matches = observed.nodes.filter(node => node.role === selector.role && node.name === selector.name);
      if (matches.length !== 1 || observed.truncated) throw new Error(matches.length > 1 || observed.truncated ? 'AMBIGUOUS_ELEMENT' : 'ELEMENT_NOT_FOUND');
      entry = this.references.get(matches[0].ref);
    }
    try {
      const { node } = await entry.frame.session.send('DOM.describeNode', { backendNodeId: entry.backendNodeId });
      if (!node || !node.nodeName) throw new Error('missing');
      const { nodes } = await entry.frame.session.send('Accessibility.getPartialAXTree', { backendNodeId: entry.backendNodeId, fetchRelatives: false });
      const current = nodes.find(node => node.backendDOMNodeId === entry.backendNodeId);
      if (!current || current.ignored || current.role?.value !== entry.role || (current.name?.value || '').slice(0, 2000) !== entry.name) throw new Error('changed');
    } catch { this.references.delete(entry.ref); throw new Error('STALE_REFERENCE'); }
    return entry;
  }

  async wait(selector, { state = 'visible', timeout_ms = 10000 } = {}) {
    if (!['visible', 'hidden', 'enabled'].includes(state) || !Number.isInteger(timeout_ms) || timeout_ms < 0 || timeout_ms > 30000) throw new Error('INVALID_REQUEST');
    const deadline = Date.now() + timeout_ms;
    for (;;) {
      let changed;
      const notification = new Promise(resolve => { changed = resolve; this.listeners.add(changed); });
      let timer;
      try {
        let found = false;
        let enabled = false;
        try {
          const element = await this.resolve(selector);
          found = true;
          const { nodes } = await element.frame.session.send('Accessibility.getPartialAXTree', { backendNodeId: element.backendNodeId, fetchRelatives: false });
          enabled = !nodes[0]?.properties?.some(prop => prop.name === 'disabled' && prop.value?.value);
        } catch (error) {
          if (!['ELEMENT_NOT_FOUND', 'STALE_REFERENCE'].includes(error.message)) throw error;
        }
        if ((state === 'hidden' && !found) || (state === 'visible' && found) || (state === 'enabled' && enabled)) return { state };
        if (this.stopped || this.invalid) throw new Error('TAKEOVER_REQUIRED');
        if (Date.now() >= deadline) return { state: 'timeout', requested_state: state, last_known: { found, enabled } };
        await Promise.race([notification, new Promise(resolve => { timer = setTimeout(resolve, deadline - Date.now()); })]);
      } finally { clearTimeout(timer); this.listeners.delete(changed); }
    }
  }

  async effect(operation) {
    if ((this.stopped && !this.privateInput) || this.invalid) throw new Error('TAKEOVER_REQUIRED');
    this.uncertainEffect = true;
    const result = await operation();
    this.uncertainEffect = false;
    this.effectCount++;
    return result;
  }

  async input(session, method, parameters, releasing = false) {
    if (!releasing && this.stopped && !this.privateInput) throw new Error('TAKEOVER_REQUIRED');
    const heldKey = method === 'Input.dispatchKeyEvent' ? `key:${parameters.key}` : `mouse:${parameters.button}`;
    const down = ['keyDown', 'mousePressed'].includes(parameters.type);
    const up = ['keyUp', 'mouseReleased'].includes(parameters.type);
    if (down) this.heldInput.set(heldKey, { session, method, parameters });
    if (releasing) await session.send(method, parameters);
    else await this.effect(() => session.send(method, parameters));
    if (up) this.heldInput.delete(heldKey);
  }

  async releaseInput() {
    for (const [key, held] of this.heldInput) {
      const parameters = { ...held.parameters, type: held.method === 'Input.dispatchKeyEvent' ? 'keyUp' : 'mouseReleased' };
      delete parameters.text;
      try { await this.input(held.session, held.method, parameters, true); }
      finally { this.heldInput.delete(key); }
    }
  }

  async editText(element, text, replace) {
    if (this.stopped && !this.privateInput) throw new Error('TAKEOVER_REQUIRED');
    let frame = element?.frame;
    if (!frame) {
      const frames = await this.frames();
      // hasFocus() includes ancestor documents. The deepest focused document
      // owns typing, including private sign-in fields inside an iframe.
      for (const candidate of [...frames].reverse()) {
        if (await this.inFrame(candidate, "document.hasFocus() && !['IFRAME','FRAME'].includes(document.activeElement?.tagName)")) { frame = candidate; break; }
      }
      if (!frame) throw new Error('ELEMENT_NOT_FOUND');
    }
    const { executionContextId } = await frame.session.send('Page.createIsolatedWorld', { frameId: frame.frame.id, worldName: 'flower-observation' });
    const node = element ? (await frame.session.send('DOM.resolveNode', { backendNodeId: element.backendNodeId, executionContextId })).object : undefined;
    try {
      if (this.stopped && !this.privateInput) throw new Error('TAKEOVER_REQUIRED');
      const result = await this.effect(() => frame.session.send('Runtime.callFunctionOn', { executionContextId: node ? undefined : executionContextId, ...(node ? { objectId: node.objectId } : {}),
        functionDeclaration: `function(text,replace){const element=replace?this:document.activeElement;if(!element)return false;element.focus();if(replace){if(typeof element.select==='function')element.select();else{const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}}return document.execCommand(text===''&&replace?'delete':'insertText',false,text);}`,
        arguments: [{ value: text }, { value: replace }], returnByValue: true }));
      if (result.exceptionDetails || result.result.value !== true) throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
    } finally { if (node?.objectId) await frame.session.send('Runtime.releaseObject', { objectId: node.objectId }); }
  }

  async navigate(command, parameters) {
    let ready;
    const loaded = new Promise(resolve => { ready = resolve; });
    const listener = () => ready();
    this.transport.on('Page.loadEventFired', listener);
    this.transport.on('Page.navigatedWithinDocument', listener);
    let interrupted;
    const cancelled = new Promise(resolve => { interrupted = () => { if (this.stopped || this.invalid) resolve(); }; this.listeners.add(interrupted); });
    let timer;
    try {
      const result = await this.effect(() => this.transport.send(command, parameters));
      // Content-Disposition navigations deliberately abort document loading.
      // Their completed effect is the download; waiting for DOMContentLoaded
      // would misclassify a successful export as an uncertain navigation.
      if (result.isDownload) return { download_started: true };
      if (result.errorText) throw new Error('NAVIGATION_FAILED');
      await Promise.race([loaded, cancelled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('NAVIGATION_TIMEOUT')), 20000); })]);
      if (this.stopped || this.invalid) throw new Error('TAKEOVER_REQUIRED');
    } finally {
      clearTimeout(timer);
      this.transport.off('Page.loadEventFired', listener);
      this.transport.off('Page.navigatedWithinDocument', listener);
      this.listeners.delete(interrupted);
    }
  }

  async waitForDownload({ id, timeout_ms = 10000 } = {}) {
    if ((id !== undefined && (typeof id !== 'string' || !id || id.length > 128)) || !Number.isInteger(timeout_ms) || timeout_ms < 0 || timeout_ms > 30000) throw new Error('INVALID_REQUEST');
    const deadline = Date.now() + timeout_ms;
    for (;;) {
      let changed, timer;
      const notification = new Promise(resolve => { changed = resolve; this.listeners.add(changed); });
      try {
        if (this.stopped || this.invalid) throw new Error('TAKEOVER_REQUIRED');
        const download = id ? this.downloads.get(id) : [...this.downloads.values()].at(-1);
        if (download && download.state !== 'in_progress') return { download: { ...download } };
        if (Date.now() >= deadline) return { state: 'timeout', ...(download ? { download: { ...download } } : {}) };
        await Promise.race([notification, new Promise(resolve => { timer = setTimeout(resolve, deadline - Date.now()); })]);
      } finally { clearTimeout(timer); this.listeners.delete(changed); }
    }
  }

  async delay(milliseconds) {
    let changed, timer;
    try {
      await Promise.race([
        new Promise(resolve => { timer = setTimeout(resolve, milliseconds); }),
        new Promise(resolve => { changed = () => { if (this.stopped || this.invalid) resolve(); }; this.listeners.add(changed); changed(); }),
      ]);
      if (this.stopped || this.invalid) throw new Error('TAKEOVER_REQUIRED');
    } finally { clearTimeout(timer); this.listeners.delete(changed); }
  }

  async action(args) {
    if (this.invalid) throw new Error('TARGET_CONNECTION_REQUIRED');
    if (args.action === 'wait') return this.wait(args.selector, args);
    const element = args.selector ? await this.resolve(args.selector) : undefined;
    if (args.action === 'read') {
      const observed = await this.observe({ root_ref: element.ref, limit: 1 });
      return { node: observed.nodes[0] };
    }
    if (['click', 'fill'].includes(args.action) && !element) throw new Error('INVALID_REQUEST');
    if (args.action === 'fill') {
      if (typeof args.text !== 'string' || args.text.length > 20000 || !['textbox', 'searchbox', 'combobox'].includes(element.role)) throw new Error('INVALID_REQUEST');
      await this.editText(element, args.text, true);
    } else if (args.action === 'click' || args.action === 'pointer_click' || args.action === 'double_click') {
      let x = args.x, y = args.y;
      let target = this.transport;
      if (element) {
        target = element.frame.session;
        await this.effect(() => target.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: element.backendNodeId }));
        const { quads } = await target.send('DOM.getContentQuads', { backendNodeId: element.backendNodeId });
        if (!quads?.length) throw new Error('ELEMENT_NOT_FOUND');
        x = (quads[0][0] + quads[0][2] + quads[0][4] + quads[0][6]) / 4;
        y = (quads[0][1] + quads[0][3] + quads[0][5] + quads[0][7]) / 4;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error('INVALID_REQUEST');
      for (let clickCount = 1; clickCount <= (args.action === 'double_click' ? 2 : 1); clickCount++) {
        await this.input(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount, x, y });
        await this.input(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount, x, y });
      }
    } else if (args.action === 'type') {
      if (typeof args.text !== 'string' || args.text.length > 20000) throw new Error('INVALID_REQUEST');
      await this.editText(undefined, args.text, false);
    } else if (args.action === 'key') {
      if (element) await this.effect(() => element.frame.session.send('DOM.focus', { backendNodeId: element.backendNodeId }));
      const parameters = browserKey(args.key, this.privateInput);
      const target = element?.frame.session || this.transport;
      await this.input(target, 'Input.dispatchKeyEvent', { type: 'keyDown', ...parameters });
      const release = { ...parameters }; delete release.text;
      await this.input(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...release });
    } else if (args.action === 'scroll') {
      if (!Number.isFinite(args.delta_y) || !Number.isFinite(args.delta_x ?? 0)) throw new Error('INVALID_REQUEST');
      const target = element?.frame.session || this.transport;
      const model = element ? (await target.send('DOM.getBoxModel', { backendNodeId: element.backendNodeId })).model : undefined;
      const explicitPoint = args.x !== undefined || args.y !== undefined;
      if (explicitPoint && (!Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.y < 0)) throw new Error('INVALID_REQUEST');
      const x = model ? model.content[0] + 1 : explicitPoint ? args.x : 1;
      const y = model ? model.content[1] + 1 : explicitPoint ? args.y : 1;
      await this.input(target, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaY: args.delta_y, deltaX: args.delta_x || 0 });
    } else if (args.action === 'drag') {
      for (const key of ['from_x', 'from_y', 'to_x', 'to_y']) if (!Number.isFinite(args[key]) || args[key] < 0) throw new Error('INVALID_REQUEST');
      await this.input(this.transport, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: args.from_x, y: args.from_y });
      await this.input(this.transport, 'Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: args.to_x, y: args.to_y });
      await this.input(this.transport, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: args.to_x, y: args.to_y });
    } else throw new Error('INVALID_REQUEST');
    return { action_executed: true, execution_mode: 'background' };
  }
}
