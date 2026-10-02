// Native macOS frames and input share the existing authenticated application
// forward. A reconnect reattaches to the bound process, never relaunches it.
(() => {
  const canvas = createHostApplicationCanvas();
  const retry = document.getElementById('retry');
  const native = window.redevenHostApplicationWindow;
  const { controls, toolbar, menu, windowToggle, windowCount, controlsButton, keyboard, help, helpPanel, close, quit, popover, menuPanel, windowPanel, windowList, quitPanel, cancelQuit, confirmQuit, chevron } = createHostApplicationToolbar();
  const windowEntries = new Map();
  let panelSection = null;
  let quitTimer;
  let quitPending = false;
  let quitRequested = false;
  function syncWindowPicker() {
    const available = ['active', 'waiting', 'captureUnavailable'].includes(document.body.dataset.state);
    windowToggle.disabled = !available || windowEntries.size === 0;
    menu.disabled = !available;
    menu.title = `${document.title} — ${config.copy.menu}`;
    menu.setAttribute('aria-label', menu.title);
    quit.disabled = !available || quitPending;
    controlsButton.disabled = document.body.dataset.state !== 'active';
    help.disabled = !available;
    keyboard.disabled = document.body.dataset.state !== 'active' || !current?.window || renderedGeneration !== current.generation;
    windowCount.textContent = hostApplicationAppearance.number(windowEntries.size);
    windowCount.hidden = windowEntries.size < 2;
    for (const [id, entry] of windowEntries) {
      const selected = id === current?.window;
      entry.button.setAttribute('aria-pressed', String(selected));
      entry.button.setAttribute('aria-busy', String(selected && renderedGeneration !== current?.generation));
    }
    const hostTitle = windowEntries.get(current?.window)?.hostTitle;
    const title = hostTitle && hostTitle !== document.title ? hostTitle : config.copy.windows;
    windowToggle.querySelector('.mac-app-toolbar-label').textContent = title;
    windowToggle.title = `${config.copy.windows} · ${hostApplicationAppearance.number(windowEntries.size)}${title === config.copy.windows ? '' : ` — ${title}`}`;
    windowToggle.setAttribute('aria-label', windowToggle.title);
    close.disabled = !available || !current?.window || renderedGeneration !== current.generation;
    if (![...toolbar.querySelectorAll('button')].some(button => !button.disabled && button.tabIndex === 0)) {
      const first = toolbar.querySelector('button:not(:disabled)');
      for (const button of toolbar.querySelectorAll('button')) button.tabIndex = button === first ? 0 : -1;
    }
  }
  function renderWindows(items) {
    const focused = document.activeElement;
    const hadFocus = windowList.contains(focused);
    const ids = new Set(items.map(item => item.id));
    for (const [id, entry] of windowEntries) {
      if (!ids.has(id)) { entry.button.remove(); windowEntries.delete(id); }
    }
    items.forEach((item, index) => {
      let entry = windowEntries.get(item.id);
      if (!entry) {
        const button = document.createElement('button');
        const title = document.createElement('span');
        button.append(title);
        button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
        button.onclick = () => send({action:'select', window:item.id});
        entry = {button, title}; windowEntries.set(item.id, entry);
      }
      const title = item.title || `${document.title} · ${index + 1}`;
      entry.hostTitle = item.title;
      entry.title.textContent = title; entry.button.title = title;
      if (windowList.children[index] !== entry.button) windowList.insertBefore(entry.button, windowList.children[index] || null);
    });
    syncWindowPicker();
    if (hadFocus) (focused.isConnected ? focused : windowToggle.disabled ? menu : windowToggle).focus({preventScroll:true});
    if (!items.length && panelSection === 'windows') collapseControls();
  }
  const picturePanel = document.createElement('section');
  picturePanel.id = 'picture-settings';
  picturePanel.className = 'mac-app-picture';
  hostApplicationAppearance.copy(picturePanel, 'picture', 'aria-label');

  const pictureTitle = document.createElement('strong');
  hostApplicationAppearance.copy(pictureTitle, 'picture');
  picturePanel.append(pictureTitle);
  const picture = { mode: 'auto', max_dimension: 0, frame_rate: 0 };
  const preferenceKey = 'redeven.mac-app.picture.v1';
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey));
    if (saved && ['auto', 'clarity', 'smooth', 'data'].includes(saved.mode)
      && [0, 1600, 1920, 2560, 3840, 4096].includes(saved.max_dimension)
      && [0, 15, 24, 30, 60].includes(saved.frame_rate)) {
      picture.mode = saved.mode;
      picture.max_dimension = saved.max_dimension;
      picture.frame_rate = saved.frame_rate;
    }
  } catch { /* Private browsing may disable preference storage. */ }
  let videoSupported = false;
  const {modes, modeButtons} = createHostApplicationPictureModes(picture, () => { savePicture(); configurePicture(); });
  picturePanel.append(modes);
  const pictureHint = document.createElement('p');
  hostApplicationAppearance.copy(pictureHint, 'pictureHint');
  picturePanel.append(pictureHint);
  const advanced = document.createElement('details');
  const advancedTitle = document.createElement('summary');
  const advancedLabel = document.createElement('span');
  hostApplicationAppearance.copy(advancedLabel, 'pictureAdvanced'); advancedTitle.append(advancedLabel);
  advancedTitle.insertAdjacentHTML('beforeend', chevron);
  advanced.append(advancedTitle);
  for (const [field, title, values, unit] of [
    ['max_dimension', 'pictureResolution', [0, 1600, 1920, 2560, 3840, 4096], 'px'],
    ['frame_rate', 'pictureFrameRate', [0, 15, 24, 30, 60], 'FPS'],
  ]) {
    const label = document.createElement('label');
    const text = document.createElement('span'); hostApplicationAppearance.copy(text, title);
    const select = document.createElement('select');
    hostApplicationAppearance.copy(select, title, 'aria-label');
    for (const value of values) {
      const option = document.createElement('option'); option.value = String(value);
      if (value === 0) hostApplicationAppearance.copy(option, 'pictureAuto');
      else option.textContent = `${value} ${unit}`;
      select.append(option);
    }
    select.value = String(picture[field]);
    select.onchange = () => { picture[field] = Number(select.value); savePicture(); configurePicture(); };
    label.append(text, select); advanced.append(label);
  }
  picturePanel.append(advanced);
  const statistics = document.createElement('div');
  statistics.className = 'mac-app-picture-statistics';
  const statisticValues = {};
  for (const [key, title] of [['resolution', 'picturePixels'], ['rate', 'pictureActualRate'], ['bandwidth', 'pictureBandwidth'], ['transport', 'pictureTransport']]) {
    const row = document.createElement('div');
    const label = document.createElement('span'); hostApplicationAppearance.copy(label, title);
    const value = document.createElement('output'); value.textContent = '—'; hostApplicationAppearance.copy(value, title, 'aria-label');
    statisticValues[key] = value; row.append(label, value); statistics.append(row);
  }
  picturePanel.append(statistics);
  popover.append(windowPanel, picturePanel, helpPanel, menuPanel, quitPanel);
  let receivedBytes = 0, paintedFrames = 0, measuredAt = performance.now();
  const statisticsTimer = setInterval(() => {
    const now = performance.now(), elapsed = (now - measuredAt) / 1000;
    statisticValues.rate.textContent = `${hostApplicationAppearance.number(paintedFrames / elapsed, 1)} FPS`;
    statisticValues.bandwidth.textContent = `${hostApplicationAppearance.number(receivedBytes * 8 / elapsed / 1e6, 2)} Mb/s`;
    receivedBytes = 0; paintedFrames = 0; measuredAt = now;
  }, 1000);
  function savePicture() {
    try { localStorage.setItem(preferenceKey, JSON.stringify(picture)); } catch { /* Preferences are optional. */ }
  }
  let controlling = false;
  function configurePicture(action = 'configure', takeover = false) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const size = viewportSize();
    configuredGeometry = `${size.width}:${size.height}:${devicePixelRatio}`;
    socket.send(JSON.stringify({action, takeover, ...picture, ...size,
      pixel_ratio: Math.min(4, Math.max(0.5, devicePixelRatio || 1)), video: videoSupported}));
  }
  hostApplicationAppearance.subscribe(() => { syncWindowPicker(); positionPopover(); });
  const panels = { windows: windowPanel, picture: picturePanel, help: helpPanel, menu: menuPanel, quit: quitPanel };
  const toggles = { windows: windowToggle, picture: controlsButton, help, menu, quit };
  let menuTimer;
  let menuPath = [];
  for (const [section, toggle] of Object.entries(toggles)) {
    toggle.setAttribute('aria-controls', popover.id);
    toggle.setAttribute('aria-expanded', 'false');
    if (section === 'menu' || section === 'quit') toggle.setAttribute('aria-haspopup', section === 'menu' ? 'menu' : 'dialog');
    toggle.onclick = () => toggleControls(section);
  }
  for (const button of toolbar.querySelectorAll('button')) button.tabIndex = button === menu ? 0 : -1;
  toolbar.addEventListener('focusin', event => {
    if (event.target.tagName !== 'BUTTON') return;
    for (const button of toolbar.querySelectorAll('button')) button.tabIndex = button === event.target ? 0 : -1;
  });
  toolbar.addEventListener('keydown', event => {
    const buttons = [...toolbar.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowRight') next = buttons[(index + 1) % buttons.length];
    if (event.key === 'ArrowLeft') next = buttons[(index - 1 + buttons.length) % buttons.length];
    if (event.key === 'Home') next = buttons[0];
    if (event.key === 'End') next = buttons.at(-1);
    if (next) { event.preventDefault(); collapseControls(); next.focus(); }
    if (event.key === 'ArrowDown') {
      const section = Object.keys(toggles).find(key => toggles[key] === document.activeElement);
      if (section) { event.preventDefault(); if (panelSection !== section) toggleControls(section); }
    }
  });
  function positionPopover() {
    if (popover.hidden || !panelSection) return;
    const anchor = toggles[panelSection].getBoundingClientRect();
    const viewport = hostApplicationViewport.readViewportSnapshot(window);
    popover.style.left = `${Math.max(viewport.visible.left + 8, Math.min(anchor.left, viewport.visible.right - popover.offsetWidth - 8)) + viewport.fixedOffset.left}px`;
  }
  function collapseControls(restoreFocus = false) {
    const toggle = toggles[panelSection];
    panelSection = null;
    clearTimeout(menuTimer);
    popover.hidden = true;
    for (const panel of Object.values(panels)) panel.hidden = true;
    for (const button of Object.values(toggles)) button.setAttribute('aria-expanded', 'false');
    menuPanel.removeAttribute('aria-busy');
    if (restoreFocus && toggle && !toggle.disabled) toggle.focus({preventScroll:true});
  }
  function toggleControls(section) {
    pointerController.reset(); inputController.reset();
    const opening = panelSection !== section;
    collapseControls();
    if (!opening || toggles[section].disabled) return;
    panelSection = section;
    popover.dataset.section = section;
    popover.hidden = false;
    panels[section].hidden = false;
    toggles[section].setAttribute('aria-expanded', 'true');
    positionPopover();
    if (section === 'menu') {
      menuPath = [];
      menuPanel.replaceChildren();
      menuPanel.setAttribute('aria-busy', 'true');
      menuTimer = setTimeout(() => {
        if (panelSection === 'menu') { collapseControls(true); showFeedback('operationFailed'); }
      }, 6000);
      send({action:'menu'});
    } else {
      const selected = windowEntries.get(current?.window)?.button;
      (section === 'help' ? helpPanel : section === 'windows' ? selected || windowList.querySelector('button') : section === 'quit' ? cancelQuit : modeButtons.get(picture.mode))?.focus();
    }
  }
  function parentMenu() {
    const child = menuPath.pop();
    renderMenu(child.id);
  }
  function renderMenu(focusedID) {
    const level = menuPath.at(-1);
    menuPanel.replaceChildren();
    let focused;
    if (menuPath.length > 1) {
      const back = document.createElement('button');
      back.className = 'mac-app-menu-back';
      back.setAttribute('role', 'menuitem');
      back.tabIndex = -1;
      const backLabel = document.createElement('span');
      backLabel.textContent = '‹ ' + level.title;
      back.title = level.title; back.append(backLabel);
      back.onclick = parentMenu;
      menuPanel.append(back);
    }
    for (const item of level.items) {
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      const label = document.createElement('span');
      label.textContent = item.title; button.title = item.title; button.append(label);
      button.disabled = !item.enabled;
      if (item.children.length) {
        button.setAttribute('aria-haspopup', 'menu');
        button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>');
      }
      button.onclick = () => {
        if (item.children.length) { menuPath.push({id:item.id, title:item.title, items:item.children}); renderMenu(); }
        else { send({action:'menu_action', item:item.id}); collapseControls(true); }
      };
      menuPanel.append(button);
      if (item.id === focusedID) focused = button;
    }
    const first = focused || menuPanel.querySelector('button:not(:disabled):not(.mac-app-menu-back)') || menuPanel.querySelector('button:not(:disabled)');
    if (first) { first.tabIndex = 0; first.focus(); }
  }
  // Menu and window lists use native-style arrow navigation without leaking keys
  // into the remotely controlled application.
  for (const list of [menuPanel, windowList]) list.addEventListener('keydown', event => {
    const buttons = [...list.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = buttons[(index + 1) % buttons.length];
    if (event.key === 'ArrowUp') next = buttons[(index - 1 + buttons.length) % buttons.length];
    if (event.key === 'Home') next = buttons[0];
    if (event.key === 'End') next = buttons.at(-1);
    if (next) {
      event.preventDefault();
      if (list === menuPanel) for (const button of buttons) button.tabIndex = button === next ? 0 : -1;
      next.focus();
    }
    if (list === menuPanel && event.key === 'Tab') collapseControls(true);
    if (list === menuPanel && event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault(); document.activeElement.click();
    }
    if (list === menuPanel && event.key === 'ArrowLeft' && menuPath.length > 1) {
      event.preventDefault(); parentMenu();
    }
  });
  cancelQuit.onclick = () => collapseControls(true);
  confirmQuit.onclick = () => {
    collapseControls(true);
    quitPending = true;
    quitRequested = true;
    syncWindowPicker();
    if (!input.disabled) input.focus({preventScroll:true});
    send({action:'quit_application'});
    quitTimer = setTimeout(() => {
      quitPending = false; syncWindowPicker(); showFeedback('quitFailed');
    }, 6000);
  };
  let keyboardVisible = false;
  let scrollRemainder;
  const canvasInput = createHostApplicationCanvasInput({
    canvas, target: () => current, isValid: validPointerTarget,
    commitText(text) { send({action:'input', kind:'text', text}); },
    sendKey(key) { send({action:'input', kind:'key', ...key}); },
    releaseInput(target) { if (target === current) send({action:'release'}); },
    onKeyboardVisibilityChange(visible) { keyboardVisible = visible; keyboard.setAttribute('aria-pressed', String(visible)); },
    sendPointer(command, target) {
      if (!validPointerTarget(target)) return false;
      const {kind, button, clicks} = command;
      let {dx, dy} = command;
      if (kind === 'scroll') {
        // CoreGraphics uses integral pixel wheel packets. Fractions belong
        // only to this target and never survive gesture cancellation.
        if (scrollRemainder?.target !== target) scrollRemainder = {target, x:0, y:0};
        scrollRemainder.x += dx; scrollRemainder.y += dy;
        dx = Math.trunc(scrollRemainder.x); dy = Math.trunc(scrollRemainder.y);
        scrollRemainder.x -= dx; scrollRemainder.y -= dy;
        if (!dx && !dy) return true;
      }
      send({action:'input', kind, button, clicks, dx, dy, ...hostApplicationCanvasPoint(canvas, command)});
    },
    releasePointer(target) { if (scrollRemainder?.target === target) scrollRemainder = null; },
    activate: collapseControls,
  });
  const inputController = canvasInput.input, pointerController = canvasInput.pointer;
  const input = inputController.element;
  hostApplicationAppearance.copy(input, 'input', 'aria-label');
  keyboard.onclick = () => {
    const visible = !keyboardVisible;
    collapseControls(); pointerController.reset(); inputController.reset();
    inputController.setKeyboardVisible(visible);
  };
  // Keep the editor's focus until click toggles it, including Safari touch.
  keyboard.addEventListener('mousedown', event => event.preventDefault());
  controls.addEventListener('pointerdown', event => {
    pointerController.reset();
    if (!keyboard.contains(event.target)) inputController.reset();
  }, true);
  const feedback = document.createElement('div');
  feedback.className = 'mac-app-feedback';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  document.body.append(feedback);
  function showFeedback(key) { hostApplicationAppearance.copy(feedback, key); feedback.hidden = false; }
  let socket,
    attempt = 0,
    active = false,
    renderedGeneration = 0,
    connectedAt = 0,
    firstFrame = false,
    current,
    deadline,
    resizeTimer;
  let abort;
  const icon = document.getElementById('icon');
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    icon.src = config.icon;
    icon.hidden = false;
    document.getElementById('fallback-icon').setAttribute('hidden', '');
    const toolbarIcon = document.createElement('img');
    toolbarIcon.src = config.icon;
    toolbarIcon.alt = '';
    toolbarIcon.className = 'mac-app-toolbar-icon';
    toolbarIcon.setAttribute('aria-hidden', 'true');
    menu.querySelector('svg').replaceWith(toolbarIcon);
  }
  function present(state) {
    hostApplicationConnection.present(state);
    canvas.setAttribute('aria-hidden', String(state !== 'active'));
    canvas.tabIndex = state === 'active' ? 0 : -1;
    controls.hidden = !native && !['active', 'waiting', 'captureUnavailable'].includes(state);
    picturePanel.hidden = state !== 'active' || panelSection !== 'picture';
    syncWindowPicker();
    if (state !== 'active') inputController.bindTarget(null);
    if (state !== 'active') {
      feedback.hidden = true;
      collapseControls();
    }
  }
  function send(value) {
    if (
      socket?.readyState === WebSocket.OPEN &&
      current &&
      (current.window && renderedGeneration === current.generation ||
        ['resize', 'select', 'release', 'menu', 'menu_action', 'quit_application'].includes(value.action))
    )
      socket.send(
        JSON.stringify({
          window: current.window,
          generation: current.generation,
          ...(value.action === 'input' ? {input_version:1} : {}),
          ...value,
        }),
      );
  }
  function invalidateCapture(keepFocus = false) {
    pointerController.reset();
    if (keepFocus) inputController.reset();
    else inputController.bindTarget(null);
    renderedGeneration = 0;
    framePlayer.invalidate();
    resetDecoder();
    if (panelSection === 'menu') collapseControls();
    menuPanel.replaceChildren();
  }
  function disconnect(state) {
    clearTimeout(deadline);
    clearTimeout(resizeTimer);
    configuredGeometry = null;
    clearTimeout(quitTimer);
    quitPending = false;
    abort?.abort();
    pointerController.reset();
    inputController.bindTarget(null);
    socket?.close();
    socket = null;
    current = null;
    invalidateCapture();
    present(state);
    hostApplicationConnection.dismissEnded(state, active, quitRequested);
  }
  let configuredGeometry;
  function viewportSize() {
    const rect = canvas.getBoundingClientRect();
    const viewport = hostApplicationViewport.readViewportSnapshot(window);
    // Restore occluded space before requesting the remote window size. Keyboard
    // and pinch-zoom changes affect presentation without restarting capture.
    return {width: Math.min(8192, Math.max(320, Math.round(rect.width + viewport.layout.width - viewport.visible.width))),
      height: Math.min(8192, Math.max(200, Math.round(rect.height + viewport.layout.height - viewport.visible.height)))};
  }
  function resize() {
    positionPopover();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const size = viewportSize();
      if (current && configuredGeometry !== `${size.width}:${size.height}:${devicePixelRatio}`) configurePicture();
    }, 180);
  }
  // Hardware decoders may retain the first chunk until more frames arrive.
  // Our one-frame credit requires immediate output, including a static window.
  const decoderOptions = {optimizeForLatency: true, hardwareAcceleration: 'prefer-software'};
  let decoder, decoderGeneration, videoPending, decodeDeadline;
  function resetDecoder() {
    clearTimeout(decodeDeadline);
    videoPending?.reject(Error('Capture changed'));
    videoPending = null;
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = null; decoderGeneration = null;
  }
  function decodeVideo(next) {
    if (!videoSupported) throw Error('Video decoding unavailable');
    if (decoderGeneration !== next.generation) {
      resetDecoder();
      if (!next.meta.key || !next.meta.description) throw Error('Missing video key frame');
      decoder = new VideoDecoder({
        output: (frame) => {
          const receiver = videoPending; videoPending = null; clearTimeout(decodeDeadline);
          if (receiver) receiver.resolve(frame); else frame.close();
        },
        error: (error) => { videoPending?.reject(error); videoPending = null; },
      });
      decoder.configure({ codec: next.meta.profile, description: Uint8Array.from(atob(next.meta.description), ch => ch.charCodeAt(0)), ...decoderOptions });
      decoderGeneration = next.generation;
    }
    return new Promise((resolve, reject) => {
      videoPending = { resolve, reject };
      decodeDeadline = setTimeout(() => { videoPending?.reject(Error('Video decode timed out')); videoPending = null; }, 5000);
      decoder.decode(new EncodedVideoChunk({ type: next.meta.key ? 'key' : 'delta', timestamp: next.meta.timestamp, data: next.bytes }));
    });
  }
  const framePlayer = createHostApplicationFramePlayer({
    canvas,
    decode: next => next.meta.codec === 'h264' ? decodeVideo(next)
      : createImageBitmap(new Blob([next.bytes], {type: next.meta.codec === 'png' ? 'image/png' : 'image/jpeg'})),
    isValid: next => next && next.attempt === attempt && next.target === current && socket?.readyState === WebSocket.OPEN,
    onResize: () => pointerController.reset(),
    onPaint(next, width, height) {
      renderedGeneration = current.generation;
      inputController.bindTarget(controlling ? current : null);
      canvas.setAttribute('aria-busy', 'false');
      statisticValues.resolution.textContent = `${width} × ${height}`;
      hostApplicationAppearance.copy(statisticValues.transport, next.meta.transport === 'video' ? 'pictureVideo' : 'pictureImages');
      paintedFrames++;
      socket.send(JSON.stringify({action:'frame_ack', generation:next.generation, frame_id:next.meta.frame_id}));
      if (!firstFrame) { firstFrame = true; console.debug(`Host application first frame: ${Math.round(performance.now() - connectedAt)} ms`); }
      clearTimeout(deadline); active = true; present('active');
    },
    onError(next) {
      if (next.meta.codec === 'h264' && videoSupported) { videoSupported = false; resetDecoder(); configurePicture(); }
      else disconnect('failed');
    },
  });
  async function connect() {
    const mine = ++attempt;
    connectedAt = performance.now(); firstFrame = false;
    disconnect(active ? 'reconnecting' : 'connecting');
    abort = new AbortController();
    deadline = setTimeout(() => {
      if (mine === attempt) disconnect('disconnected');
    }, 6000);
    try {
      const state = await hostApplicationConnection.read(abort.signal);
      if (mine !== attempt || abort.signal.aborted) return;
      if (!['running', 'starting'].includes(state.state)) {
        disconnect(state.state);
        return;
      }
      clearTimeout(deadline);
      deadline = setTimeout(() => { if (mine === attempt) disconnect('disconnected'); }, 45000);
      const url = new URL(
        config.base + '/_redeven_host_app/stream',
        location.href,
      );
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const connection = new windowTransport.WebSocket(url, [
        'redeven-host-application-v1',
        state.password,
      ]);
      socket = connection;
      connection.binaryType = 'arraybuffer';
      connection.onopen = async () => {
        try { videoSupported = typeof VideoDecoder !== 'undefined' && (await VideoDecoder.isConfigSupported({codec:'avc1.4D0033', ...decoderOptions})).supported; }
        catch { videoSupported = false; }
        if (mine === attempt && socket === connection) {
          configurePicture('resume');
        }
      };
      connection.onmessage = (event) => {
        if (mine !== attempt || socket !== connection) return;
        if (event.data instanceof ArrayBuffer) {
          try {
            const packet = new Uint8Array(event.data);
            if (packet.length < 4) throw Error('Missing frame header');
            const length = new DataView(event.data).getUint32(0);
            if (length > 65536 || length > packet.length - 4) throw Error('Invalid frame header');
            const meta = JSON.parse(new TextDecoder().decode(packet.subarray(4, 4 + length)));
            if (!['jpeg', 'png', 'h264'].includes(meta.codec)) throw Error('Unsupported frame');
            receivedBytes += packet.length;
            if (current?.window && meta.generation === current.generation) {
              framePlayer.receive({bytes:packet.subarray(4 + length), meta, attempt:mine, generation:meta.generation, target:current});
            }
          } catch { disconnect('failed'); }
          return;
        }
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          disconnect('failed');
          return;
        }
        if (message.type === 'waiting' || message.type === 'capture_error') {
          clearTimeout(deadline);
          invalidateCapture();
          current = { generation: message.generation };
          present(message.type === 'waiting' ? 'waiting' : 'captureUnavailable');
        } else if (message.type === 'control_revoked' || message.type === 'operation_error' && message.code === 'CONTROL_IN_USE') {
          controlling = false; pointerController.reset(); inputController.bindTarget(null);
          showControlTakeover();
        } else if (message.type === 'operation_error') {
          if (message.action === 'quit_application') {
            clearTimeout(quitTimer); quitPending = false; syncWindowPicker(); showFeedback('quitFailed');
          } else if (message.code !== 'STALE_WINDOW') {
            if (message.action === 'input') { pointerController.reset(); inputController.reset(); }
            showFeedback('operationFailed');
          }
          if (message.action === 'menu' && panelSection === 'menu') collapseControls(true);
        } else if (message.type === 'operation_complete') {
          if (message.action === 'quit_application') {
            clearTimeout(quitTimer); quitPending = false; syncWindowPicker(); showFeedback('quitPending');
          } else feedback.hidden = true;
        } else if (message.type === 'window') {
          controlling = message.control === true; takeoverButton.hidden = controlling;
          if (message.input_version !== 1) { disconnect('inputVersionUnsupported'); return; }
          clearTimeout(deadline);
          deadline = setTimeout(() => {
            if (mine === attempt && socket === connection) {
              invalidateCapture();
              present('captureUnavailable');
            }
          }, 45000);
          const sameWindow = current?.window === message.window && document.body.dataset.state === 'active';
          invalidateCapture(sameWindow);
          // Keep the window picker usable while another owned window loads.
          // Retained pixels are dimmed and input stays bound to decoded frames.
          const switching = document.body.dataset.state === 'active';
          current = message;
          if (!switching) present(active ? 'reconnecting' : 'connecting');
          canvas.setAttribute('aria-busy', 'true');
          syncWindowPicker();
          resize();
        } else if (message.type === 'windows') {
          renderWindows(message.windows);
        } else if (message.type === 'menu') {
          if (!current || message.generation !== current.generation || panelSection !== 'menu') return;
          clearTimeout(menuTimer);
          menuPanel.removeAttribute('aria-busy');
          if (!message.items.length) { collapseControls(true); showFeedback('operationFailed'); return; }
          menuPath = [{title:config.copy.menu, items:message.items}];
          renderMenu();
        } else if (message.type === 'error' && message.code !== 'STALE_WINDOW')
          disconnect('failed');
        else if (message.type === 'ended') void reconcile();
        else if (message.type === 'blocked') disconnect(message.code === 'GRAPHICAL_SESSION_REQUIRED' ? 'sessionUnavailable' : 'permissionRequired');
      };
      async function reconcile() {
        if (mine !== attempt || socket !== connection) return;
        disconnect('checking');
        const controller = new AbortController();
        abort = controller;
        deadline = setTimeout(() => {
          if (mine === attempt && !controller.signal.aborted) disconnect('disconnected');
        }, 6000);
        try {
          const data = await hostApplicationConnection.read(controller.signal);
          if (mine === attempt && !controller.signal.aborted)
            disconnect(['running', 'starting'].includes(data.state) ? 'disconnected' : data.state);
        } catch {
          if (mine === attempt && !controller.signal.aborted) disconnect('disconnected');
        }
      }
      connection.onclose = reconcile;
    } catch {
      if (mine === attempt && !abort?.signal.aborted) disconnect('disconnected');
    }
  }
  const takeoverPanel = document.createElement('dialog');
  takeoverPanel.className = 'mac-app-takeover';
  const takeoverTitle = document.createElement('strong');
  takeoverTitle.id = 'desktop-takeover-title';
  hostApplicationAppearance.copy(takeoverTitle, 'desktopTakeover');
  takeoverPanel.setAttribute('aria-labelledby', takeoverTitle.id);
  const takeoverHint = document.createElement('p');
  hostApplicationAppearance.copy(takeoverHint, 'desktopTakeoverHint');
  const takeoverCancel = document.createElement('button');
  hostApplicationAppearance.copy(takeoverCancel, 'cancel');
  const takeoverConfirm = document.createElement('button');
  hostApplicationAppearance.copy(takeoverConfirm, 'desktopTakeover');
  takeoverCancel.onclick = () => takeoverPanel.close();
  takeoverConfirm.onclick = () => { takeoverPanel.close(); configurePicture('resume', true); };
  takeoverPanel.append(takeoverTitle, takeoverHint, takeoverCancel, takeoverConfirm);
  document.body.append(takeoverPanel);
  const takeoverButton = document.createElement('button');
  takeoverButton.hidden = true;
  hostApplicationAppearance.copy(takeoverButton, 'desktopTakeover');
  takeoverButton.onclick = () => takeoverPanel.showModal();
  toolbar.append(takeoverButton);
  function showControlTakeover() {
    takeoverButton.hidden = false;
    if (!takeoverPanel.open) takeoverPanel.showModal();
  }
  function validPointerTarget(target) {
    return controlling && target === current && Boolean(target?.window) && renderedGeneration === target.generation
      && socket?.readyState === WebSocket.OPEN && document.body.dataset.state === 'active';
  }
  const stopViewport = hostApplicationViewport.observeViewport(window, viewport => {
    Object.assign(document.body.style, hostApplicationViewport.viewportStyle(viewport));
    for (const axis of ['left', 'top', 'width', 'height']) document.body.style.setProperty(`--mac-viewport-${axis}`, document.body.style[axis]);
    resize();
  });
  window.addEventListener('beforeunload', () => {
    stopViewport();
    canvasInput.dispose();
    framePlayer.invalidate();
    attempt++;
    send({ action: 'release' });
    socket?.close();
    abort?.abort();
    clearTimeout(deadline);
    clearTimeout(resizeTimer);
    clearInterval(statisticsTimer);
    clearTimeout(menuTimer);
    clearTimeout(quitTimer);
    resetDecoder();
  });
  close.onclick = () => { collapseControls(); send({ action: 'close' }); };
  document.addEventListener('pointerdown', event => {
    if (!popover.contains(event.target) && !toggles[panelSection]?.contains(event.target)) collapseControls();
  }, true);
  controls.addEventListener('focusout', event => {
    // WebKit may blur to the document before clicking another control.
    if (event.relatedTarget && !popover.contains(event.relatedTarget) && !toggles[panelSection]?.contains(event.relatedTarget)) collapseControls();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !panelSection) return;
    event.stopImmediatePropagation(); event.preventDefault();
    if (panelSection === 'menu' && menuPath.length > 1) { parentMenu(); }
    else collapseControls(true);
  }, true);
  retry.onclick = () => void connect();
  if (hostApplicationConnection.initial) present(hostApplicationConnection.initial);
  else void connect();
})();
