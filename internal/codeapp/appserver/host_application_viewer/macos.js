// Native macOS frames and input share the existing authenticated application
// forward. A reconnect reattaches to the owned process, never relaunches it.
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
  const input = document.createElement('textarea');
  input.className = 'mac-app-input';
  input.setAttribute('aria-label', config.copy.input);
  input.autocomplete = 'off';
  document.body.append(input);
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
      String(['starting', 'connecting', 'reconnecting'].includes(state)),
    );
    status.textContent = config.copy[state] || config.copy.failed;
    hint.textContent =
      state === 'disconnected'
        ? config.copy.connectionHint
        : config.copy.sharedControl;
    hint.hidden = !hint.textContent;
    retry.hidden = !['disconnected', 'failed'].includes(state);
    retry.querySelector('span').textContent =
      state === 'disconnected' ? config.copy.reconnect : config.copy.retry;
    controls.hidden = state !== 'active';
    input.disabled = state !== 'active';
    if (state !== 'active') {
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
    present(state);
    if (state === 'ended' && active) {
      if (native) native.request('close');
      else window.close();
    }
  }
  function resize() {
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
  async function draw() {
    if (drawing) return;
    drawing = true;
    let decoding;
    try {
      while (pending) {
        const next = pending;
        decoding = next;
        pending = null;
        const image = await createImageBitmap(next.blob);
        if (
          next.attempt === attempt &&
          current &&
          next.generation === current.generation &&
          socket?.readyState === WebSocket.OPEN
        ) {
          canvas.width = image.width;
          canvas.height = image.height;
          context.drawImage(image, 0, 0);
          renderedGeneration = current.generation;
          canvas.setAttribute('aria-busy', 'false');
          clearTimeout(deadline);
          active = true;
          present('active');
        }
        image.close();
      }
    } catch {
      if (
        socket &&
        decoding?.attempt === attempt &&
        decoding?.generation === current?.generation
      )
        disconnect('failed');
    } finally {
      drawing = false;
      if (pending) void draw();
    }
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
      connection.onmessage = (event) => {
        if (mine !== attempt || socket !== connection) return;
        if (event.data instanceof Blob) {
          if (current) {
            pending = {
              blob: event.data,
              attempt: mine,
              generation: current.generation,
            };
            void draw();
          }
          return;
        }
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          disconnect('failed');
          return;
        }
        if (message.type === 'window') {
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
        else if (message.type === 'blocked' || message.type === 'capture_error')
          disconnect('disconnected');
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
      menuPanel.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
    }
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
      }
    },
    true,
  );
  retry.onclick = () => void connect();
  void connect();
})();
