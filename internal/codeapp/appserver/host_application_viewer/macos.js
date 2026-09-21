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
  const panel = document.getElementById('connection');
  const status = document.getElementById('status');
  const hint = document.getElementById('hint');
  const retry = document.getElementById('retry');
  const native = window.redevenHostApplicationWindow;
  const controls = document.createElement('div');
  controls.className = 'mac-app-controls';
  controls.hidden = true;
  const windows = document.createElement('select');
  windows.setAttribute('aria-label', config.copy.windows);
  windows.hidden = true;
  const close = document.createElement('button');
  close.textContent = config.copy.closeWindow;
  close.title = config.copy.closeWindow;
  const menu = document.createElement('button');
  menu.textContent = config.copy.menu;
  menu.setAttribute('aria-expanded', 'false');
  const menuPanel = document.createElement('div');
  menuPanel.className = 'mac-app-menu';
  menuPanel.hidden = true;
  controls.append(windows, menu, close, menuPanel);
  document.body.append(controls);
  const pictureButton = document.createElement('button');
  pictureButton.textContent = config.copy.picture;
  pictureButton.setAttribute('aria-expanded', 'false');
  pictureButton.setAttribute('aria-controls', 'picture-settings');
  const picturePanel = document.createElement('section');
  picturePanel.id = 'picture-settings';
  picturePanel.className = 'mac-app-picture';
  picturePanel.setAttribute('aria-label', config.copy.picture);
  picturePanel.hidden = true;
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
  controls.append(pictureButton, picturePanel);
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
  function hidePicture() { picturePanel.hidden = true; pictureButton.setAttribute('aria-expanded', 'false'); }
  pictureButton.onclick = () => {
    picturePanel.hidden = !picturePanel.hidden;
    pictureButton.setAttribute('aria-expanded', String(!picturePanel.hidden));
    menuPanel.hidden = true; menu.setAttribute('aria-expanded', 'false');
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
  let socket,
    attempt = 0,
    active = false,
    renderedGeneration = 0,
    current,
    pending,
    drawing = false,
    deadline,
    resizeTimer;
  let abort;
  const sizes = new Map();
  const icon = document.getElementById('icon');
  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    icon.src = config.icon;
    icon.hidden = false;
    document.getElementById('fallback-icon').hidden = true;
  }
  function present(state) {
    document.body.dataset.state = state;
    panel.setAttribute(
      'aria-busy',
      String(['starting', 'connecting', 'reconnecting', 'waiting'].includes(state)),
    );
    status.textContent = config.copy[state] || config.copy.failed;
    hint.textContent =
      state === 'disconnected'
        ? config.copy.connectionHint
        : config.copy.sharedControl;
    hint.hidden = !hint.textContent;
    retry.hidden = !['disconnected', 'failed', 'captureUnavailable'].includes(state);
    retry.querySelector('span').textContent =
      state === 'disconnected' ? config.copy.reconnect : config.copy.retry;
    controls.hidden = state !== 'active';
    input.disabled = state !== 'active';
    if (state !== 'active') {
      feedback.hidden = true;
      hidePicture();
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    }
  }
  function send(value) {
    if (
      socket?.readyState === WebSocket.OPEN &&
      current &&
      (renderedGeneration === current.generation ||
        ['resize', 'select', 'release'].includes(value.action))
    )
      socket.send(
        JSON.stringify({
          window: current.window,
          generation: current.generation,
          ...value,
        }),
      );
  }
  function disconnect(state) {
    clearTimeout(deadline);
    abort?.abort();
    socket?.close();
    socket = null;
    current = null;
    renderedGeneration = 0;
    pending = null;
    resetDecoder();
    present(state);
    if (state === 'ended' && active) {
      if (native) native.request('close');
      else window.close();
    }
  }
  let configuredRatio;
  function resize() {
    if (configuredRatio !== devicePixelRatio) { configuredRatio = devicePixelRatio; configurePicture(); }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (current) {
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
    drawing = true;
    let decoding;
    try {
      while (pending) {
        const next = pending; decoding = next; pending = null;
        const image = next.meta.codec === 'h264' ? await decodeVideo(next)
          : await createImageBitmap(new Blob([next.bytes], {type: next.meta.codec === 'png' ? 'image/png' : 'image/jpeg'}));
        if (next.attempt === attempt && current && next.generation === current.generation && socket?.readyState === WebSocket.OPEN) {
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
      if (socket && decoding?.attempt === attempt && decoding?.generation === current?.generation) {
        if (decoding.meta.codec === 'h264' && videoSupported) {
          videoSupported = false; resetDecoder(); configurePicture();
        } else disconnect('failed');
      }
    } finally { drawing = false; if (pending) void draw(); }
  }
  async function connect() {
    const mine = ++attempt;
    disconnect(active ? 'reconnecting' : 'connecting');
    abort = new AbortController();
    deadline = setTimeout(() => {
      if (mine === attempt) disconnect('failed');
    }, 45000);
    try {
      const response = await fetch(config.base + '/_redeven_host_app/state', {
        cache: 'no-store',
        signal: abort.signal,
      });
      if (mine !== attempt || abort.signal.aborted) return;
      if ([404, 410].includes(response.status)) {
        disconnect('ended');
        return;
      }
      if (!response.ok) throw Error('Session unavailable');
      const state = await response.json();
      if (mine !== attempt || abort.signal.aborted) return;
      if (state.state === 'ended' || state.state === 'failed') {
        disconnect(state.state);
        return;
      }
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
            if (current && meta.generation === current.generation) {
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
        if (message.type === 'waiting') {
          resetDecoder();
          pending = null;
          current = null;
          renderedGeneration = 0;
          present('waiting');
        } else if (message.type === 'operation_error') {
          if (message.code !== 'STALE_WINDOW') {
            feedback.textContent = config.copy.operationFailed;
            feedback.hidden = false;
          }
        } else if (message.type === 'operation_complete') {
          feedback.hidden = true;
        } else if (message.type === 'window') {
          resetDecoder();
          pending = null;
          current = message;
          canvas.setAttribute('aria-busy', 'true');
          windows.value = message.window;
          resize();
        } else if (message.type === 'windows') {
          windows.replaceChildren(
            ...message.windows.map((item) => {
              const option = document.createElement('option');
              option.value = item.id;
              option.textContent = item.title || document.title;
              return option;
            }),
          );
          windows.hidden = message.windows.length < 2;
          if (current) windows.value = current.window;
        } else if (message.type === 'menu') {
          hidePicture();
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
        else if (message.type === 'ended') disconnect('ended');
        else if (message.type === 'capture_error') disconnect('captureUnavailable');
        else if (message.type === 'blocked') disconnect('disconnected');
      };
      connection.onclose = async () => {
        if (mine !== attempt || socket !== connection) return;
        disconnect('disconnected');
        try {
          const response = await fetch(
            config.base + '/_redeven_host_app/state',
            { cache: 'no-store' },
          );
          if (mine !== attempt) return;
          if ([404, 410].includes(response.status)) disconnect('ended');
          else if (response.ok) {
            const data = await response.json();
            if (data.state === 'ended' || data.state === 'failed')
              disconnect(data.state);
          }
        } catch {
          /* Network loss retains the window and its explicit reconnect action. */
        }
      };
    } catch {
      if (mine === attempt) disconnect(active ? 'disconnected' : 'failed');
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
    const position = point(event);
    move = requestAnimationFrame(() => {
      move = null;
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
  input.addEventListener('input', (event) => {
    if (event.isComposing) return;
    if (input.value) {
      send({ action: 'input', kind: 'text', text: input.value });
      input.value = '';
    }
  });
  input.addEventListener('compositionend', () => {
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
  windows.onchange = () => send({ action: 'select', window: windows.value });
  close.onclick = () => send({ action: 'close' });
  menu.onclick = () => {
    if (!menuPanel.hidden) {
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    } else send({ action: 'menu' });
  };
  document.addEventListener('pointerdown', (event) => {
    if (!controls.contains(event.target)) {
      hidePicture();
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !picturePanel.hidden) {
        event.stopImmediatePropagation(); event.preventDefault(); hidePicture(); pictureButton.focus();
      } else if (event.key === 'Escape' && !menuPanel.hidden) {
        event.stopImmediatePropagation();
        event.preventDefault();
        menuPanel.hidden = true;
        menu.setAttribute('aria-expanded', 'false');
        menu.focus();
      }
    },
    true,
  );
  retry.onclick = () => void connect();
  void connect();
})();
