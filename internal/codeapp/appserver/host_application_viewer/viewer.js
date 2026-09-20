// Xpra HTML5 v20/v21 owns rendering, input, clipboard and transient-window stacking.
// This adapter owns the application's viewport and one reconnectable viewer.
(() => {
  const frame = document.getElementById('application');
  const main = document.getElementById('connection');
  const status = document.getElementById('status');
  const hint = document.getElementById('hint');
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
    nativeState = state;
    applyNativeState();
  });

  if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(config.icon)) {
    const icon = document.getElementById('icon');
    icon.src = config.icon;
    icon.hidden = false;
    document.getElementById('fallback-icon').setAttribute('hidden', '');
  }

  function present(state) {
    const busy = ['starting', 'connecting', 'reconnecting'].includes(state);
    document.body.dataset.state = state;
    main.setAttribute('aria-busy', String(busy));
    status.textContent = config.copy[state] || config.copy.failed;
    hint.textContent = state === 'disconnected' ? config.copy.connectionHint : '';
    hint.hidden = !hint.textContent;
    retry.hidden = busy || state === 'active' || state === 'ended';
    retry.querySelector('span').textContent = state === 'disconnected' ? config.copy.reconnect : config.copy.retry;
    frame.inert = state !== 'active';
    frame.setAttribute('aria-hidden', String(state !== 'active'));
    frame.tabIndex = state === 'active' ? 0 : -1;
  }

  function stopClient() {
    const previous = client;
    client = null;
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
    if (state === 'ended' && wasActive) {
      if (nativeWindow) nativeWindow.request('close');
      else window.close();
    }
    if (!retry.hidden) retry.focus({preventScroll:true});
  }

  function connectionLost(attempt) {
    if (attempt !== generation) return;
    finish('disconnected');
    // A closed session and a lost network need different recovery actions.
    const current = generation;
    request = new AbortController();
    fetch(config.base + '/_redeven_host_app/state', {cache:'no-store', signal:request.signal})
      .then(async response => {
        if (current !== generation) return;
        if (response.status === 404 || response.status === 410) { finish('ended'); return; }
        if (response.ok) {
          const data = await response.json();
          if (current === generation && (data.state === 'ended' || data.state === 'failed')) finish(data.state);
        }
      }).catch(() => {});
  }

  function installClient(attempt) {
    const doc = frame.contentDocument;
    const xpra = frame.contentWindow.redevenXpraClient();
    if (xpra && client === xpra) return;
    if (!xpra || typeof xpra._new_window !== 'function' || typeof xpra.do_send_damage_sequence !== 'function') throw new Error('Unsupported Xpra HTML5 client');
    client = xpra;
    xpra.reconnect = false;
    xpra.reconnect_count = 0;
    xpra.callback_close = () => connectionLost(attempt);
    doc.addEventListener('connection-lost', () => connectionLost(attempt));
    const lastWindow = xpra.on_last_window;
    xpra.on_last_window = function() {
      lastWindow.call(this);
      // This hook is emitted for a server-confirmed window destruction, never
      // for the client's bulk cleanup on network loss. Finish after packet handling.
      queueMicrotask(() => {
        if (attempt === generation && wasActive && Object.keys(xpra.id_to_window).length === 0) finish('ended');
      });
    };
    // Keep upstream input controls intact; application windows own all visible space.
    const style = doc.createElement('style');
    style.textContent = 'html,body,#screen{background:transparent!important;background-image:none!important}#float_menu,#toolbar,#progress,#notifications,.spinneroverlay{display:none!important}.redeven-primary{border:0!important;border-radius:0!important;box-shadow:none!important}.redeven-primary>.windowhead,.redeven-primary>.ui-resizable-handle{display:none!important}';
    doc.head.append(style);
    doc.documentElement.style.backgroundColor = getComputedStyle(document.body).backgroundColor;

    const primaryWindows = new Set();
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
    };
    Object.values(xpra.id_to_window).forEach(fit);

    const damage = xpra.do_send_damage_sequence;
    xpra.do_send_damage_sequence = function(sequence, wid, width, height, decodeTime, message) {
      damage.call(this, sequence, wid, width, height, decodeTime, message);
      if (attempt !== generation || !primaryWindows.has(wid) || decodeTime < 0 || message) return;
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
      const response = await fetch(config.base + '/_redeven_host_app/state', {cache:'no-store', signal:request.signal});
      if (attempt !== generation) return;
      if (!response.ok) {
        finish(response.status === 404 || response.status === 410 ? 'ended' : 'disconnected');
        return;
      }
      const data = await response.json();
      if (attempt !== generation) return;
      if (data.state === 'running') {
        if (!attached) {
          sessionStorage.setItem(config.base, JSON.stringify({password:data.password, floating_menu:false, reconnect:false, sound:false, printing:false, file_transfer:false}));
          attached = true;
          present(wasActive ? 'reconnecting' : 'connecting');
          frame.src = config.base + '/index.html';
        }
      } else if (data.state !== 'starting') { finish(data.state === 'ended' ? 'ended' : 'failed'); return; }
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
  window.addEventListener('offline', () => finish('disconnected'));
  window.addEventListener('pagehide', () => { generation++; clearTimeout(timer); clearTimeout(deadline); request?.abort(); stopClient(); unsubscribeWindow?.(); });
  connect();
})();
