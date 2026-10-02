// Shared lifecycle interpretation for native and Xpra viewers. Only explicit
// host state proves termination; an unavailable route never proves app exit.
const hostApplicationConnection = (() => {
  const ended = state => ['ended', 'applicationExited', 'windowsClosed', 'sharingStopped'].includes(state);
  function dismissEnded(state, established, quitRequested = false) {
    if (!['applicationExited', 'windowsClosed', 'sharingStopped'].includes(state) || !(established || quitRequested)) return;
    if (window.redevenHostApplicationWindow) window.redevenHostApplicationWindow.request('close');
    else if (window.opener) window.close();
  }
  const launchFailures = hostApplicationCatalog.launchFailures;
  const terminal = state => ended(state) || ['sessionFailed', 'sessionMissing', 'inputVersionUnsupported',...Object.values(launchFailures)].includes(state);
  function state(data) {
    if (data?.state === 'ended') return ({application_exited:'applicationExited', windows_closed:'windowsClosed', sharing_stopped:'sharingStopped'})[data.end_reason] || 'ended';
    if (data?.state === 'failed') return launchFailures[data.error_code] || 'sessionFailed';
    if (!['starting', 'running'].includes(data?.state) || typeof data.password !== 'string' || !data.password) throw Error('Invalid application session status');
    return data.state;
  }
  async function read(signal) {
    const response = await windowTransport.fetch(config.base + '/_redeven_host_app/state', {cache:'no-store', signal});
    if ([401, 403, 423].includes(response.status)) return {state:'accessRequired'};
    if ([404, 410].includes(response.status)) return {state:'sessionMissing'};
    if (!response.ok) throw Error('Application status unavailable');
    const data = await response.json();
    return {...data, state:state(data)};
  }
  function present(state) {
    const busy = ['starting', 'connecting', 'reconnecting', 'checking', 'waiting'].includes(state);
    document.body.dataset.state = state;
    document.getElementById('connection').setAttribute('aria-busy', String(busy));
    document.getElementById('status').textContent = config.copy[state] || config.copy.failed;
    const hints = {viewerPreparationFailed:'viewerPreparationHint', inputUnavailable:'inputUnavailableHint', inputVersionUnsupported:'inputVersionHint', disconnected:'connectionHint', failed:'connectionHint', waiting:'waitingHint', permissionRequired:'permissionHint', sessionUnavailable:'sessionHint', sessionFailed:'reopenHint', captureUnavailable:'captureHint', applicationExited:'applicationExitedHint', windowsClosed:'windowsClosedHint', sharingStopped:'sharingStoppedHint', ended:'endedHint', sessionMissing:'sessionMissingHint', accessRequired:'accessHint'};
    const hint = document.getElementById('hint');
    hint.textContent = config.copy[hints[state]] || (config.backend === 'macos' && ['starting', 'connecting', 'reconnecting'].includes(state) ? config.copy.sharedControl : '') || '';
    hint.hidden = !hint.textContent;
    const retry = document.getElementById('retry');
    retry.hidden = busy || state === 'active' || terminal(state);
    retry.querySelector('span').textContent = ['waiting', 'disconnected'].includes(state) ? config.copy.reconnect : config.copy.retry;
    const dismiss = document.getElementById('dismiss');
    dismiss.hidden = !terminal(state) || !(window.redevenHostApplicationWindow || window.opener);
    dismiss.textContent = config.copy.dismiss;
    dismiss.onclick = () => {
      if (window.redevenHostApplicationWindow) window.redevenHostApplicationWindow.request('close');
      else window.close();
    };
  }
  hostApplicationAppearance.subscribe(() => present(document.body.dataset.state));
  const initial = ['ended', 'failed'].includes(config.initial?.state) ? state(config.initial) : null;
  return {dismissEnded, terminal, read, present, initial};
})();
