// IMPORTANT: Env settings owns durable picture preferences. Viewers only consume
// this authenticated user's record; they never write browser-local alternatives.
const hostApplicationPicture = (() => {
  const listeners = new Set();
  let value = {mode:'auto', max_dimension:0, frame_rate:0}, stopped = false, timer, inFlight;
  function valid(next) { return next && ['auto','clarity','smooth','data'].includes(next.mode)
    && [0,1600,1920,2560,3840,4096].includes(next.max_dimension) && [0,15,24,30,60].includes(next.frame_rate); }
  async function refresh() {
    if (stopped || inFlight) return;
    clearTimeout(timer);
    const request = new AbortController(); inFlight = request;
    try {
      const response = await windowTransport.fetch(config.base + '/_redeven_host_app/picture', {cache:'no-store', signal:request.signal});
      if (!response.ok) return;
      const result = await response.json();
      if (!stopped && result.ok && valid(result.data) && JSON.stringify(value) !== JSON.stringify(result.data)) {
        value = result.data;
        for (const listener of listeners) listener(value);
      }
    } catch { /* Keep the last confirmed preference while disconnected. */ }
    finally { inFlight = undefined; if (!stopped) timer = setTimeout(refresh, 2000); }
  }
  function openSettings() {
    if (window.redevenHostApplicationWindow) window.redevenHostApplicationWindow.request('settings');
    else if (window.opener && !window.opener.closed) window.opener.postMessage({type:'redeven:host-application-settings'}, '*');
  }
  function link() {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pictureSettings = '';
    hostApplicationAppearance.copy(button, 'picture');
    button.onclick = openSettings;
    button.disabled = !(window.redevenHostApplicationWindow || window.opener && !window.opener.closed);
    return button;
  }
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); inFlight?.abort(); listeners.clear(); window.removeEventListener('focus', refresh); }, {once:true});
  queueMicrotask(refresh);
  return {link, subscribe(picture, changed) { Object.assign(picture, value); const listener = next => { Object.assign(picture, next); changed(); }; listeners.add(listener); }};
})();
