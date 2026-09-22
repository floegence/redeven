// Native macOS frames and input share the existing authenticated application
// forward. A reconnect reattaches to the bound process, never relaunches it.
(() => {
  const previous = document.getElementById('application');
  const canvas = document.createElement('canvas');
  canvas.id = 'application';
  canvas.className = 'mac-app-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', document.title);
  previous.replaceWith(canvas);
  const context = canvas.getContext('2d', { alpha: false });
  const retry = document.getElementById('retry');
  const native = window.redevenHostApplicationWindow;
  document.body.classList.add('mac-app-viewer');
  const { controls, toolbar, menu, windowToggle, windowCount, controlsButton, close, quit, popover, menuPanel, windowPanel, windowList, quitPanel, cancelQuit, confirmQuit, chevron } = createHostApplicationToolbar();
  const windowEntries = new Map();
  let panelSection = null;
  let quitTimer;
  let quitPending = false;
  let quitRequested = false;
  function syncWindowPicker() {
    const available = ['active', 'waiting', 'captureUnavailable'].includes(document.body.dataset.state);
    windowToggle.disabled = !available || windowEntries.size === 0;
    menu.disabled = !available;
    quit.disabled = !available || quitPending;
    controlsButton.disabled = document.body.dataset.state !== 'active';
    windowCount.textContent = String(windowEntries.size);
    windowCount.hidden = windowEntries.size < 2;
    for (const [id, entry] of windowEntries) {
      const selected = id === current?.window;
      entry.button.setAttribute('aria-pressed', String(selected));
      entry.button.setAttribute('aria-busy', String(selected && renderedGeneration !== current?.generation));
    }
    const hostTitle = windowEntries.get(current?.window)?.hostTitle;
    const title = hostTitle && hostTitle !== document.title ? hostTitle : config.copy.windows;
    windowToggle.querySelector('.mac-app-toolbar-label').textContent = title;
    windowToggle.title = `${config.copy.windows} · ${windowEntries.size}${title === config.copy.windows ? '' : ` — ${title}`}`;
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
  picturePanel.setAttribute('aria-label', config.copy.picture);

  const pictureTitle = document.createElement('strong');
  pictureTitle.textContent = config.copy.picture;
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
  pictureHint.textContent = config.copy.pictureHint;
  picturePanel.append(pictureHint);
  const advanced = document.createElement('details');
  const advancedTitle = document.createElement('summary');
  advancedTitle.textContent = config.copy.pictureAdvanced;
  advancedTitle.insertAdjacentHTML('beforeend', chevron);
  advanced.append(advancedTitle);
  for (const [field, title, values, unit] of [
    ['max_dimension', config.copy.pictureResolution, [0, 1600, 1920, 2560, 3840, 4096], 'px'],
    ['frame_rate', config.copy.pictureFrameRate, [0, 15, 24, 30, 60], 'FPS'],
  ]) {
    const label = document.createElement('label');
    const text = document.createElement('span'); text.textContent = title;
    const select = document.createElement('select');
    select.setAttribute('aria-label', title);
    for (const value of values) {
      const option = document.createElement('option'); option.value = String(value);
      option.textContent = value === 0 ? config.copy.pictureAuto : `${value} ${unit}`;
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
  for (const [key, title] of [['resolution', config.copy.picturePixels], ['rate', config.copy.pictureActualRate], ['bandwidth', config.copy.pictureBandwidth], ['transport', config.copy.pictureTransport]]) {
    const row = document.createElement('div');
    const label = document.createElement('span'); label.textContent = title;
    const value = document.createElement('output'); value.textContent = '—'; value.setAttribute('aria-label', title);
    statisticValues[key] = value; row.append(label, value); statistics.append(row);
  }
  picturePanel.append(statistics);
  popover.append(windowPanel, picturePanel, menuPanel, quitPanel);
  let receivedBytes = 0, paintedFrames = 0, measuredAt = performance.now();
  const statisticsTimer = setInterval(() => {
    const now = performance.now(), elapsed = (now - measuredAt) / 1000;
    statisticValues.rate.textContent = `${(paintedFrames / elapsed).toFixed(1)} FPS`;
    statisticValues.bandwidth.textContent = `${(receivedBytes * 8 / elapsed / 1e6).toFixed(2)} Mb/s`;
    receivedBytes = 0; paintedFrames = 0; measuredAt = now;
  }, 1000);
  function savePicture() {
    try { localStorage.setItem(preferenceKey, JSON.stringify(picture)); } catch { /* Preferences are optional. */ }
  }
  function configurePicture(action = 'configure') {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const size = viewportSize();
    configuredGeometry = `${size.width}:${size.height}:${devicePixelRatio}`;
    socket.send(JSON.stringify({action, ...picture, ...size,
      pixel_ratio: Math.min(4, Math.max(0.5, devicePixelRatio || 1)), video: videoSupported}));
  }
  const panels = { windows: windowPanel, picture: picturePanel, menu: menuPanel, quit: quitPanel };
  const toggles = { windows: windowToggle, picture: controlsButton, menu, quit };
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
    popover.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popover.offsetWidth - 8))}px`;
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
        if (panelSection === 'menu') { collapseControls(true); showFeedback(config.copy.operationFailed); }
      }, 6000);
      send({action:'menu'});
    } else {
      const selected = windowEntries.get(current?.window)?.button;
      (section === 'windows' ? selected || windowList.querySelector('button') : section === 'quit' ? cancelQuit : modeButtons.get(picture.mode))?.focus();
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
      back.textContent = '‹ ' + level.title;
      back.onclick = parentMenu;
      menuPanel.append(back);
    }
    for (const item of level.items) {
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.textContent = item.title;
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
      quitPending = false; syncWindowPicker(); showFeedback(config.copy.quitFailed);
    }, 6000);
  };
  const input = document.createElement('textarea');
  input.className = 'mac-app-input';
  input.setAttribute('aria-label', config.copy.input);
  input.autocomplete = 'off';
  document.body.append(input);
  const feedback = document.createElement('div');
  feedback.className = 'mac-app-feedback';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  document.body.append(feedback);
  function showFeedback(message) { feedback.textContent = message; feedback.hidden = false; }
  let socket,
    attempt = 0,
    active = false,
    renderedGeneration = 0,
    connectedAt = 0,
    firstFrame = false,
    current,
    pending,
    drawing = null,
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
    input.disabled = state !== 'active' || !renderedGeneration;
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
          ...value,
        }),
      );
  }
  function invalidateCapture() {
    renderedGeneration = 0;
    pending = null;
    drawing = null;
    resetDecoder();
    input.value = '';
    if (move) cancelAnimationFrame(move);
    move = null;
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
    socket?.close();
    socket = null;
    current = null;
    invalidateCapture();
    present(state);
    if (hostApplicationConnection.ended(state) && (active || quitRequested)) {
      if (native) native.request('close');
      else window.close();
    }
  }
  let configuredGeometry;
  function viewportSize() {
    const rect = canvas.getBoundingClientRect();
    return {width: Math.min(8192, Math.max(320, Math.round(rect.width))), height: Math.min(8192, Math.max(200, Math.round(rect.height)))};
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
  async function draw() {
    if (drawing) return;
    const job = {};
    drawing = job;
    let decoding;
    try {
      while (pending && drawing === job) {
        const next = pending; decoding = next; pending = null;
        const image = next.meta.codec === 'h264' ? await decodeVideo(next)
          : await createImageBitmap(new Blob([next.bytes], {type: next.meta.codec === 'png' ? 'image/png' : 'image/jpeg'}));
        if (drawing === job && next.attempt === attempt && current && next.generation === current.generation && socket?.readyState === WebSocket.OPEN) {
          const width = image.displayWidth || image.width, height = image.displayHeight || image.height;
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          context.drawImage(image, 0, 0);
          renderedGeneration = current.generation;
          canvas.setAttribute('aria-busy', 'false');
          statisticValues.resolution.textContent = `${width} × ${height}`;
          statisticValues.transport.textContent = config.copy[next.meta.transport === 'video' ? 'pictureVideo' : 'pictureImages'];
          paintedFrames++;
          socket.send(JSON.stringify({ action: 'frame_ack', generation: next.generation, frame_id: next.meta.frame_id }));
          if (!firstFrame) {
            firstFrame = true;
            console.debug(`Host application first frame: ${Math.round(performance.now() - connectedAt)} ms`);
          }
          clearTimeout(deadline); active = true; present('active');
        }
        image.close();
      }
    } catch {
      if (drawing === job && socket && decoding?.attempt === attempt && decoding?.generation === current?.generation) {
        if (decoding.meta.codec === 'h264' && videoSupported) {
          videoSupported = false; resetDecoder(); configurePicture();
        } else disconnect('failed');
      }
    } finally { if (drawing === job) { drawing = null; if (pending) void draw(); } }
  }
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
      const connection = new WebSocket(url, [
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
              pending = { bytes: packet.subarray(4 + length), meta, attempt: mine, generation: meta.generation };
              void draw();
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
        } else if (message.type === 'operation_error') {
          if (message.action === 'quit_application') {
            clearTimeout(quitTimer); quitPending = false; syncWindowPicker(); showFeedback(config.copy.quitFailed);
          } else if (message.code !== 'STALE_WINDOW') showFeedback(config.copy.operationFailed);
          if (message.action === 'menu' && panelSection === 'menu') collapseControls(true);
        } else if (message.type === 'operation_complete') {
          if (message.action === 'quit_application') {
            clearTimeout(quitTimer); quitPending = false; syncWindowPicker(); showFeedback(config.copy.quitPending);
          } else feedback.hidden = true;
        } else if (message.type === 'window') {
          clearTimeout(deadline);
          deadline = setTimeout(() => {
            if (mine === attempt && socket === connection) {
              invalidateCapture();
              present('captureUnavailable');
            }
          }, 45000);
          invalidateCapture();
          // Keep the window picker usable while another owned window loads.
          // Retained pixels are dimmed and input stays bound to decoded frames.
          const switching = document.body.dataset.state === 'active';
          current = message;
          if (!switching) present(active ? 'reconnecting' : 'connecting');
          canvas.setAttribute('aria-busy', 'true');
          input.disabled = true;
          syncWindowPicker();
          resize();
        } else if (message.type === 'windows') {
          renderWindows(message.windows);
        } else if (message.type === 'menu') {
          if (!current || message.generation !== current.generation || panelSection !== 'menu') return;
          clearTimeout(menuTimer);
          menuPanel.removeAttribute('aria-busy');
          if (!message.items.length) { collapseControls(true); showFeedback(config.copy.operationFailed); return; }
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
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(
      rect.width / canvas.width,
      rect.height / canvas.height,
    );
    const width = canvas.width * scale,
      height = canvas.height * scale;
    return {
      modifiers: [
        event.metaKey ? 'Meta' : '',
        event.ctrlKey ? 'Control' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
      ].filter(Boolean),
      x: Math.max(
        0,
        Math.min(
          1,
          (event.clientX - rect.left - (rect.width - width) / 2) / width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          1,
          (event.clientY - rect.top - (rect.height - height) / 2) / height,
        ),
      ),
    };
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (document.body.dataset.state !== 'active') return;
    input.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    send({
      action: 'input',
      kind: 'down',
      button: event.button,
      clicks: event.detail,
      ...point(event),
    });
    event.preventDefault();
  });
  canvas.addEventListener('pointerup', (event) => {
    send({
      action: 'input',
      kind: 'up',
      button: event.button,
      ...point(event),
    });
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  });
  let move;
  canvas.addEventListener('pointermove', (event) => {
    if (move) return;
    const position = point(event), binding = current;
    move = requestAnimationFrame(() => {
      move = null;
      if (current !== binding) return;
      send({ action: 'input', kind: 'move', ...position });
    });
  });
  canvas.addEventListener('pointercancel', () => send({ action: 'release' }));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      send({
        action: 'input',
        kind: 'scroll',
        dx: Math.max(-10000, Math.min(10000, event.deltaX * scale)),
        dy: Math.max(-10000, Math.min(10000, event.deltaY * scale)),
        ...point(event),
      });
    },
    { passive: false },
  );
  input.addEventListener('keydown', (event) => {
    if (
      event.isComposing ||
      event.key === 'Process' ||
      ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)
    )
      return;
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    )
      return;
    event.preventDefault();
    const modifiers = [
      event.metaKey ? 'Meta' : '',
      event.ctrlKey ? 'Control' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    send({
      action: 'input',
      kind: 'key',
      key: [...modifiers, event.key === ' ' ? 'Space' : event.key].join('+'),
    });
  });
  let compositionBinding;
  input.addEventListener('compositionstart', () => { compositionBinding = current; });
  input.addEventListener('input', (event) => {
    if (event.isComposing) {
      if (compositionBinding === undefined) compositionBinding = current;
      return;
    }
    if (compositionBinding !== undefined && compositionBinding !== current) { input.value = ''; return; }
    if (input.value) {
      send({ action: 'input', kind: 'text', text: input.value });
      input.value = '';
    }
  });
  input.addEventListener('compositionend', () => {
    const binding = compositionBinding;
    compositionBinding = undefined;
    if (binding !== current) { input.value = ''; return; }
    if (input.value) {
      send({ action: 'input', kind: 'text', text: input.value });
      input.value = '';
    }
  });
  window.addEventListener('blur', () => send({ action: 'release' }));
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => {
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
    if (!controls.contains(event.target)) collapseControls();
  });
  controls.addEventListener('focusout', event => {
    // WebKit may blur to the document before clicking another control.
    if (event.relatedTarget && !controls.contains(event.relatedTarget)) collapseControls();
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
