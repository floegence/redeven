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
  const controls = document.createElement('div');
  controls.className = 'mac-app-controls';
  controls.hidden = true;
  const close = document.createElement('button');
  close.textContent = config.copy.closeWindow;
  close.title = config.copy.closeWindow;
  const menu = document.createElement('button');
  menu.textContent = config.copy.menu;
  menu.setAttribute('aria-expanded', 'false');
  const menuPanel = document.createElement('div');
  menuPanel.className = 'mac-app-menu';
  menuPanel.hidden = true;
  const drawer = document.createElement('div');
  drawer.id = 'application-controls';
  drawer.className = 'mac-app-drawer';
  drawer.hidden = true;
  drawer.setAttribute('role', 'region');
  drawer.setAttribute('aria-label', config.copy.controls);
  const actions = document.createElement('div');
  actions.className = 'mac-app-actions';
  actions.append(menu, close, menuPanel);
  document.body.append(controls);
  const controlsButton = document.createElement('button');
  controlsButton.className = 'mac-app-controls-toggle';
  controlsButton.title = config.copy.controls;
  controlsButton.setAttribute('aria-label', config.copy.controls);
  controlsButton.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 3v4m0 4v6m6-14v8m0 4v2m6-14v2m0 4v8M2 7h4m2 8h4m2-10h4"/></svg>';
  controlsButton.setAttribute('aria-expanded', 'false');
  controlsButton.setAttribute('aria-controls', drawer.id);
  const windowToggle = document.createElement('button');
  windowToggle.className = 'mac-app-windows-toggle';
  windowToggle.hidden = true;
  windowToggle.title = config.copy.windows;
  windowToggle.setAttribute('aria-expanded', 'false');
  windowToggle.setAttribute('aria-controls', drawer.id);
  windowToggle.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="7" width="11" height="10" rx="2"/><path d="M7 4V3h10v10h-1"/></svg>';
  const windowCount = document.createElement('span');
  windowCount.setAttribute('aria-hidden', 'true');
  windowToggle.append(windowCount);
  const windowPanel = document.createElement('section');
  windowPanel.className = 'mac-app-window-picker';
  windowPanel.hidden = true;
  windowPanel.setAttribute('aria-label', config.copy.windows);
  const windowTitle = document.createElement('strong');
  windowTitle.textContent = config.copy.windows;
  const windowList = document.createElement('div');
  windowList.className = 'mac-app-window-list';
  windowPanel.append(windowTitle, windowList);
  const windowEntries = new Map();
  let drawerSection = 'picture';
  function syncWindowPicker() {
    windowToggle.hidden = windowEntries.size === 0;
    windowCount.textContent = String(windowEntries.size);
    windowToggle.setAttribute('aria-label', `${config.copy.windows} · ${windowEntries.size}`);
    for (const [id, entry] of windowEntries) {
      const selected = id === current?.window;
      entry.button.setAttribute('aria-pressed', String(selected));
      entry.button.setAttribute('aria-busy', String(selected && renderedGeneration !== current?.generation));
    }
    close.disabled = !current?.window || renderedGeneration !== current.generation;
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
      entry.title.textContent = title; entry.button.title = title;
      if (windowList.children[index] !== entry.button) windowList.insertBefore(entry.button, windowList.children[index] || null);
    });
    syncWindowPicker();
    if (hadFocus) (focused.isConnected ? focused : windowToggle.hidden ? controlsButton : windowToggle).focus({preventScroll:true});
    if (!items.length && drawerSection === 'windows') collapseControls();
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
  const modeButtons = new Map();
  const modes = document.createElement('div');
  modes.className = 'mac-app-picture-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', config.copy.picture);
  for (const mode of ['auto', 'clarity', 'smooth', 'data']) {
    const button = document.createElement('button');
    button.textContent = config.copy['picture' + mode[0].toUpperCase() + mode.slice(1)];
    button.setAttribute('aria-pressed', String(picture.mode === mode));
    button.onclick = () => {
      picture.mode = mode;
      for (const [value, control] of modeButtons) control.setAttribute('aria-pressed', String(value === mode));
      savePicture(); configurePicture();
    };
    modeButtons.set(mode, button); modes.append(button);
  }
  picturePanel.append(modes);
  const pictureHint = document.createElement('p');
  pictureHint.textContent = config.copy.pictureHint;
  picturePanel.append(pictureHint);
  const advanced = document.createElement('details');
  const advancedTitle = document.createElement('summary');
  advancedTitle.textContent = config.copy.pictureAdvanced;
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
  drawer.append(windowPanel, picturePanel, actions);
  controls.append(windowToggle, controlsButton, drawer);
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
  function configurePicture() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'configure', ...picture, pixel_ratio: Math.min(4, Math.max(0.5, devicePixelRatio || 1)), video: videoSupported}));
  }
  function collapseControls() {
    drawer.hidden = true;
    controlsButton.setAttribute('aria-expanded', 'false');
    windowToggle.setAttribute('aria-expanded', 'false');
    menuPanel.hidden = true;
    menu.setAttribute('aria-expanded', 'false');
  }
  function toggleControls(section) {
    const opening = drawer.hidden || drawerSection !== section;
    collapseControls();
    drawerSection = section;
    windowPanel.hidden = section !== 'windows';
    picturePanel.hidden = section !== 'picture' || document.body.dataset.state !== 'active';
    drawer.hidden = !opening;
    if (opening) {
      const toggle = section === 'windows' ? windowToggle : controlsButton;
      toggle.setAttribute('aria-expanded', 'true');
      const selected = windowEntries.get(current?.window)?.button;
      (section === 'windows' ? selected || windowList.querySelector('button') : picturePanel.hidden ? menu : modeButtons.get(picture.mode))?.focus();
    }
  }
  controlsButton.onclick = () => toggleControls('picture');
  windowToggle.onclick = () => toggleControls('windows');
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
  let socket,
    attempt = 0,
    active = false,
    renderedGeneration = 0,
    current,
    pending,
    drawing = null,
    deadline,
    resizeTimer;
  let abort;
  const sizes = new Map();
  const icon = document.getElementById('icon');
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    icon.src = config.icon;
    icon.hidden = false;
    document.getElementById('fallback-icon').setAttribute('hidden', '');
  }
  function present(state) {
    hostApplicationConnection.present(state);
    canvas.setAttribute('aria-hidden', String(state !== 'active'));
    canvas.tabIndex = state === 'active' ? 0 : -1;
    controls.hidden = !['active', 'waiting', 'captureUnavailable'].includes(state);
    picturePanel.hidden = state !== 'active' || drawerSection !== 'picture';
    close.hidden = state !== 'active';
    syncWindowPicker();
    input.disabled = state !== 'active' || !renderedGeneration;
    if (state !== 'active') {
      feedback.hidden = true;
      collapseControls();
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    }
  }
  function send(value) {
    if (
      socket?.readyState === WebSocket.OPEN &&
      current &&
      (current.window && renderedGeneration === current.generation ||
        ['resize', 'select', 'release', 'menu', 'menu_action'].includes(value.action))
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
    menuPanel.hidden = true;
    menuPanel.replaceChildren();
    menu.setAttribute('aria-expanded', 'false');
  }
  function disconnect(state) {
    clearTimeout(deadline);
    abort?.abort();
    socket?.close();
    socket = null;
    current = null;
    invalidateCapture();
    present(state);
    if (hostApplicationConnection.ended(state) && active) {
      if (native) native.request('close');
      else window.close();
    }
  }
  let configuredRatio;
  function resize() {
    if (configuredRatio !== devicePixelRatio) { configuredRatio = devicePixelRatio; configurePicture(); }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (current?.window) {
        const width = Math.max(320, innerWidth),
          height = Math.max(200, innerHeight),
          key = `${width}:${height}`;
        if (sizes.get(current.window) !== key) {
          sizes.set(current.window, key);
          send({ action: 'resize', width, height });
        }
      }
    }, 180);
  }
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
      decoder.configure({ codec: next.meta.profile, description: Uint8Array.from(atob(next.meta.description), ch => ch.charCodeAt(0)), optimizeForLatency: true });
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
        try { videoSupported = typeof VideoDecoder !== 'undefined' && (await VideoDecoder.isConfigSupported({codec:'avc1.4D0033', optimizeForLatency:true})).supported; }
        catch { videoSupported = false; }
        if (mine === attempt && socket === connection) configurePicture();
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
          if (message.code !== 'STALE_WINDOW') {
            feedback.textContent = config.copy.operationFailed;
            feedback.hidden = false;
          }
        } else if (message.type === 'operation_complete') {
          feedback.hidden = true;
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
          if (!current || message.generation !== current.generation) return;
          const build = (items) =>
            items.map((item) => {
              if (item.children.length) {
                const group = document.createElement('details');
                const title = document.createElement('summary');
                title.textContent = item.title;
                group.append(title, ...build(item.children));
                return group;
              }
              const button = document.createElement('button');
              button.textContent = item.title;
              button.disabled = !item.enabled;
              button.onclick = () => {
                send({ action: 'menu_action', item: item.id });
                menuPanel.hidden = true;
                menu.setAttribute('aria-expanded', 'false');
              };
              return button;
            });
          menuPanel.replaceChildren(...build(message.items));
          menuPanel.hidden = false;
          menu.setAttribute('aria-expanded', 'true');
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
    resetDecoder();
  });
  close.onclick = () => send({ action: 'close' });
  menu.onclick = () => {
    if (!menuPanel.hidden) {
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    } else send({ action: 'menu' });
  };
  document.addEventListener('pointerdown', (event) => {
    if (!controls.contains(event.target)) {
      collapseControls();
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    }
  });
  controls.addEventListener('focusout', (event) => {
    // WebKit may blur a button to the document before clicking another control.
    // Only a concrete focus destination outside the panel dismisses it.
    if (event.relatedTarget && !controls.contains(event.relatedTarget)) collapseControls();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !menuPanel.hidden) {
        event.stopImmediatePropagation();
        event.preventDefault();
        menuPanel.hidden = true;
        menu.setAttribute('aria-expanded', 'false');
        menu.focus();
      } else if (event.key === 'Escape' && !drawer.hidden) {
        event.stopImmediatePropagation(); event.preventDefault(); collapseControls(); (drawerSection === 'windows' && !windowToggle.hidden ? windowToggle : controlsButton).focus();
      }
    },
    true,
  );
  retry.onclick = () => void connect();
  if (hostApplicationConnection.initial) present(hostApplicationConnection.initial);
  else void connect();
})();
