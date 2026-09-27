// Xpra owns rendering, pointer transport, clipboard and transient-window stacking.
// Published Floe remote-pointer exclusively owns remote content gestures.
// Published Floe remote-input exclusively owns local keyboard and composition.
// This adapter owns the application's viewport and one reconnectable viewer.
(() => {
  const frame = document.getElementById('application');
  const retry = document.getElementById('retry');
  let generation = 0;
  let timer;
  let deadline;
  let request;
  let client;
  let displayState;
  let unsubscribeDisplay;
  let appliedPicture;
  let inputController;
  let pointerController;
  let pointerFeedback;
  let keyboardVisible = false;
  let attached = false;
  let wasActive = false;
  const nativeWindow = window.redevenHostApplicationWindow;
  let nativeState;
  let applyNativeState = () => {};
  const unsubscribeWindow = nativeWindow?.subscribe(state => {
    const changed = nativeState?.maximized !== state.maximized || nativeState?.minimized !== state.minimized;
    nativeState = state;
    if (changed) applyNativeState();
  });

  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    const icon = document.getElementById('icon');
    icon.src = config.icon;
    icon.hidden = false;
    document.getElementById('fallback-icon').setAttribute('hidden', '');
  }

  document.body.classList.add('mac-app-viewer');
  frame.classList.add('host-app-frame');
  const {controls, toolbar, menu, windowToggle, windowCount, controlsButton, keyboard, help, helpPanel, close, quit,
    popover, windowPanel, windowList, quitPanel, cancelQuit, confirmQuit} = createHostApplicationToolbar();
  keyboard.onclick = () => {
    const visible = !keyboardVisible;
    collapseControls(); pointerController?.reset(); inputController?.reset();
    inputController?.setKeyboardVisible(visible);
  };
  keyboard.addEventListener('mousedown', event => event.preventDefault());
  controls.addEventListener('pointerdown', event => {
    pointerController?.reset();
    if (!keyboard.contains(event.target)) inputController?.reset();
  }, true);
  // Linux applications expose their own menus inside their rendered windows.
  const identity = document.createElement('div');
  identity.className = 'host-app-identity';
  identity.append(...menu.childNodes);
  identity.querySelector('.mac-app-dropdown-chevron').remove();
  menu.replaceWith(identity);
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    const icon = document.createElement('img');
    icon.src = config.icon; icon.alt = ''; icon.className = 'mac-app-toolbar-icon';
    identity.querySelector('svg').replaceWith(icon);
  }
  const windows = new Map();
  const inputNotice = document.createElement('aside');
  inputNotice.className = 'host-app-input-notice'; inputNotice.hidden = true;
  inputNotice.setAttribute('role', 'status');
  const inputNoticeTitle = document.createElement('strong');
  const inputNoticeHint = document.createElement('p');
  inputNotice.append(inputNoticeTitle, inputNoticeHint); document.body.append(inputNotice);
  const picture = {mode:'auto'};
  try {
    const saved = localStorage.getItem('redeven.xpra-app.picture.v1');
    if (['auto', 'clarity', 'smooth', 'data'].includes(saved)) picture.mode = saved;
  } catch { /* Preferences are optional. */ }
  const picturePanel = document.createElement('section');
  picturePanel.className = 'mac-app-picture';
  const pictureTitle = document.createElement('strong'); hostApplicationAppearance.copy(pictureTitle, 'picture');
  const {modes, modeButtons} = createHostApplicationPictureModes(picture, () => {
    try { localStorage.setItem('redeven.xpra-app.picture.v1', picture.mode); } catch { /* Preferences are optional. */ }
    applyPicture();
  });
  const pictureHint = document.createElement('p'); hostApplicationAppearance.copy(pictureHint, 'pictureHint');
  const decoding = document.createElement('div'); decoding.className = 'mac-app-picture-statistics';
  const decodingRow = document.createElement('div');
  const decodingLabel = document.createElement('span'); hostApplicationAppearance.copy(decodingLabel, 'videoDecoding');
  const decodingStatus = document.createElement('output'); decodingStatus.className = 'host-app-video-status';
  hostApplicationAppearance.copy(decodingStatus, 'videoUnavailable');
  decodingRow.append(decodingLabel, decodingStatus); decoding.append(decodingRow);
  const resolutionRow = document.createElement('div'); resolutionRow.hidden = true;
  const resolutionLabel = document.createElement('span'); hostApplicationAppearance.copy(resolutionLabel, 'pictureRenderResolution');
  const resolution = document.createElement('output'); resolution.className = 'host-app-render-resolution';
  resolutionRow.append(resolutionLabel, resolution); decoding.prepend(resolutionRow);
  const displayNotice = document.createElement('div'); displayNotice.className = 'host-app-display-notice';
  displayNotice.hidden = true; displayNotice.setAttribute('role', 'status');
  const displayNoticeTitle = document.createElement('strong'); hostApplicationAppearance.copy(displayNoticeTitle, 'pictureLimited');
  const displayNoticeHint = document.createElement('p');
  displayNotice.append(displayNoticeTitle, displayNoticeHint);
  const httpsHint = document.createElement('p'); httpsHint.className = 'host-app-https-hint';
  hostApplicationAppearance.copy(httpsHint, 'httpsPerformanceHint');
  httpsHint.hidden = window.isSecureContext;
  picturePanel.append(pictureTitle, modes, pictureHint, displayNotice, decoding, httpsHint);
  popover.append(windowPanel, picturePanel, helpPanel, quitPanel);
  const panels = {windows:windowPanel, picture:picturePanel, help:helpPanel, quit:quitPanel};
  const toggles = {windows:windowToggle, picture:controlsButton, help, quit};
  let panelSection;
  function positionPopover() {
    if (!panelSection) return;
    const anchor = toggles[panelSection].getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popover.offsetWidth - 8))}px`;
  }
  function collapseControls(restore = false) {
    const toggle = toggles[panelSection];
    panelSection = null; popover.hidden = true;
    for (const panel of Object.values(panels)) panel.hidden = true;
    for (const toggle of Object.values(toggles)) toggle.setAttribute('aria-expanded', 'false');
    if (restore && toggle && !toggle.disabled) toggle.focus({preventScroll:true});
  }
  function toggleControls(section) {
    pointerController?.reset(); inputController?.reset();
    const opening = panelSection !== section;
    collapseControls();
    if (!opening || toggles[section].disabled) return;
    panelSection = section; popover.dataset.section = section;
    popover.hidden = false; panels[section].hidden = false;
    toggles[section].setAttribute('aria-expanded', 'true'); positionPopover();
    (section === 'help' ? helpPanel : section === 'quit' ? cancelQuit : section === 'picture' ? modeButtons.get(picture.mode)
      : windowList.querySelector('[aria-pressed="true"]') || windowList.querySelector('button'))?.focus();
  }
  function currentWindow() {
    return windows.get(client?.focused_wid)?.win || [...windows.values()].find(entry => entry.win.focused)?.win
      || windows.values().next().value?.win;
  }
  function syncToolbar() {
    const active = document.body.dataset.state === 'active' && client?.connected;
    controls.hidden = !nativeWindow && !active;
    for (const button of toolbar.querySelectorAll('button')) button.disabled = !active || !windows.size;
    keyboard.disabled = !active || !client?.floeInput?.target;
    windowCount.textContent = hostApplicationAppearance.number(windows.size); windowCount.hidden = windows.size < 2;
    const current = currentWindow();
    const title = current?.metadata.title || config.copy.windows;
    windowToggle.querySelector('.mac-app-toolbar-label').textContent = title;
    windowToggle.title = `${config.copy.windows} · ${hostApplicationAppearance.number(windows.size)} — ${title}`;
    windowToggle.setAttribute('aria-label', windowToggle.title);
    for (const {win, button, label} of windows.values()) {
      label.textContent = win.metadata.title || document.title;
      button.title = label.textContent;
      button.setAttribute('aria-pressed', String(win === current));
    }
    if (!toolbar.querySelector('button:not(:disabled)[tabindex="0"]')) {
      const first = toolbar.querySelector('button:not(:disabled)');
      for (const button of toolbar.querySelectorAll('button')) button.tabIndex = button === first ? 0 : -1;
    }
  }
  hostApplicationAppearance.subscribe(() => {
    syncToolbar(); renderDisplay();
    inputController?.element.setAttribute('aria-label', config.copy.input);
  });
  function renderDisplay() {
    resolutionRow.hidden = !displayState?.available;
    if (displayState?.available) {
      const text = `${hostApplicationAppearance.number(displayState.width)} × ${hostApplicationAppearance.number(displayState.height)}`;
      if (resolution.textContent !== text) resolution.textContent = text;
    }
    const limited = displayState && !displayState.available ? 'backend' : picture.mode === 'clarity' && displayState?.limit;
    displayNotice.hidden = !limited;
    if (limited) {
      const key = limited === 'backend' ? 'pictureBackendLimitHint' : limited === 'display' ? 'pictureDisplayLimitHint' : 'pictureDensityLimitHint';
      if (displayNoticeHint.getAttribute('data-app-copy') !== key) hostApplicationAppearance.copy(displayNoticeHint, key);
    }
    positionPopover();
  }
  function applyPicture() {
    if (!client?.connected || appliedPicture === picture.mode) return;
    appliedPicture = picture.mode;
    const [quality, speed] = {auto:[-1,-1], clarity:[95,-1], smooth:[65,90], data:[40,75]}[picture.mode];
    const clarity = picture.mode === 'clarity';
    client.set_display_density(clarity ? 'native' : 'logical');
    renderDisplay();
    client.send(['quality', quality]); client.send(['speed', speed]);
    client.send_control_refresh(100, {'refresh-now':true});
  }
  for (const [section, toggle] of Object.entries(toggles)) {
    toggle.setAttribute('aria-controls', popover.id); toggle.setAttribute('aria-expanded', 'false');
    if (section === 'quit') toggle.setAttribute('aria-haspopup', 'dialog');
    toggle.onclick = () => toggleControls(section);
  }
  close.onclick = () => {
    collapseControls(); const win = currentWindow();
    if (client?.connected && win) client.send_close_window(win);
    frame.focus();
  };
  cancelQuit.onclick = () => collapseControls(true);
  confirmQuit.onclick = () => {
    collapseControls(true);
    // Ask the application's top-level windows to close normally. Do not shut
    // down Xpra or destroy a process: unsaved-work dialogs must remain operable.
    if (!client?.connected) return;
    const top = [...windows.values()].filter(({win}) => !win.metadata['transient-for'] && !win.metadata.modal && !win.has_windowtype(['DIALOG']));
    for (const {win} of top) client.send_close_window(win);
    frame.focus();
  };
  toolbar.addEventListener('focusin', event => {
    for (const button of toolbar.querySelectorAll('button')) button.tabIndex = button === event.target ? 0 : -1;
  });
  toolbar.addEventListener('keydown', event => {
    const buttons = [...toolbar.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowRight' ? buttons[(index + 1) % buttons.length]
      : event.key === 'ArrowLeft' ? buttons[(index - 1 + buttons.length) % buttons.length]
      : event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1) : null;
    if (next) { event.preventDefault(); collapseControls(); next.focus(); }
    if (event.key === 'ArrowDown') {
      const section = Object.keys(toggles).find(key => toggles[key] === document.activeElement);
      if (section) { event.preventDefault(); if (panelSection !== section) toggleControls(section); }
    }
  });
  windowList.addEventListener('keydown', event => {
    const buttons = [...windowList.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? buttons[(index + 1) % buttons.length]
      : event.key === 'ArrowUp' ? buttons[(index - 1 + buttons.length) % buttons.length]
      : event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1) : null;
    if (next) { event.preventDefault(); next.focus(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!popover.contains(event.target) && !toggles[panelSection]?.contains(event.target)) collapseControls();
  }, true);
  controls.addEventListener('focusout', event => {
    if (event.relatedTarget && !popover.contains(event.relatedTarget) && !toggles[panelSection]?.contains(event.relatedTarget)) collapseControls();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panelSection) { event.preventDefault(); event.stopImmediatePropagation(); collapseControls(true); }
  }, true);
  frame.addEventListener('focus', () => collapseControls());
  window.addEventListener('resize', positionPopover);
  // Focusing the child input also blurs the parent window. Only leaving the
  // viewer document invalidates its gesture; the child owns its own blur.
  window.addEventListener('blur', () => { if (!document.hasFocus()) pointerController?.reset(); });
  for (const type of ['pagehide', 'resize', 'orientationchange']) window.addEventListener(type, () => pointerController?.reset());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pointerController?.reset(); });
  for (const type of ['resize', 'scroll']) window.visualViewport?.addEventListener(type, () => pointerController?.reset());

  function present(state) {
    hostApplicationConnection.present(state);
    syncToolbar();
    if (state !== 'active') collapseControls();
    frame.inert = state !== 'active';
    frame.setAttribute('aria-hidden', String(state !== 'active'));
    frame.tabIndex = state === 'active' ? 0 : -1;
  }

  function stopClient() {
    unsubscribeDisplay?.(); unsubscribeDisplay = undefined;
    displayState = undefined; appliedPicture = undefined; renderDisplay();
    inputNotice.hidden = true;
    const previous = client;
    pointerController?.dispose(); pointerController = null;
    pointerFeedback?.dispose(); pointerFeedback = null;
    inputController?.dispose(); inputController = null;
    client = null;
    windows.clear(); windowList.replaceChildren(); syncToolbar();
    attached = false;
    applyNativeState = () => {};
    if (previous) {
      previous.callback_close = () => {};
      previous.close();
    }
    frame.removeAttribute('src');
  }

  function finish(state) {
    generation++;
    clearTimeout(timer);
    clearTimeout(deadline);
    request?.abort();
    stopClient();
    present(state);
    // Only a confirmed ended session closes an established viewer. Application
    // save dialogs and transport loss must keep the physical window available.
    hostApplicationConnection.dismissEnded(state, wasActive);
    if (!retry.hidden) retry.focus({preventScroll:true});
  }

  async function connectionLost(attempt) {
    if (attempt !== generation) return;
    finish('checking');
    const current = generation;
    const controller = new AbortController();
    request = controller;
    deadline = setTimeout(() => { if (current === generation) finish('disconnected'); }, 6000);
    try {
      const data = await hostApplicationConnection.read(controller.signal);
      if (current === generation && !controller.signal.aborted)
        finish(['running', 'starting'].includes(data.state) ? 'disconnected' : data.state);
    } catch { if (current === generation && !controller.signal.aborted) finish('disconnected'); }
  }

  function preparedClient(attempt) {
    if (attempt !== generation) return null;
    const prepared = frame.contentWindow.floeXpraViewer;
    if (prepared?.version !== 1 || typeof prepared.getClient !== 'function' || typeof prepared.capabilities !== 'function') {
      finish('viewerPreparationFailed');
      return null;
    }
    return prepared;
  }

  function installClient(attempt) {
    const prepared = preparedClient(attempt);
    if (!prepared) return;
    const doc = frame.contentDocument;
    const xpra = prepared.getClient();
    if (xpra && client === xpra) return;
    if (!xpra || typeof xpra._new_window !== 'function' || typeof xpra.do_send_damage_sequence !== 'function' ||
        !xpra.floeInput || !xpra.floePointer || typeof xpra.set_window_layout !== 'function' || typeof xpra.set_display_density !== 'function') {
      finish('viewerPreparationFailed'); return;
    }
    client = xpra;
    unsubscribeDisplay = xpra.subscribe_display?.(state => {
      if (attempt !== generation || client !== xpra) return;
      displayState = state; renderDisplay();
    });
    const adapter = xpra.floeInput;
    const pointer = xpra.floePointer;
    const surface = doc.getElementById('screen') || doc.body;
    inputController = hostApplicationInput.createRemoteInput({
      surface, label: config.copy.input,
      commitText(text, target) { gestures.flush(); adapter.commitText(text, target); },
      sendKey(key, target) { gestures.flush(); adapter.sendKey(key, target); },
      release: target => adapter.release(target),
      clipboard(event, target) { gestures.flush(); return adapter.clipboard(event, target); },
      onKeyboardVisibilityChange(visible) { keyboardVisible = visible; keyboard.setAttribute('aria-pressed', String(visible)); },
    });
    const controller = inputController;
    controller.element.addEventListener('paste', event => { gestures.flush(); adapter.paste(event, adapter.target); });
    adapter.onError = () => {
      if (attempt !== generation) return;
      if (prepared.capabilities(xpra).input === 'unavailable') finish('inputUnavailable');
      else { gestures.reset(); controller.reset(); syncInput(); }
    };
    function syncInput() {
      if (attempt !== generation) return;
      const wid = xpra.focused_wid;
      const win = xpra.id_to_window[wid];
      const capability = prepared.capabilities(xpra);
      controller.bindTarget(adapter.bindTarget(capability.input === 'ready' && capability.pointer === 'ready' && win && pointer.targetForWindow(win) ? wid : null));
      const restricted = xpra.connected && (['unsupported', 'restart-required'].includes(capability.input) || capability.pointer !== 'ready');
      inputNotice.hidden = !restricted;
      if (restricted) {
        const title = capability.input === 'restart-required' ? 'inputVersionUnsupported' : 'inputUnsupported';
        const hint = capability.input === 'restart-required' ? 'inputVersionHint' : 'inputUnsupportedHint';
        if (inputNoticeTitle.getAttribute('data-app-copy') !== title) hostApplicationAppearance.copy(inputNoticeTitle, title);
        if (inputNoticeHint.getAttribute('data-app-copy') !== hint) hostApplicationAppearance.copy(inputNoticeHint, hint);
      }
      syncToolbar();
    }
    pointerFeedback = createHostApplicationHoldFeedback(doc);
    pointerController = hostApplicationPointer.createRemotePointer({
      surface,
      resolveTarget: event => prepared.capabilities(xpra).pointer === 'ready' ? pointer.resolveTarget(event) : null,
      isTargetValid: target => attempt === generation && client === xpra && prepared.capabilities(xpra).pointer === 'ready' && pointer.isTargetValid(target),
      sendPointer: (command, target) => pointer.sendPointer(command, target),
      release: target => pointer.release(target),
      onActivate(position, target) {
        collapseControls();
        if (xpra.focused_wid !== target.wid) xpra.set_focus(target.window);
        syncInput();
        controller.setAnchor(position.clientX, position.clientY);
        if (position.pointerType !== 'touch' || keyboardVisible) {
          // Return focus from local toolbar controls to the embedded document
          // before focusing its input; Firefox otherwise keeps the parent active.
          frame.focus();
          controller.focus();
        }
      },
      onHoldChange: pointerFeedback.update,
    });
    const gestures = pointerController;
    pointer.onInvalidate = () => gestures.reset();
    // The embedded Xpra document does not bubble through the toolbar document.
    // Capture only dismisses local chrome; the pointer controller remains the
    // sole owner of remote content events.
    const dismissControls = () => { if (attempt === generation && client === xpra) collapseControls(); };
    doc.addEventListener('pointerdown', dismissControls, true);
    doc.addEventListener('focusin', dismissControls, true);
    xpra.reconnect = false;
    xpra.reconnect_count = 0;
    xpra.callback_close = () => connectionLost(attempt);
    doc.addEventListener('connection-lost', () => connectionLost(attempt));
    let pictureConfigured = false;
    doc.addEventListener('connection-established', () => {
      if (attempt !== generation) return;
      configureConnectedPicture();
      if (Object.keys(xpra.id_to_window).length) return;
      clearTimeout(deadline);
      present('waiting');
    });
    const lastWindow = xpra.on_last_window;
    xpra.on_last_window = function() {
      lastWindow.call(this);
      // This hook is emitted for a server-confirmed window destruction, never
      // for the client's bulk cleanup on network loss. Finish after packet handling.
      queueMicrotask(() => {
        if (attempt === generation && wasActive && Object.keys(xpra.id_to_window).length === 0) finish('windowsClosed');
      });
    };
    // The prepared upstream page has no local keyboard owners. Application windows own all visible space.
    const style = doc.createElement('style');
    style.textContent = 'html,body,#screen{background:transparent!important;background-image:none!important}#float_menu,#toolbar,#progress,#notifications,.spinneroverlay{display:none!important}.redeven-primary{border:0!important;border-radius:0!important;box-shadow:none!important}.redeven-primary>.windowhead,.redeven-primary>.ui-resizable-handle{display:none!important}';
    style.textContent += hostApplicationInput.style + hostApplicationPointer.style;
    doc.head.append(style);
    doc.documentElement.style.backgroundColor = getComputedStyle(document.body).backgroundColor;

    const setFocus = xpra.set_focus;
    xpra.set_focus = function(win) { setFocus.call(this, win); syncInput(); };
    function trackWindow(win) {
      if (windows.has(win.wid)) return;
      const button = document.createElement('button'), label = document.createElement('span');
      button.append(label);
      button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
      button.onclick = () => {
        if (attempt !== generation || xpra.id_to_window[win.wid] !== win) return;
        gestures.reset(); xpra.set_focus(win); collapseControls(); frame.focus();
      };
      windows.set(win.wid, {win, button, label}); windowList.append(button);
      const metadata = win.update_metadata, destroy = win.destroy;
      win.update_metadata = function(value) { metadata.call(this, value); if (attempt === generation) syncToolbar(); };
      win.destroy = function() {
        destroy.call(this);
        if (attempt !== generation) return;
        windows.delete(win.wid); button.remove(); syncInput();
      };
      syncToolbar();
    }
    const primaryWindows = new Set();
    const paintableWindows = new Set();
    function syncWindowState(win) {
      if (nativeState) xpra.send_configure_window(win, {maximized:nativeState.maximized, iconified:nativeState.minimized}, false);
    }
    applyNativeState = () => {
      if (attempt !== generation) return;
      for (const wid of primaryWindows) {
        const win = xpra.id_to_window[wid];
        if (win) syncWindowState(win);
      }
    };
    function fit(win) {
      if (!win || win.override_redirect || win.tray) return;
      if (win.metadata['transient-for'] || win.metadata.modal || win.has_windowtype(['DIALOG'])) {
        paintableWindows.add(win.wid);
        trackWindow(win);
        xpra.set_window_layout(win.wid, 'dialog');
        return;
      }
      if (win.windowtype.length && !win.has_windowtype(['NORMAL'])) return;
      paintableWindows.add(win.wid);
      trackWindow(win);
      if (!primaryWindows.has(win.wid)) {
        primaryWindows.add(win.wid);
        win.div.classList.add('redeven-primary');
        // Filling the viewport is a rendering detail. The native window owns the
        // actual maximize/minimize state reported back to the host application.
        const maximize = win.set_maximized;
        win.set_maximized = value => {
          if (attempt !== generation) return;
          if (nativeState && Boolean(value) !== nativeState.maximized) nativeWindow.request(value ? 'maximize' : 'unmaximize');
          maximize.call(win, value);
        };
        win.set_minimized = value => {
          if (attempt === generation && nativeState && value && !nativeState.minimized) nativeWindow.request('minimize');
        };
        win.initiate_moveresize = () => {};
        win.update_metadata({'decorations':false});
        xpra.set_window_layout(win.wid, 'viewport');
        syncWindowState(win);
      }
    }
    const newWindow = xpra._new_window;
    xpra._new_window = function(...args) {
      newWindow.apply(this, args);
      fit(this.id_to_window[args[0]]);
      if (attempt === generation && document.body.dataset.state === 'waiting') {
        present('connecting');
        deadline = setTimeout(() => { if (attempt === generation) finish('failed'); }, 45000);
      }
    };
    Object.values(xpra.id_to_window).forEach(fit);

    const damage = xpra.do_send_damage_sequence;
    xpra.do_send_damage_sequence = function(sequence, wid, width, height, decodeTime, message) {
      damage.call(this, sequence, wid, width, height, decodeTime, message);
      if (attempt !== generation || !paintableWindows.has(wid) || !xpra.id_to_window[wid] || decodeTime < 0 || message) return;
      syncInput();
      if (document.body.dataset.state === 'active') return;
      // Reveal only after the server has painted, including the offscreen-worker path.
      requestAnimationFrame(() => {
        if (attempt !== generation) return;
        clearTimeout(deadline);
        present('active');
        syncInput();
        wasActive = true;
        frame.focus();
      });
    };
    function configureConnectedPicture() {
      if (pictureConfigured) return;
      pictureConfigured = true;
      // Decoder capabilities and saved preferences become authoritative after startup.
      const videoAvailable = xpra.supported_encodings?.some(codec => ['h264', 'vp8', 'vp9', 'av1'].includes(codec));
      hostApplicationAppearance.copy(decodingStatus, videoAvailable ? 'videoAvailable' : 'videoUnavailable');
      if (picture.mode !== 'auto') applyPicture();
      else { appliedPicture = 'auto'; xpra.send_control_refresh(100, {'refresh-now':true}); }
      syncInput();
    }
    if (xpra.connected) configureConnectedPicture();
  }

  frame.addEventListener('load', () => {
    if (!attached || frame.contentWindow.location.href === 'about:blank') return;
    const attempt = generation;
    try {
      if (frame.contentWindow.location.pathname !== config.base + '/index.html') { connectionLost(attempt); return; }
      // The upstream page initializes after an asynchronous defaults request;
      // document load can precede client creation on a cached reload.
      const prepared = preparedClient(attempt);
      if (!prepared) return;
      if (prepared.getClient()) installClient(attempt);
      else frame.contentDocument.addEventListener('connection-established', () => {
        if (attempt !== generation) return;
        try { installClient(attempt); }
        catch (error) { console.error('Host application viewer initialization failed', error); finish('viewerPreparationFailed'); }
      }, {once:true});
    } catch (error) { console.error('Host application viewer initialization failed', error); finish('viewerPreparationFailed'); }
  });

  async function observe(attempt) {
    if (attempt !== generation) return;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const data = await hostApplicationConnection.read(controller.signal);
      if (attempt !== generation) return;
      if (data.state === 'running') {
        if (!attached) {
          sessionStorage.setItem(config.base, JSON.stringify({password:data.password, floating_menu:false, reconnect:false, sound:false, printing:false, file_transfer:false}));
          attached = true;
          present(wasActive ? 'reconnecting' : 'connecting');
          frame.src = config.base + '/index.html';
        }
      } else if (data.state !== 'starting') { finish(data.state); return; }
      timer = setTimeout(() => observe(attempt), attached ? 5000 : 500);
    } catch { if (attempt === generation) finish('disconnected'); }
    finally { clearTimeout(timeout); }
  }

  function connect() {
    generation++;
    clearTimeout(timer);
    clearTimeout(deadline);
    request?.abort();
    stopClient();
    present(wasActive ? 'reconnecting' : 'starting');
    const attempt = generation;
    deadline = setTimeout(() => { if (attempt === generation) finish('disconnected'); }, 45000);
    observe(attempt);
  }
  retry.addEventListener('click', connect);
  window.addEventListener('offline', () => { if (!hostApplicationConnection.terminal(document.body.dataset.state)) finish('disconnected'); });
  window.addEventListener('pagehide', () => { generation++; clearTimeout(timer); clearTimeout(deadline); request?.abort(); stopClient(); unsubscribeWindow?.(); });
  if (hostApplicationConnection.initial) present(hostApplicationConnection.initial);
  else connect();
})();
