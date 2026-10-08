import { BrowserComputerPage, BrowserNavigationError } from './computerBrowserPage.mjs';

const rejections = new Set(['INVALID_REQUEST', 'STALE_REFERENCE', 'AMBIGUOUS_ELEMENT', 'ELEMENT_NOT_FOUND', 'CONDITION_TIMEOUT', 'TARGET_CAPABILITY_UNAVAILABLE', 'TARGET_CONNECTION_REQUIRED', 'TARGET_NOT_READY', 'TARGET_NOT_ALLOWED', 'TAKEOVER_REQUIRED']);

// One tool/safety/result path for the managed helper and the extension. The
// Runtime passes each invocation's current grants; the page never owns them.
export class BrowserComputerController {
  constructor(transport, pageOptions) {
    this.transport = transport;
    this.page = new BrowserComputerPage(transport, pageOptions);
  }
  async initialize() { await this.page.initialize(); }
  close() { this.page.close(); }
  cancel() { this.page.cancel(); }
  async capture() {
    const { data } = await this.transport.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    return { mime: 'image/png', data };
  }
  pause(safety, executed) {
    return { result: { code: 'TAKEOVER_REQUIRED', action_executed: executed }, safety };
  }
  async targetChange(executed) {
    const opener = this.transport.tabId === undefined
      ? (await this.transport.send('Target.getTargetInfo')).targetInfo.targetId : String(this.transport.tabId);
    return { result: { target_changed: true, opener_tab_id: opener,
      opened_pages: this.page.openedPages, action_executed: executed, execution_mode: 'background' },
      safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false } };
  }
  async readObservation(read, stage = 'semantic_read') {
    const revision = this.page.revision;
    // Only repeat reads, never executeOperation or an input. Do not restart the
    // privacy observer here: a secret transition remains latched after input.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await read();
        // Confirmed privacy evidence wins over a concurrent frame change.
        if (stage === 'safety_scan' && result.level === 'takeover') return result;
        if (revision !== this.page.revision) throw new Error('OBSERVATION_INVALIDATED');
        return result;
      } catch (error) {
        if (this.page.invalid || this.page.guardFailure) throw new Error('TARGET_CONNECTION_REQUIRED');
        if (revision !== this.page.revision) throw new Error('OBSERVATION_INVALIDATED');
        if (rejections.has(error.message)) throw error;
        if (attempt === 1) throw Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'), { observationStage: stage });
      }
    }
  }
  async execute(request) {
    const response = await this.executeOperation(request);
    try { await this.page.releaseInput(); }
    catch {
      this.page.close();
      await this.page.releasePage();
      return { error: 'EFFECT_OUTCOME_UNKNOWN' };
    }
    if (this.page.uncertainEffect || response.error === 'EFFECT_OUTCOME_UNKNOWN') {
      this.page.close();
      await this.page.releasePage();
      return { error: 'EFFECT_OUTCOME_UNKNOWN' };
    }
    return response;
  }
  async executeOperation(request) {
    // The Runtime's source owner changes this mode under the same target gate
    // as AI execution. An old tool request cannot observe a user-owned page.
    if (this.page.userBrowsing && request.user_control !== true) return { error: 'TARGET_NOT_ALLOWED' };
    // Trusted host command; not exposed in the model toolset. It reveals the
    // existing page without inspecting pixels or changing the control barrier.
    if (request.tool_name === 'computer.reveal') {
      try { await this.transport.send('Page.bringToFront'); return { result: { revealed: true } }; }
      catch { return { error: 'TARGET_CONNECTION_REQUIRED' }; }
    }
    const args = request.args || {};
    const privateInput = request.user_control === true;
    const page = this.page;
    page.fullAccess = request.full_access === true;
    page.allowedOrigins = new Set(Array.isArray(request.allowed_origins) ? request.allowed_origins : []);
    page.privateInput = privateInput;
    const initialEffects = page.effectCount;
    page.uncertainEffect = false;
    const dispatched = () => page.effectCount > initialEffects;
    try {
      if (privateInput) {
        if (!['computer.screenshot', 'computer.click', 'computer.key', 'computer.type', 'computer.scroll'].includes(request.tool_name)) throw new Error('TARGET_NOT_ALLOWED');
      } else {
        if (request.recovery_observation) {
          if (!['computer.observe', 'computer.screenshot'].includes(request.tool_name)) throw new Error('TARGET_NOT_ALLOWED');
          page.handback();
        }
        if (request.tool_name === 'computer.select_target' && !page.stopped) {
          page.openedPages = [];
          return { result: { selected: true, action_executed: false },
            safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false } };
        }
        await this.readObservation(() => page.beginObservation(), 'frame_inventory');
        const before = await this.readObservation(() => page.safety(), 'safety_scan');
        if (before.level === 'takeover') return this.pause(before, false);
      }
      if (!privateInput && page.openedPages.length) return await this.targetChange(false);
      await page.preparePage();
      let result = {};
      const tool = request.tool_name;
      if (tool === 'computer.observe') result.observation = await this.readObservation(() => page.observe(args));
      else if (tool === 'computer.screenshot') { /* Capture only at the boundary below. */ }
      else if (tool === 'computer.wait') {
        if (!Number.isFinite(args.milliseconds) || args.milliseconds < 0 || args.milliseconds > 30000) throw new Error('INVALID_REQUEST');
        await page.delay(args.milliseconds);
      } else if (tool === 'browser.wait_for_download') {
        result = await page.waitForDownload(args);
      } else if (tool.startsWith('browser.')) {
        let url, entryId;
        if (tool === 'browser.navigate') url = args.url;
        else if (tool === 'browser.back') {
          const history = await this.transport.send('Page.getNavigationHistory');
          const previous = history.entries[history.currentIndex - 1];
          if (!previous) throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
          url = previous.url; entryId = previous.id;
        } else if (tool === 'browser.reload') url = (await this.transport.send('Page.getFrameTree')).frameTree.frame.url;
        else throw new Error('INVALID_REQUEST');
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('INVALID_REQUEST');
        if (!privateInput && !page.allowsOrigin(parsed.origin)) return this.pause({ level: 'takeover', reason_codes: ['site_permission'], required_origin: parsed.origin, safe_to_capture: false, safe_to_send_to_model: false }, false);
        const command = tool === 'browser.back' ? 'Page.navigateToHistoryEntry' : tool === 'browser.reload' ? 'Page.reload' : 'Page.navigate';
        result = await page.navigate(command, entryId !== undefined ? { entryId } : tool === 'browser.reload' ? {} : { url }) || {};
      } else {
        const operation = tool === 'computer.action' ? args : {
          ...args, action: { 'computer.click': 'pointer_click', 'computer.double_click': 'double_click', 'computer.type': 'type', 'computer.key': 'key', 'computer.scroll': 'scroll', 'computer.drag': 'drag' }[tool],
        };
        if (!operation.action) throw new Error('INVALID_REQUEST');
        result = await page.action(operation);
      }
      if (privateInput) return tool === 'computer.screenshot' ? { screenshot: await this.capture() } : { acknowledged: true };
      const after = await this.readObservation(() => page.safety(), 'safety_scan');
      if (after.level === 'takeover') return this.pause(after, dispatched());
      if (page.openedPages.length) return await this.targetChange(dispatched());
      const needsFrame = tool === 'computer.screenshot' || (tool === 'computer.observe' ? args.screenshot === true : request.script_operation !== true);
      const captureRevision = page.revision;
      const frame = needsFrame ? await this.readObservation(() => this.capture(), 'capture') : undefined;
      const captured = await this.readObservation(() => page.safety(), 'safety_scan');
      if (captured.level === 'takeover') return this.pause(captured, dispatched());
      if (frame && captureRevision !== page.revision) {
        // A safe navigation can finish during capture. Keep the confirmed
        // effect, discard observations from the old document and let the next
        // call inspect the new one without inventing a user takeover.
        throw new Error('OBSERVATION_INVALIDATED');
      }
      const metadata = await this.readObservation(async () => {
        const { frameTree } = await this.transport.send('Page.getFrameTree');
        const title = await page.inFrame({ session: this.transport, frame: frameTree.frame }, 'document.title');
        return { url: frameTree.frame.url, title };
      }, 'metadata');
      return { result: { ...result, summary: tool === 'computer.action' ? args.action : tool, ...metadata,
        action_executed: dispatched(), execution_mode: 'background', ...(page.downloads.size ? { downloads: [...page.downloads.values()] } : {}) }, safety: captured, ...(frame ? { screenshot: frame } : {}) };
    } catch (error) {
      if (page.uncertainEffect) return { error: 'EFFECT_OUTCOME_UNKNOWN' };
      if (page.guardFailure) return { error: 'TARGET_CONNECTION_REQUIRED' };
      if (page.requiredOrigin || page.stopped) return this.pause({ level: 'takeover', reason_codes: [page.requiredOrigin ? 'site_permission' : 'user_control'],
        safe_to_capture: false, safe_to_send_to_model: false, ...(page.requiredOrigin ? { required_origin: page.requiredOrigin } : {}) }, dispatched());
      if (error.message === 'TARGET_OBSERVATION_UNAVAILABLE') return {
        error: 'TARGET_OBSERVATION_UNAVAILABLE',
        result: { action_executed: dispatched(), observation_stage: error.observationStage },
      };
      if (page.openedPages.length) return await this.targetChange(dispatched());
      if (error.message === 'OBSERVATION_INVALIDATED') return {
        result: { observation_invalidated: true, action_executed: dispatched(), execution_mode: 'background' },
        safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false },
      };
      if (error instanceof BrowserNavigationError) return { error: error.message, result: error.result };
      return { error: rejections.has(error.message) ? error.message : dispatched() ? 'EFFECT_OUTCOME_UNKNOWN' : 'TARGET_ACTION_FAILED' };
    }
  }
}
