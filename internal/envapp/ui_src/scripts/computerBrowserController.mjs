import { BrowserComputerPage, BrowserNavigationError, BrowserObservationInvalidated, navigationURL, redactedNavigationURL } from './computerBrowserPage.mjs';
import { adapterFailure } from './computerBrowserEvaluation.mjs';
import { argumentFailure, validateBrowserAction, validateNavigationOptions } from './computerBrowserArguments.mjs';
import { viewportGeometry, sameGeometry, screenshotGeometry, imageCoordinates } from './computerBrowserFrame.mjs';

// Internal invocation metadata, removed before any result crosses the adapter.
const observationRevision = Symbol('observationRevision');
const inputReceipt = Symbol('inputReceipt');
// These operations return delivery facts, not page content or application state.
const receiptActions = new Set(['click','pointer_click','double_click','hover','fill','type','key','scroll','drag','input_sequence']);

const rejections = new Set(['INVALID_REQUEST', 'ELEMENT_NOT_ACTIONABLE', 'AMBIGUOUS_DOWNLOAD', 'STALE_REFERENCE', 'AMBIGUOUS_ELEMENT', 'ELEMENT_NOT_FOUND', 'CONDITION_TIMEOUT', 'TARGET_CAPABILITY_UNAVAILABLE', 'TARGET_PERMISSION_REQUIRED', 'TARGET_CONNECTION_REQUIRED', 'TARGET_NOT_READY', 'TARGET_NOT_ALLOWED', 'TAKEOVER_REQUIRED']);

// One tool/safety/result path for the managed helper and the extension. The
// Runtime passes each invocation's current grants; the page never owns them.
export class BrowserComputerController {
  constructor(transport, pageOptions) {
    this.transport = transport;
    this.page = new BrowserComputerPage(transport, pageOptions);
  }
  async initialize() { await this.page.initialize(); }
  close() { this.page.close(); }
  cancel(internal = false) { this.page.cancel(internal); }
  async capture(targetID) {
    const before = targetID ? await viewportGeometry(this.transport) : undefined;
    // Let Chromium capture its complete rendered viewport. A CSS-sized clip is
    // not a screenshot-pixel rectangle under browser zoom or device scaling.
    const { data } = await this.transport.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    if (!before) return { mime: 'image/png', data };
    const after = await viewportGeometry(this.transport);
    if (!sameGeometry(before,after)) throw Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'), { observationStage: 'capture', observationReason: 'viewport_unstable' });
    return { mime: 'image/png', data, geometry: screenshotGeometry(data,after,`${this.page.prefix}:${this.page.revision}`,targetID) };
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
  async readObservation(read, stage = 'semantic_read', identity = this.page.observationIdentity()) {
    const deadline = Date.now() + 1000;
    // Only a measured viewport mismatch has a bounded settling window.
    // Unknown failures stop this read; no input or privacy state is replayed.
    for (;;) {
      try {
        const result = await read();
        // Confirmed privacy evidence wins over a concurrent frame change.
        if (stage === 'safety_scan' && result.level === 'takeover') return result;
        if (!this.page.identityCurrent(identity)) throw new BrowserObservationInvalidated();
        return result;
      } catch (error) {
        if (this.page.invalid || this.page.guardFailure) throw new Error('TARGET_CONNECTION_REQUIRED');
        if (error instanceof BrowserObservationInvalidated || rejections.has(error.message)) throw error;
        if (error.observationReason === 'viewport_unstable') {
          if (Date.now() >= deadline) throw error;
          // Sample again within the invocation budget without replaying input
          // or resetting the privacy latch. Cancellation interrupts the delay.
          await this.page.delay(Math.min(32, deadline - Date.now()));
          if (!this.page.identityCurrent(identity)) throw new BrowserObservationInvalidated();
          continue;
        }
        throw Object.assign(new Error('TARGET_OBSERVATION_UNAVAILABLE'), { observationStage: stage, protocolDiagnostic: error.protocolDiagnostic || adapterFailure(stage, 'internal_error').protocolDiagnostic });
      }
    }
  }
  async execute(request) {
    const beforeEffects = this.page.effectCount;
    this.actionCompleted = false;
    this.effectStart = {preparations:this.page.preparationCount, posted:this.page.inputPosted, acknowledged:this.page.inputAcknowledged};
    let response = await this.executeOperation(request);
    try { await this.page.releaseInput(); }
    catch {
      this.frameAnchor = undefined;
      this.page.close();
      await this.page.releasePage();
      return this.unknownEffect('input_release');
    }
    if (this.page.uncertainEffect || response.error === 'EFFECT_OUTCOME_UNKNOWN') {
      this.frameAnchor = undefined;
      this.page.close();
      await this.page.releasePage();
      return this.unknownEffect();
    }
    if (request.script_operation === true && ['browser.navigate', 'browser.back', 'browser.reload'].includes(request.tool_name)
      && !response.error && response.result?.observation_invalidated) {
      // Receipt-only publication still respects control changes during cleanup.
      // It carries no current-page content and needs no additional page scan.
      if (this.page.invalid || this.page.guardFailure || this.page.requiredURL || this.page.requiredOrigin || this.page.stopped || this.page.operationCancelled)
        response = await this.operationFailure(new Error('TARGET_CONNECTION_REQUIRED'), request, beforeEffects);
      else if (this.page.openedPages.length) response = await this.targetChange(this.actionCompleted);
    }
    if (response[inputReceipt]) {
      delete response[inputReceipt];
      try {
        // Keep real privacy/control boundaries. A failed optional read cannot
        // revoke acknowledged input or export unchecked page content.
        const safety = await this.readObservation(() => this.page.safety(), 'safety_scan');
        if (safety.level === 'takeover') response = this.pause(safety, this.actionCompleted);
      } catch (error) {
        if (error.message !== 'TARGET_OBSERVATION_UNAVAILABLE' && !(error instanceof BrowserObservationInvalidated))
          response = await this.operationFailure(error, request, beforeEffects);
        else response.result.post_action_check = {state:'unavailable', ...(error.protocolDiagnostic ? {diagnostic:error.protocolDiagnostic} : {})};
      }
      if (this.page.invalid || this.page.guardFailure || this.page.requiredURL || this.page.requiredOrigin || this.page.stopped || this.page.operationCancelled)
        response = await this.operationFailure(new Error('TARGET_CONNECTION_REQUIRED'), request, beforeEffects);
      else if (this.page.openedPages.length) response = await this.targetChange(this.actionCompleted);
    }
    if (response[observationRevision] !== undefined) {
      // Cleanup may yield to navigation, cancellation or privacy changes. The
      // complete observation remains bound to its original document until this
      // final publication boundary; no read or effect is replayed here.
      const identity = response[observationRevision];
      delete response[observationRevision];
      try {
        const safety = await this.readObservation(() => this.page.safety(), 'safety_scan');
        if (safety.level === 'takeover') response = this.pause(safety, this.actionCompleted);
        else {
          if (this.page.invalid || this.page.guardFailure || this.page.requiredURL || this.page.requiredOrigin
            || this.page.stopped || this.page.operationCancelled) throw new Error('TARGET_CONNECTION_REQUIRED');
          if (this.page.openedPages.length) response = await this.targetChange(this.actionCompleted);
          else {
            if (!this.page.identityCurrent(identity)) throw new BrowserObservationInvalidated();
            response.safety = safety;
          }
        }
      } catch (error) { response = await this.operationFailure(error, request, beforeEffects); }
    }
    // A viewer-only sample never replaces the model anchor. Input retires the
    // old anchor unless this operation returned a newly captured model frame.
    if ((this.page.effectCount > beforeEffects && !response.result?.frame_geometry)
      || response.error || response.safety?.level === 'takeover'
      || response.result?.target_changed || response.result?.observation_invalidated) {
      this.frameAnchor = undefined;
    } else if (response.result?.frame_geometry) this.frameAnchor = response.result.frame_geometry;
    if (response.result && this.effectStart) Object.assign(response.result, this.effectProgress());
    return response;
  }
  effectProgress() {
    const page = this.page, start = this.effectStart;
    if (!start) return {};
    const posted = page.inputPosted - start.posted, observed = page.inputAcknowledged - start.acknowledged;
    return {...(page.preparationCount > start.preparations ? {preparation_executed:true} : {}),
      ...(posted ? {input_progress:{stage:'input_delivery',posted,observed}} : {})};
  }
  unknownEffect(stage = this.page.effectStage || 'action') {
    return { error: 'EFFECT_OUTCOME_UNKNOWN', result: { stage, reason: 'response_unavailable', needs_observation: true, ...this.effectProgress() } };
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
    page.allowedNavigationURLs = new Set(Array.isArray(request.allowed_navigation_urls) ? request.allowed_navigation_urls.map(redactedNavigationURL) : []);
    if (page.fullAccess || (request.tool_name === 'browser.navigate' && page.allowsURL(args.url))) page.requiredURL = undefined;
    page.privateInput = privateInput;
    const initialEffects = page.effectCount;
    page.uncertainEffect = false;
    page.effectStage = undefined;
    const dispatched = () => this.actionCompleted || request.tool_name.startsWith('browser.') && page.effectCount > initialEffects;
    try {
      const navigationOptions = ['browser.navigate','browser.back','browser.reload'].includes(request.tool_name) ? validateNavigationOptions(args) : undefined;
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
        if (request.tool_name === 'computer.action' && args.action === 'wait') {
          validateBrowserAction(args, false);
          return await this.waitForCondition(request, args);
        }
        await this.readObservation(() => page.beginObservation(), 'frame_inventory');
        const before = await this.readObservation(() => page.safety({ authorizedNavigation: request.tool_name === 'browser.navigate' && page.allowsURL(args.url) }), 'safety_scan');
        if (before.level === 'takeover') return this.pause(before, false);
      }
      if (!privateInput && page.openedPages.length) return await this.targetChange(false);
      let result = {}, read;
      const tool = request.tool_name;
      if (tool === 'computer.observe') read = async () => ({observation:await page.observe(args)});
      else if (tool === 'computer.screenshot') { /* Capture only at the boundary below. */ }
      else if (tool === 'computer.wait') {
        const milliseconds = args.milliseconds ?? 0;
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 30000) throw argumentFailure('milliseconds', 'integer_0_30000');
        await page.delay(milliseconds);
      } else if (tool === 'browser.download_cursor') {
        result = page.downloadCursor();
      } else if (tool === 'browser.wait_for_download') {
        result = await page.waitForDownload(args);
      } else if (tool === 'browser.read_download') {
        if (!page.readDownload) throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
        result = await page.readDownload(args);
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
        const parsed = navigationURL(url);
        if (!privateInput && !page.allowsURL(parsed.href)) return { error: 'TARGET_PERMISSION_REQUIRED', result: { action_executed: false, required_navigation_url: redactedNavigationURL(parsed.href) } };
        const command = tool === 'browser.back' ? 'Page.navigateToHistoryEntry' : tool === 'browser.reload' ? 'Page.reload' : 'Page.navigate';
        result = await page.navigate(command, entryId !== undefined ? { entryId } : tool === 'browser.reload' ? {} : { url }, navigationOptions) || {};
        this.actionCompleted = true;
        if (request.script_operation === true) {
          // Navigation has its own acknowledged effect and load boundary. A
          // receipt contains no page content: the next explicit read owns its
          // privacy scan, document lifetime and any observation failure.
          if (page.invalid || page.guardFailure || page.requiredURL || page.requiredOrigin || page.stopped || page.operationCancelled) throw new Error('TARGET_CONNECTION_REQUIRED');
          if (page.openedPages.length) return await this.targetChange(dispatched());
          return { result: { ...result, action_executed: dispatched(), needs_observation: true, observation_invalidated: true, execution_mode: 'background' },
            safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false } };
        }
      } else {
        const operation = tool === 'computer.action' ? args : {
          ...args, action: { 'computer.click': 'pointer_click', 'computer.double_click': 'double_click', 'computer.type': 'type', 'computer.key': 'key', 'computer.scroll': 'scroll', 'computer.drag': 'drag' }[tool],
        };
        if (!operation.action) throw new Error('INVALID_REQUEST');
        validateBrowserAction(operation, privateInput);
        const mapped = operation.frame !== undefined || operation.coordinate_space !== undefined || operation.document_id !== undefined
          ? imageCoordinates(operation, this.frameAnchor, await this.readObservation(() => viewportGeometry(this.transport), 'capture'), `${page.prefix}:${page.revision}`, request.target_id) : operation;
        // Every semantic read uses the same error/observation boundary.
        // Invalid inputs remain rejections; read failures never retire a source.
        if (['read','text','query','table','attribute','source','geometry','selection','capabilities'].includes(mapped.action) || mapped.action==='clipboard'&&mapped.operation!=='write') read = () => page.action(mapped);
        else {
          result = await page.action(mapped);
          this.actionCompleted = page.effectCount > initialEffects;
          if (request.script_operation === true && !privateInput && receiptActions.has(mapped.action)) {
            // Closed delivery facts survive document replacement. No title,
            // URL, page values or arbitrary adapter fields cross this boundary.
            const receipt = {action_executed:dispatched(), needs_observation:true, observation_invalidated:true, execution_mode:'background'};
            for (const key of ['mechanism','completed_events','input_dispatched','preparation_executed','scroll_progress','point','preparation'])
              if (result[key] !== undefined) receipt[key] = result[key];
            return {[inputReceipt]:true, result:receipt, safety:{level:'routine',reason_codes:[],safe_to_capture:false,safe_to_send_to_model:false}};
          }
        }
      }
      if (privateInput) return tool === 'computer.screenshot' ? { screenshot: await this.capture() } : { acknowledged: true };
      return await this.observeResult(request, read || (async () => result), dispatched());
    } catch (error) { return await this.operationFailure(error, request, initialEffects); }
  }

  async operationFailure(error, request, initialEffects) {
    const page = this.page, args = request.args || {};
    const dispatched = () => this.actionCompleted || request.tool_name.startsWith('browser.') && page.effectCount > initialEffects;
    const affected = () => page.effectCount > initialEffects;
    if (page.uncertainEffect) return this.unknownEffect();
    if (error.focusRejected) return { error: 'ELEMENT_NOT_ACTIONABLE', result: {
      action_executed: false, needs_observation: false, stage: 'focus', reason: 'not_focusable',
    } };
    if (error.diagnostic) return { error: error.message, result: { action_executed: dispatched(), needs_observation: affected(), diagnostic: error.diagnostic } };
    if (page.guardFailure || page.invalid) return { error: 'TARGET_CONNECTION_REQUIRED', result: { action_executed: dispatched(), needs_observation: affected() } };
    if (page.requiredURL) return { error: 'TARGET_PERMISSION_REQUIRED', result: { action_executed: dispatched(), required_navigation_url: page.requiredURL, needs_observation: true } };
    if (page.requiredOrigin || page.stopped) return this.pause({ level: 'takeover', reason_codes: [page.requiredOrigin ? 'site_permission' : 'user_control'],
      safe_to_capture: false, safe_to_send_to_model: false, ...(page.requiredOrigin ? { required_origin: page.requiredOrigin } : {}) }, dispatched());
    if (page.operationCancelled) return { error: 'TARGET_OBSERVATION_UNAVAILABLE',
      result: { action_executed: dispatched(), needs_observation: true, observation_stage: 'semantic_read' } };
    if (error.message === 'TARGET_OBSERVATION_UNAVAILABLE') return {
      error: 'TARGET_OBSERVATION_UNAVAILABLE',
      result: { action_executed: dispatched(), needs_observation: true, observation_stage: error.observationStage, ...(error.protocolDiagnostic ? {diagnostic:error.protocolDiagnostic} : {}), ...(error.observationReason === 'viewport_unstable' ? {reason:'viewport_unstable'} : {}) },
    };
    if (page.openedPages.length) return await this.targetChange(dispatched());
    if (error instanceof BrowserObservationInvalidated) return {
      result: { observation_invalidated: true, reason:error.observationReason, observation_stage:error.observationStage || 'semantic_read', action_executed: dispatched(), execution_mode: 'background' },
      safety: { level: 'routine', reason_codes: [], safe_to_capture: false, safe_to_send_to_model: false },
    };
    if (error instanceof BrowserNavigationError) return { error: error.message, result: error.result };
    if (error.message === 'AMBIGUOUS_DOWNLOAD') return { error: error.message, result: { action_executed: false, downloads: error.downloads } };
    if (error.message === 'ELEMENT_NOT_ACTIONABLE') return { error: error.message,
      result: { action_executed: false, needs_observation: affected(), preparation_executed: page.preparationCount > (this.effectStart?.preparations ?? page.preparationCount), ...(error.actionability ? {actionability:error.actionability} : {}) } };
    return { error: rejections.has(error.message) ? error.message : affected() ? 'EFFECT_OUTCOME_UNKNOWN' : 'TARGET_ACTION_FAILED',
      result: { action_executed: dispatched(), needs_observation: affected() || error.message === 'STALE_REFERENCE', ...(error.permissionReason === 'extension_file_access' ? { permission_reason: 'extension_file_access', ...(args.url ? { required_navigation_url: redactedNavigationURL(args.url) } : {}) } : {}) } };
  }

  async observeResult(request, read, effectExecuted = false, {metadata: includeMetadata = true, validateSample = false} = {}) {
    const page = this.page, tool = request.tool_name, args = request.args || {};
    const needsFrame = tool === 'computer.screenshot' || (tool === 'computer.observe' ? args.screenshot === true : request.script_operation !== true);
    const identity = page.observationIdentity(needsFrame ? undefined : args.root_ref || args.selector?.ref || args.selector?.root_ref);
    if (page.requiredURL) return { error: 'TARGET_PERMISSION_REQUIRED', result: { action_executed: effectExecuted, required_navigation_url: page.requiredURL, needs_observation: true } };
    if (page.openedPages.length) return await this.targetChange(effectExecuted);
    const result = await this.readObservation(read, 'semantic_read', identity);
    const frame = needsFrame ? await this.readObservation(() => this.capture(request.live_frame ? undefined : request.target_id), 'capture') : undefined;
    const metadata = includeMetadata ? await this.readObservation(async () => {
      const { frameTree } = await this.transport.send('Page.getFrameTree');
      const title = await page.inFrame({ session: this.transport, frame: frameTree.frame }, 'document.title', value => typeof value === 'string');
      return { url: redactedNavigationURL(frameTree.frame.url), title };
    }, 'metadata') : {};
    // Entry and final publication own ordinary read scans. Condition waits
    // also validate each internal sample without resetting privacy latches.
    const captured = validateSample ? await this.readObservation(() => page.safety(), 'safety_scan') : undefined;
    if (captured?.level === 'takeover') return this.pause(captured, effectExecuted);
    if (!page.identityCurrent(identity)) throw new BrowserObservationInvalidated();
    if (page.operationCancelled) throw new Error('BROWSER_TOOL_CANCELLED');
    return { [observationRevision]: identity, result: { ...result, ...(frame?.geometry ? {frame_geometry:frame.geometry} : {}), summary: tool === 'computer.action' ? args.action : tool, ...metadata,
      action_executed: effectExecuted, execution_mode: 'background', ...(page.downloads.size ? { downloads: [...page.downloads.values()] } : {}) }, safety: captured, ...(frame ? { screenshot: frame } : {}) };
  }

  async waitForCondition(request, args) {
    const page = this.page;
    const started = Date.now(), timeout = args.timeout_ms ?? 10000;
    const deadline = started + timeout;
    let samples = 0;
    let observationStarted = false, entryValidated = false;
    for (;;) {
      let changed, timer;
      const sampleRevision = page.revision;
      const notification = new Promise(resolve => { changed = resolve; page.listeners.add(changed); });
      try {
        if (page.stopped || page.operationCancelled || page.invalid || page.guardFailure) throw new Error('TARGET_CONNECTION_REQUIRED');
        try {
          samples++;
          // Preparation is part of the caller's explicit wait deadline. Begin
          // only once: a resample must not erase transient privacy evidence.
          if (!observationStarted) {
            observationStarted = true;
            await this.readObservation(() => page.beginObservation(), 'frame_inventory');
          }
          if (!entryValidated) {
            const before = await this.readObservation(() => page.safety(), 'safety_scan');
            if (before.level === 'takeover') return this.pause(before, false);
            entryValidated = true;
          }
          if (page.openedPages.length) return await this.targetChange(false);
          const response = await this.observeResult(request, () => page.conditionState(args.selector, args), false, {metadata:false,validateSample:true});
          if (response.safety?.level === 'takeover' || response.result?.target_changed || response.error
            || response.result?.state !== 'timeout' || Date.now() >= deadline) {
            if (response.result?.state) Object.assign(response.result, {requested_state:args.state ?? 'visible', timeout_ms:timeout, elapsed_ms:Date.now()-started, samples});
            return response;
          }
        } catch (error) {
          // Only typed document or temporary query-candidate evidence discards a sample.
          // The same selector, permission scope and original deadline remain.
          const invalidated = error instanceof BrowserObservationInvalidated
            || error.protocolDiagnostic?.phase === 'protocol' && sampleRevision !== page.revision && !rejections.has(error.message);
          if (!invalidated || page.stopped || page.operationCancelled || page.requiredURL || page.requiredOrigin
            || page.invalid || page.guardFailure || Date.now() >= deadline) throw error;
        }
        await Promise.race([notification, new Promise(resolve => { timer = setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))); })]);
      } finally { clearTimeout(timer); page.listeners.delete(changed); }
    }
  }
}
