// Xpra HTML5 v20/v21 owns rendering, input, clipboard and transient-window stacking.
// This adapter owns the application's viewport and one reconnectable viewer.
(() => {
  const frame = document.getElementById('application');
  const retry = document.getElementById('retry');
  let generation = 0;
  let timer;
  let deadline;
  let request;
  let client;
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
  const {controls, toolbar, menu, windowToggle, windowCount, controlsButton, close, quit,
    popover, windowPanel, windowList, quitPanel, cancelQuit, confirmQuit} = createHostApplicationToolbar();
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
  picturePanel.append(pictureTitle, modes, pictureHint);
  popover.append(windowPanel, picturePanel, quitPanel);
  const panels = {windows:windowPanel, picture:picturePanel, quit:quitPanel};
  const toggles = {windows:windowToggle, picture:controlsButton, quit};
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
    const opening = panelSection !== section;
    collapseControls();
    if (!opening || toggles[section].disabled) return;
    panelSection = section; popover.dataset.section = section;
    popover.hidden = false; panels[section].hidden = false;
    toggles[section].setAttribute('aria-expanded', 'true'); positionPopover();
    (section === 'quit' ? cancelQuit : section === 'picture' ? modeButtons.get(picture.mode)
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
  hostApplicationAppearance.subscribe(() => { syncToolbar(); positionPopover(); });
  function applyPicture() {
    if (!client?.connected) return;
    const [quality, speed] = {auto:[-1,-1], clarity:[95,-1], smooth:[65,90], data:[40,75]}[picture.mode];
    client.send(['quality', quality]); client.send(['speed', speed]);
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

  function present(state) {
    hostApplicationConnection.present(state);
    syncToolbar();
    if (state !== 'active') collapseControls();
    frame.inert = state !== 'active';
    frame.setAttribute('aria-hidden', String(state !== 'active'));
    frame.tabIndex = state === 'active' ? 0 : -1;
  }

  function stopClient() {
    const previous = client;
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
    if (hostApplicationConnection.ended(state) && wasActive) {
      if (nativeWindow) nativeWindow.request('close');
      else window.close();
    }
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

  function installClient(attempt) {
    const doc = frame.contentDocument;
    const xpra = frame.contentWindow.redevenXpraClient();
    if (xpra && client === xpra) return;
    if (!xpra || typeof xpra._new_window !== 'function' || typeof xpra.do_send_damage_sequence !== 'function') throw new Error('Unsupported Xpra HTML5 client');
    client = xpra;
    // Input inside the same-origin application document does not bubble to the
    // toolbar document. Observe it before Xpra handles it, without consuming it.
    const dismissControls = () => { if (attempt === generation && client === xpra) collapseControls(); };
    doc.addEventListener('pointerdown', dismissControls, true);
    doc.addEventListener('focusin', dismissControls, true);
    xpra.reconnect = false;
    xpra.reconnect_count = 0;
    xpra.callback_close = () => connectionLost(attempt);
    doc.addEventListener('connection-lost', () => connectionLost(attempt));
    doc.addEventListener('connection-established', () => {
      if (attempt !== generation || Object.keys(xpra.id_to_window).length) return;
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
    // Keep upstream input controls intact; application windows own all visible space.
    const style = doc.createElement('style');
    style.textContent = 'html,body,#screen{background:transparent!important;background-image:none!important}#float_menu,#toolbar,#progress,#notifications,.spinneroverlay{display:none!important}.redeven-primary{border:0!important;border-radius:0!important;box-shadow:none!important}.redeven-primary>.windowhead,.redeven-primary>.ui-resizable-handle{display:none!important}';
    doc.head.append(style);
    doc.documentElement.style.backgroundColor = getComputedStyle(document.body).backgroundColor;

    const setFocus = xpra.set_focus;
    xpra.set_focus = function(win) { setFocus.call(this, win); syncToolbar(); };
    function trackWindow(win) {
      if (windows.has(win.wid)) return;
      const button = document.createElement('button'), label = document.createElement('span');
      button.append(label);
      button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
      button.onclick = () => {
        if (attempt !== generation || xpra.id_to_window[win.wid] !== win) return;
        xpra.set_focus(win); collapseControls(); frame.focus();
      };
      windows.set(win.wid, {win, button, label}); windowList.append(button);
      const metadata = win.update_metadata, destroy = win.destroy;
      win.update_metadata = function(value) { metadata.call(this, value); if (attempt === generation) syncToolbar(); };
      win.destroy = function() {
        destroy.call(this);
        if (attempt !== generation) return;
        windows.delete(win.wid); button.remove(); syncToolbar();
      };
      syncToolbar();
    }
    const primaryWindows = new Set();
    const paintableWindows = new Set();
    function syncWindowState(win) {
      const state = nativeState || {maximized:true, minimized:false};
      xpra.send_configure_window(win, {maximized:state.maximized, iconified:state.minimized}, false);
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
        // A headless display may be larger than the viewer. Keep dialog controls
        // reachable by negotiating a bounded size, never scaling their pixels.
        const resized = win.screen_resized;
        win.screen_resized = function() {
          resized.call(this);
          const [width, height] = xpra._get_desktop_size();
          const maxWidth = Math.max(1, width - this.leftoffset - this.rightoffset - 24);
          const maxHeight = Math.max(1, height - this.topoffset - this.bottomoffset - 24);
          this.w = Math.min(this.w, maxWidth);
          this.h = Math.min(this.h, maxHeight);
          this.x = Math.max(this.leftoffset + 12, Math.min(this.x, width - this.w - this.rightoffset - 12));
          this.y = Math.max(this.topoffset + 12, Math.min(this.y, height - this.h - this.bottomoffset - 12));
          this.handle_resized();
        };
        win.screen_resized();
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
          maximize.call(win, true);
        };
        win.set_minimized = value => {
          if (attempt === generation && nativeState && value && !nativeState.minimized) nativeWindow.request('minimize');
        };
        win.initiate_moveresize = () => {};
        const moveResize = win.move_resize;
        win.move_resize = function(...args) {
          moveResize.apply(this, args);
          this.screen_resized();
        };
        win.update_metadata({'decorations':false});
        maximize.call(win, true);
        syncWindowState(win);
      }
      win.screen_resized();
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
      if (document.body.dataset.state === 'active') return;
      // Reveal only after the server has painted, including the offscreen-worker path.
      requestAnimationFrame(() => {
        if (attempt !== generation) return;
        clearTimeout(deadline);
        present('active');
        wasActive = true;
        frame.focus();
      });
    };
    if (picture.mode !== 'auto') applyPicture();
    if (xpra.connected) xpra.send_control_refresh(100, {'refresh-now':true});
  }

  frame.addEventListener('load', () => {
    if (!attached || frame.contentWindow.location.href === 'about:blank') return;
    const attempt = generation;
    try {
      if (frame.contentWindow.location.pathname !== config.base + '/index.html') { connectionLost(attempt); return; }
      // The upstream page initializes after an asynchronous defaults request;
      // document load can precede client creation on a cached reload.
      // Upstream v21 declares client with let, which is not a window property.
      // Read the page's global binding inside its own realm, without eval or
      // altering installed upstream files. This also supports v20's var binding.
      const bridge = frame.contentDocument.createElement('script');
      bridge.textContent = 'window.redevenXpraClient = () => typeof client === "undefined" ? null : client;';
      frame.contentDocument.head.append(bridge);
      bridge.remove();
      if (frame.contentWindow.redevenXpraClient()) installClient(attempt);
      else frame.contentDocument.addEventListener('connection-established', () => {
        if (attempt !== generation) return;
        try { installClient(attempt); }
        catch (error) { console.error('Host application viewer initialization failed', error); finish('failed'); }
      }, {once:true});
    } catch (error) { console.error('Host application viewer initialization failed', error); finish('failed'); }
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
