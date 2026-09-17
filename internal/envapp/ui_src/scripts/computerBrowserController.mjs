import { BrowserComputerPage } from './computerBrowserPage.mjs';

const rejections = new Set(['INVALID_REQUEST', 'STALE_REFERENCE', 'AMBIGUOUS_ELEMENT', 'ELEMENT_NOT_FOUND', 'CONDITION_TIMEOUT', 'TARGET_CAPABILITY_UNAVAILABLE', 'TARGET_CONNECTION_REQUIRED', 'TARGET_NOT_READY', 'TARGET_NOT_ALLOWED', 'TAKEOVER_REQUIRED']);

// One tool/safety/result path for the managed helper and the extension. The
// Runtime passes each invocation's current grants; the page never owns them.
export class BrowserComputerController {
  constructor(transport) {
    this.transport = transport;
    this.page = new BrowserComputerPage(transport);
    this.userInControl = false;
  }
  async initialize() { await this.page.initialize(); }
  close() { this.page.close(); }
  cancel() { this.page.cancel(); }
  async capture() {
    const { data } = await this.transport.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    return { mime: 'image/png', data };
  }
  pause(safety, executed) {
    this.userInControl = true;
    return { result: { code: 'TAKEOVER_REQUIRED', action_executed: executed }, safety };
  }
  async targetChange(executed) {
    const opener = this.transport.tabId === undefined
      ? (await this.transport.send('Target.getTargetInfo')).targetInfo.targetId : String(this.transport.tabId);
    return { result: { target_changed: true, opener_tab_id: opener,
      opened_pages: this.page.openedPages, action_executed: executed, execution_mode: 'background' },
      safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false } };
  }
  async readObservation(read) {
    const revision = this.page.revision;
    try {
      const result = await read();
      if (revision !== this.page.revision) throw new Error('OBSERVATION_INVALIDATED');
      return result;
    } catch (error) {
      if (revision !== this.page.revision) throw new Error('OBSERVATION_INVALIDATED');
      throw error;
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
        this.userInControl = true;
      } else {
        if (request.return_control) {
          if (request.tool_name !== 'computer.screenshot') throw new Error('TARGET_NOT_ALLOWED');
          page.handback();
        } else if (this.userInControl) return this.pause({ level: 'takeover', reason_codes: ['user_control'], safe_to_capture: false, safe_to_send_to_model: false }, false);
        if (request.tool_name === 'computer.select_target' && !page.stopped) {
          page.openedPages = [];
          return { result: { selected: true, action_executed: false },
            safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false } };
        }
        await this.readObservation(() => page.beginObservation());
        const before = await page.safety();
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
      const after = await page.safety();
      if (after.level === 'takeover') return this.pause(after, dispatched());
      if (page.openedPages.length) return await this.targetChange(dispatched());
      const needsFrame = tool === 'computer.screenshot' || (tool === 'computer.observe' ? args.screenshot === true : request.script_operation !== true);
      const captureRevision = page.revision;
      const frame = needsFrame ? await this.readObservation(() => this.capture()) : undefined;
      const captured = await page.safety();
      if (captured.level === 'takeover') return this.pause(captured, dispatched());
      if (frame && captureRevision !== page.revision) {
        // A safe navigation can finish during capture. Keep the confirmed
        // effect, discard observations from the old document and let the next
        // call inspect the new one without inventing a user takeover.
        throw new Error('OBSERVATION_INVALIDATED');
      }
      if (request.return_control) this.userInControl = false;
      const metadata = await this.readObservation(async () => {
        const { frameTree } = await this.transport.send('Page.getFrameTree');
        const title = await page.inFrame({ session: this.transport, frame: frameTree.frame }, 'document.title');
        return { url: frameTree.frame.url, title };
      });
      return { result: { ...result, summary: tool === 'computer.action' ? args.action : tool, ...metadata,
        action_executed: dispatched(), execution_mode: 'background', ...(page.downloads.size ? { downloads: [...page.downloads.values()] } : {}) }, safety: captured, ...(frame ? { screenshot: frame } : {}) };
    } catch (error) {
      if (page.uncertainEffect) return { error: 'EFFECT_OUTCOME_UNKNOWN' };
      if (page.requiredOrigin || page.guardFailure || page.stopped) return this.pause({ level: 'takeover', reason_codes: [page.requiredOrigin ? 'site_permission' : page.guardFailure ? 'unknown' : 'user_control'],
        safe_to_capture: false, safe_to_send_to_model: false, ...(page.requiredOrigin ? { required_origin: page.requiredOrigin } : {}) }, dispatched());
      if (page.openedPages.length) return await this.targetChange(dispatched());
      if (error.message === 'OBSERVATION_INVALIDATED') return {
        result: { observation_invalidated: true, action_executed: dispatched(), execution_mode: 'background' },
        safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false },
      };
      return { error: rejections.has(error.message) ? error.message : dispatched() ? 'EFFECT_OUTCOME_UNKNOWN' : 'TARGET_ACTION_FAILED' };
    }
  }
}
