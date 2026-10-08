import { HostDesktopPlayer, unpackDesktopMedia } from './host_desktop_player.mjs';

const config = window.remoteDesktopConfig;
const windowTransport = RedevenWindowTransport.create(config.transport);
const $ = id => document.getElementById(id);
const catalog = window.remoteDesktopCatalog;
const copy = key => (catalog[document.documentElement.lang] ?? catalog['en-US'])[key];
const canvas = $('desktop'), panel = $('panel'), toolbar = $('toolbar');
const base = config.base;
let session = config.session, control, media, player, epoch = 0, sequence = 0;
let generation = 0, state = 'disconnected', reason = '', painted = false, stopped = false, retry;
let unlocking = false, lockedFrame = 0;
let backend = '', capabilities = {}, stats, clipboardText = '', clipboardSync = false, clipboardBusy = false;
let original = false, quality = 'smooth', audio = false, volume = .7, pinned = false, hideTimer;
let textInput = 'host';
let awaitingMedia = [], reconnectAttempts = 0, noticeTimer, awaitingState = false;
let nativeFullscreen = false, pendingFullscreen;
let audioRequest, disconnectBusy = false, panelTrigger;
const windowBridge = window.redevenHostApplicationWindow;
const displayOptions = $('display-options');
$('files').hidden = !windowBridge && !window.opener;
const fullscreen = () => windowBridge ? nativeFullscreen : !!document.fullscreenElement;
for (const element of document.querySelectorAll('[data-icon]')) remoteDesktopIcons.mount(element, element.dataset.icon);

function fullscreenLabel() {
  const key = fullscreen() ? 'exitFullscreen' : 'fullscreen';
  $('fullscreen').setAttribute('aria-label', copy(key)); $('fullscreen').title = copy(key);
  if ($('fullscreen').dataset.icon !== key) { remoteDesktopIcons.mount($('fullscreen'), key); $('fullscreen').dataset.icon = key; }
}

function localize() {
  for (const element of document.querySelectorAll('[data-copy]')) element.textContent = copy(element.dataset.copy);
  for (const element of document.querySelectorAll('[data-label]')) {
    element.setAttribute('aria-label', copy(element.dataset.label));
    if (element.tagName === 'BUTTON') element.title = copy(element.dataset.label);
  }
  document.title = `${copy('title')} · ${session.host_name}`;
  $('host').textContent = session.host_name;
  fullscreenLabel();
}
localize();
new MutationObserver(localize).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

function notice(key) { $('notice').textContent = copy(key); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 6000); }
function authorized(target) { return !audioRequest && !awaitingState && target === generation && painted && state === 'active' && session.mode === 'control' && control?.readyState === WebSocket.OPEN; }
function unlockAuthorized(target) { return unlocking && !audioRequest && !awaitingState && target === generation && painted && state === 'locked' && session.mode === 'control' && control?.readyState === WebSocket.OPEN && lockedFrame > 0; }
function active(target) { return !panel.open && authorized(target); }
function command(method, values = {}, takeover = false) {
  if (control?.readyState !== WebSocket.OPEN) return false;
  if (control.bufferedAmount > 256 * 1024) { control.close(); return false; }
  control.send(JSON.stringify({ command: { version: 1, id: ++sequence, method, ...(!['probe', 'connect', 'disconnect'].includes(method) ? { generation } : {}), ...values }, takeover }));
  return true;
}
function release(target) { if (target === generation && ['active', 'locked'].includes(state)) command('release_input'); }
const input = hostApplicationInput.createRemoteInput({
  surface: canvas, label: copy('input'),
  commitText(text, target) {
    pointer.flush();
    if (unlockAuthorized(target)) { notice('unlockPhysicalOnly'); return; }
    if (!active(target)) return;
    if (textInput !== 'paste') { notice('textInputRequired'); return; }
    if (new TextEncoder().encode(text).length > 16000) { notice('textTooLong'); return; }
    command('input', { input: { kind: 'paste', text } });
  },
  sendKey(key, target) {
    pointer.flush();
    if (unlockAuthorized(target)) {
      if (key.pressed && (/^(Control|Meta)/.test(key.code) || ['AltLeft', 'ContextMenu'].includes(key.code) || (key.code === 'Insert' && key.shiftKey))) { notice('unlockPhysicalOnly'); return; }
      command('unlock_input', { frame_id: lockedFrame, input: { kind: 'key', ...key } });
    } else if (active(target)) command('input', { input: { kind: 'key', ...key } });
  },
  release,
  clipboard(event, target) {
    if (unlocking && ((event.ctrlKey || event.metaKey) || event.shiftKey && event.code === 'Insert')) { event.preventDefault(); notice('unlockPhysicalOnly'); return true; }
    if (!clipboardSync || !active(target) || !(event.ctrlKey || event.metaKey) || event.code !== 'KeyV') return false;
    event.preventDefault(); void localClipboard(target, true); return true;
  },
});
const pointer = hostApplicationPointer.createRemotePointer({
  surface: canvas, resolveTarget: () => active(generation) || unlockAuthorized(generation) ? generation : null, isTargetValid: target => active(target) || unlockAuthorized(target),
  onActivate(position) { input.setAnchor(position.clientX, position.clientY); input.focus(); },
  release,
  sendPointer(packet, target) {
    if (unlockAuthorized(target) && !['text', 'paste'].includes(packet.kind)) {
      if (packet.kind === 'down' && packet.button !== 0) { notice('unlockPhysicalOnly'); return false; }
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
      const width = canvas.width * scale, height = canvas.height * scale;
      const x = Math.max(0, Math.min(1, (packet.clientX - rect.left - (rect.width - width) / 2) / width));
      const y = Math.max(0, Math.min(1, (packet.clientY - rect.top - (rect.height - height) / 2) / height));
      return command('unlock_input', { frame_id: lockedFrame, input: { kind: packet.kind, x, y, button: packet.button ?? 0, clicks: packet.clicks ?? 0, dx: packet.dx ?? 0, dy: packet.dy ?? 0 } });
    }
    if (!active(target)) return false;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const width = canvas.width * scale, height = canvas.height * scale;
    const x = Math.max(0, Math.min(1, (packet.clientX - rect.left - (rect.width - width) / 2) / width));
    const y = Math.max(0, Math.min(1, (packet.clientY - rect.top - (rect.height - height) / 2) / height));
    return command('input', { input: { kind: packet.kind, x, y, button: packet.button ?? 0, clicks: packet.clicks ?? 0,
      dx: Math.max(-10000, Math.min(10000, packet.dx ?? 0)), dy: Math.max(-10000, Math.min(10000, packet.dy ?? 0)),
      shiftKey: !!packet.shiftKey, ctrlKey: !!packet.ctrlKey, altKey: !!packet.altKey, metaKey: !!packet.metaKey } });
  },
});
function revoke() { stats = undefined; refreshStats(); painted = false; lockedFrame = 0; canvas.removeAttribute('data-painted'); pointer.reset(); input.bindTarget(null); }
function updateTransitionControls() {
  canvas.dataset.mode = session.mode;
  for (const id of ['display', 'mode', 'fit', 'pixels', 'quality', 'sound', 'text-input', 'volume']) {
    if ($(id)) $(id).disabled = !!audioRequest || awaitingState || state !== 'active';
  }
  if ($('sound')) $('sound').disabled ||= capabilities.audio === false;
  if ($('volume')) $('volume').disabled ||= capabilities.audio === false;
  if ($('text-input')) $('text-input').disabled ||= capabilities.clipboard === false;
  $('clipboard').disabled = stopped || state !== 'active' || !painted || capabilities.clipboard === false;
  $('shortcuts').disabled = !authorized(generation);
  $('disconnect').disabled = stopped;
  $('retry-disconnect').disabled = disconnectBusy;
  if (state === 'locked' && painted) $('connection').hidden = true;
  if ($('start-unlock')) $('start-unlock').disabled = stopped || state !== 'locked' || !painted || !session.unlock;
  if ($('cancel-unlock')) $('cancel-unlock').disabled = !unlocking;
  $('unlock-bar')?.toggleAttribute('hidden', state !== 'locked');
  $('start-unlock')?.toggleAttribute('hidden', unlocking);
  $('cancel-unlock')?.toggleAttribute('hidden', !unlocking);
  toolbar.dataset.state = stopped ? 'ended' : state;
  $('session-state').textContent = copy(stopped ? 'disconnected' : state === 'active' ? session.mode : state === 'locked' ? 'locked' : 'connecting');
  for (const item of document.querySelectorAll('[data-remote-control]')) item.disabled = !authorized(generation);
  if ($('lock-host')) $('lock-host').disabled = !authorized(generation);
  const confirm = $('confirm-lock');
  if (confirm) confirm.disabled ||= !authorized(Number(confirm.dataset.generation)) || epoch !== Number(confirm.dataset.epoch);
}
function changeDesktop(method, values, takeover = false) {
  if (audioRequest || awaitingState) return;
  revoke(); awaitingState = true; player?.reset(generation);
  updateTransitionControls();
  command(method, values, takeover);
}
function picture() { return { mode: quality, max_dimension: quality === 'data' ? 1920 : 2560, frame_rate: quality === 'data' ? 30 : 60, audio, native_pixels: original }; }
function configure() { if (state !== 'active') return; changeDesktop('configure', { picture: picture() }); }
async function setAudio(enabled) {
  if (audioRequest || awaitingState || state !== 'active') return;
  const request = audioRequest = { epoch, generation, player };
  pointer.reset(); input.bindTarget(null); updateTransitionControls();
  try {
    const ready = enabled && await request.player.enableAudio();
    if (audioRequest !== request || request.epoch !== epoch || request.generation !== generation || state !== 'active' || awaitingState) return;
    const changed = audio !== ready;
    audioRequest = undefined; audio = ready; player.setVolume(volume, !audio);
    if (changed) configure();
  } finally {
    if (audioRequest === request) audioRequest = undefined;
    if ($('sound')) $('sound').checked = audio;
    updateTransitionControls();
    input.bindTarget(active(generation) ? generation : null);
  }
}
function status(key, hint = '') {
  $('connection').hidden = key === '' || state === 'locked' && painted;
  if (key) $('status').dataset.copy = key; else $('status').removeAttribute('data-copy');
  if (hint) $('hint').dataset.copy = hint; else $('hint').removeAttribute('data-copy');
  $('status').textContent = key ? copy(key) : ''; $('hint').textContent = hint ? copy(hint) : '';
}
function unavailableHint(code) {
  switch (code) {
    case 'DISPLAY_DISCONNECTED': return 'displayDisconnected';
    case 'DISPLAY_INACTIVE': return 'displayInactive';
    case 'GPU_SCANOUT_UNSUPPORTED': return 'gpuUnsupported';
    case 'LOGIN_SESSION_UNSUPPORTED': return 'sessionUnsupported';
    default: return 'unsupportedHint';
  }
}
function showUnavailable(code) {
  epoch++;
  revoke();
  state = 'unavailable'; reason = code || 'REMOTE_DESKTOP_UNAVAILABLE'; generation = 0;
  unlocking = false; awaitingState = false; session.unlock = false;
  status('unsupported', unavailableHint(reason));
  const retryable = ['DISPLAY_DISCONNECTED', 'DISPLAY_INACTIVE'].includes(reason);
  $('reconnect').hidden = !retryable;
  updateTransitionControls();
  control?.close(); media?.close();
}
function startUnlock() {
  if (state !== 'locked' || !painted || !session.unlock) return;
  unlocking = true; input.bindTarget(unlockAuthorized(generation) ? generation : null); input.focus(); status('unlocking', 'unlockPhysicalOnly'); updateTransitionControls();
}
function cancelUnlock() {
  if (!unlocking) return;
  command('unlock_cancel'); unlocking = false; input.bindTarget(null); status('locked', 'lockedHint'); updateTransitionControls();
}
if ($('start-unlock')) $('start-unlock').onclick = startUnlock;
if ($('cancel-unlock')) $('cancel-unlock').onclick = cancelUnlock;
function updateDisplays(displays) {
  $('display').replaceChildren(...displays.map((display, index) => {
    const option = document.createElement('option'); option.value = display.id;
    option.textContent = display.name || `${copy('display')} ${index + 1} · ${display.width} × ${display.height}`;
    return option;
  }));
  $('display').value = session.display_id;
  if (state === 'suspended' && reason === 'DISPLAY_CHANGED') {
    const next = displays.find(display => display.id === session.display_id) ?? displays.find(display => display.primary) ?? displays[0];
    if (next) changeDesktop('select_display', { display_id: next.id });
  }
}
function updateState(message) {
  const nextGeneration = message.generation ?? 0;
  const changed = generation !== nextGeneration;
  state = message.state; reason = message.code ?? ''; generation = nextGeneration;
  if (state === 'active') unlocking = false;
  awaitingState = false;
  if (state === 'active') session.mode = message.mode ?? session.mode;
  $('mode').value = session.mode;
  if (changed || state !== 'active' && state !== 'locked') { revoke(); player.reset(generation); }
  if ($('view-hint')) $('view-hint').hidden = session.mode === 'control';
  if (state !== 'active' || session.mode !== 'control') clearClipboard();
  const permission = /permission|authorization|host_action/i.test(state + ' ' + reason);
  const locked = ['locked', 'locking'].includes(state) || ['locked', 'locking'].includes(reason);
  const connecting = ['connecting', 'authorizing'].includes(state);
  if (backend === 'wayland' && state === 'authorizing') {
    status(message.authorization === 'restoring' ? 'approvalRestoring' : 'connecting', 'approvalWaitingHint');
  } else if (backend === 'wayland' && message.authorization === 'unknown' && state !== 'active') {
    status('approvalUnknown', 'approvalRestoreFailed');
  } else {
    status(state === 'active' ? '' : locked ? 'locked' : permission ? 'permissionRequired' : connecting ? 'connecting' : 'disconnected', permission ? 'permissionHint' : '');
  }
  $('reconnect').hidden = state === 'active' || connecting || locked;
  if (message.displays) updateDisplays(message.displays);
  if (message.display_id) {
    session.display_id = message.display_id; $('display').value = message.display_id;
  }
  updateTransitionControls();
  if (state === 'active' || state === 'locked') {
    for (const packet of awaitingMedia) player.receive(packet);
    awaitingMedia = [];
  }
  if (state === 'reconnect_required' && /^DISPLAY_/.test(reason)) retry = setTimeout(() => void connect(), 400);
}

function retryConnection() {
  if (!stopped && reconnectAttempts++ < 8) retry = setTimeout(() => void connect(), Math.min(5000, 400 * 2 ** reconnectAttempts));
}
async function connect() {
  clearTimeout(retry); if (stopped) return;
  const current = ++epoch; revoke(); state = 'connecting'; generation = 0; sequence = 0; awaitingMedia = []; awaitingState = false; audioRequest = undefined;
  updateTransitionControls();
  player?.reset(0); control?.close(); media?.close(); status('connecting'); $('reconnect').hidden = true;
  if (!HostDesktopPlayer.supported()) { status('unsupported', 'unsupportedHint'); return; }
  try {
    const response = await windowTransport.fetch(base + 'ticket', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      if (current !== epoch || stopped) return;
      state = 'disconnected'; status('disconnected', response.status === 404 || response.status === 403 ? 'endedHint' : ''); $('reconnect').hidden = response.status === 404 || response.status === 403; updateTransitionControls();
      // Retry temporary transport/service failures, while expired sessions and
      // revoked access require an explicit action from the authenticated host UI.
      if (response.status >= 500 || response.status === 408 || response.status === 429) retryConnection();
      return;
    }
    const result = await response.json(); if (current !== epoch || stopped) return;
    session = result.data.session; localize();
    const address = path => { const url = new URL(base + path, location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; return url; };
    control = new windowTransport.WebSocket(address('control'), ['redeven-desktop-v1', result.data.token]);
    media = new windowTransport.WebSocket(address('media'), ['redeven-desktop-v1', result.data.token]);
    media.binaryType = 'arraybuffer';
    player ??= new HostDesktopPlayer(canvas, {
      acknowledge(g, frame) { if (!awaitingState && (state === 'active' || state === 'locked') && g === generation) { if (state === 'locked') lockedFrame = frame; command('frame_ack', { frame_id: frame }); } },
      painted(g) { if (awaitingState || g !== generation || state !== 'active' && state !== 'locked') return; painted = true; canvas.setAttribute('data-painted', ''); input.bindTarget(active(g) || unlockAuthorized(g) ? g : null); updateTransitionControls(); reconnectAttempts = 0; },
      recover() { revoke(); if (state === 'active') changeDesktop('keyframe'); },
      statistics(value) { stats = value; refreshStats(); },
      audioState(value) { if (value === 'unavailable' || value === 'unsupported') notice('failure'); },
      workletURL: base + 'assets/host_desktop_audio.mjs',
    });
    player.setVolume(volume, !audio);
    let opened = 0;
    const ready = () => { if (current === epoch && ++opened === 2) command('probe'); };
    control.onopen = media.onopen = ready;
    control.onmessage = ({ data }) => {
      if (current !== epoch) return;
      const message = JSON.parse(data);
      if (message.type === 'capabilities') {
        capabilities = message.capabilities;
        backend = message.capabilities.backend;
        session.unlock = !!message.capabilities.unlock;
        if (message.capabilities.screen === false || ['unsupported', 'unavailable'].includes(message.capabilities.state)) {
          showUnavailable(message.capabilities.reason);
          return;
        }
        const displays = message.capabilities.displays ?? [];
        const display = displays.length && !displays.some(item => item.id === session.display_id) ? '' : session.display_id;
        session.display_id = display;
        command('connect', { mode: session.mode, display_id: display, picture: picture() });
      } else if (message.type === 'state') updateState(message);
      else if (message.type === 'displays') updateDisplays(message.displays);
      else if (message.type === 'clipboard') {
        if (message.generation !== generation || !authorized(generation)) return;
        clipboardText = message.text ?? ''; if ($('clipboard-text')) $('clipboard-text').value = clipboardText;
        if (clipboardSync && authorized(generation) && document.hasFocus()) {
          if (!navigator.clipboard?.writeText) disableClipboardSync();
          else {
            const currentGeneration = generation;
            void navigator.clipboard.writeText(clipboardText).catch(() => { if (current === epoch && authorized(currentGeneration)) disableClipboardSync(); });
          }
        }
      } else if (message.type === 'error') {
        awaitingState = false;
        updateTransitionControls();
        if (message.code === 'CONTROL_IN_USE') { session.mode = 'view'; $('mode').value = 'view'; void confirmControl(true); }
        else if (message.code === 'LOCKED') {
          updateState({ ...message, state: 'locked' });
          // A rejected initial connection has no native capture observer yet.
          // Let the user reconnect after unlocking the host locally.
          $('reconnect').hidden = false;
        }
        else if (/RESTORE_TOKEN|PORTAL_|AUTHORIZATION_PENDING/.test(message.code)) {
          updateState({ ...message, state: 'disconnected' });
          status(message.code === 'AUTHORIZATION_PENDING' ? 'approvalBusy' : 'approvalUnknown', message.code === 'AUTHORIZATION_PENDING' ? '' : 'approvalRestoreFailed');
          $('reconnect').hidden = false;
        }
        else if (['DISPLAY_DISCONNECTED', 'DISPLAY_INACTIVE', 'GPU_SCANOUT_UNSUPPORTED', 'LOGIN_SESSION_UNSUPPORTED'].includes(message.code)) showUnavailable(message.code);
        else if (/PERMISSION|AUTHORIZATION|HOST_ACTION/.test(message.code)) updateState({ ...message, state: 'permission_required' });
        else if (/UNLOCK|LOGIN_SERVICE/.test(message.code)) { status('locked', 'unlockFailed'); notice('unlockFailed'); updateTransitionControls(); }
        else notice(message.code.includes('CLIPBOARD') ? 'clipboardFailed' : 'failure');
      }
    };
    media.onmessage = ({ data }) => {
      if (current !== epoch) return;
      const packet = unpackDesktopMedia(data);
      if (packet.header.generation > generation || state === 'connecting') {
        if (awaitingMedia.length >= 8) { media.close(); return; }
        awaitingMedia.push(data);
      } else if (!awaitingState) player.receive(data);
    };
    const lost = () => {
      if (current !== epoch || stopped) return;
      epoch++; revoke(); state = 'disconnected'; player.reset(0); control.close(); media.close();
      updateTransitionControls();
      clearClipboard(); awaitingMedia = []; status('disconnected'); $('reconnect').hidden = false;
      retryConnection();
    };
    control.onclose = media.onclose = lost;
  } catch { if (current === epoch && !stopped) { state = 'disconnected'; status('disconnected'); $('reconnect').hidden = false; retryConnection(); } }
}

function element(tag, text, properties = {}) { const node = document.createElement(tag); if (text) node.textContent = text; Object.assign(node, properties); return node; }
function button(key, onClick) { const node = element('button', copy(key), { type: 'button' }); node.onclick = onClick; return node; }
function openPanel(title, children) {
  if (!panel.open) { panelTrigger = document.activeElement; panelTrigger?.setAttribute('aria-expanded', 'true'); }
  if (panel.contains(displayOptions)) $('panel-storage').append(displayOptions);
  wakeToolbar();
  pointer.reset(); input.bindTarget(null);
  $('panel-title').textContent = copy(title); $('panel-body').replaceChildren(...children);
  if (panel.open) $('panel-body').querySelector('button, input, select, textarea')?.focus();
  else panel.showModal();
}
panel.addEventListener('close', () => {
  if (panel.contains(displayOptions)) $('panel-storage').append(displayOptions);
  panelTrigger?.setAttribute('aria-expanded', 'false');
  if (panelTrigger?.isConnected && !panelTrigger.disabled) panelTrigger.focus();
  if (active(generation)) input.bindTarget(generation);
  wakeToolbar();
});
$('display-settings').onclick = () => { openPanel('display', [displayOptions]); updateTransitionControls(); };

async function confirmation(title, hint, authority) {
  return new Promise(resolve => {
    const row = element('div', '', { className: 'row' });
    const accept = button(title, () => {
      if (authority && (authority.epoch !== epoch || !authorized(authority.generation))) return;
      panel.returnValue = 'accept'; panel.close('accept');
    });
    if (authority) {
      accept.id = 'confirm-lock'; accept.dataset.generation = String(authority.generation); accept.dataset.epoch = String(authority.epoch);
    }
    row.append(button('cancel', () => panel.close('cancel')), accept);
    panel.addEventListener('close', () => resolve(panel.returnValue === 'accept'), { once: true });
    panel.returnValue = ''; openPanel(title, [element('p', copy(hint)), row]); updateTransitionControls();
  });
}
async function confirmControl(reconnect = false) {
  const current = epoch;
  const accepted = await confirmation('takeover', reconnect ? 'takeoverHint' : 'controlHint');
  if (current !== epoch || stopped) return;
  if (reconnect) command('connect', { mode: accepted ? 'control' : 'view', display_id: session.display_id, picture: picture() }, accepted);
  else if (accepted) changeDesktop('set_mode', { mode: 'control' }, true);
}
$('mode').onchange = () => { if ($('mode').value === 'control') { $('mode').value = session.mode; void confirmControl(); } else changeDesktop('set_mode', { mode: 'view' }); };
$('display').onchange = () => changeDesktop('select_display', { display_id: $('display').value });
function setOriginal(value) { original = value; $('stage').classList.toggle('original', value); $('fit').setAttribute('aria-pressed', String(!value)); $('pixels').setAttribute('aria-pressed', String(value)); configure(); }
$('fit').onclick = () => setOriginal(false); $('pixels').onclick = () => setOriginal(true);
function updateFullscreen() {
  document.documentElement.classList.toggle('desktop-fullscreen', fullscreen());
  fullscreenLabel();
  $('fullscreen').disabled = pendingFullscreen !== undefined;
  wakeToolbar();
}
function setFullscreen(value) {
  if (pendingFullscreen !== undefined) return;
  if (windowBridge) {
    pendingFullscreen = value; $('fullscreen').disabled = true;
    windowBridge.request(value ? 'enter-fullscreen' : 'exit-fullscreen');
  } else void (value ? document.documentElement.requestFullscreen() : document.exitFullscreen()).catch(() => notice('failure'));
}
$('fullscreen').onclick = () => setFullscreen(!fullscreen());
windowBridge?.subscribe(snapshot => {
  nativeFullscreen = snapshot.fullscreen;
  if (nativeFullscreen === pendingFullscreen) pendingFullscreen = undefined;
  updateFullscreen();
});
document.addEventListener('fullscreenchange', updateFullscreen);
document.addEventListener('keydown', event => {
  if (windowBridge && fullscreen() && event.key === 'Escape' && !panel.open) {
    event.preventDefault(); event.stopImmediatePropagation(); release(generation); setFullscreen(false);
  }
}, true);
function wakeToolbar() {
  clearTimeout(hideTimer); toolbar.classList.remove('hidden-toolbar');
  if (!pinned && fullscreen() && !panel.open && !stopped) hideTimer = setTimeout(() => {
    if (!toolbar.matches(':hover, :focus-within') && !panel.open) toolbar.classList.add('hidden-toolbar');
  }, 2200);
}
document.addEventListener('pointermove', event => { if (event.clientY <= 8) wakeToolbar(); }, { passive: true });
toolbar.addEventListener('pointerleave', wakeToolbar);
toolbar.addEventListener('focusout', wakeToolbar);
$('pin').onclick = () => { pinned = !pinned; $('pin').setAttribute('aria-pressed', String(pinned)); wakeToolbar(); };

function refreshStats() {
  if (!$('statistics')) return;
  $('statistics').parentElement.hidden = !stats;
  if (!stats) return;
  $('statistics').textContent = `${stats.width} × ${stats.height}\n${copy('frameRate')}: ${stats.fps.toFixed(1)} FPS\n${copy('bandwidth')}: ${(stats.bitsPerSecond / 1e6).toFixed(2)} Mbps\n${stats.encoder} · ${stats.codec}\n${copy('decoder')}: ${stats.decoderPreference}`;
}
$('settings').onclick = () => {
  const selector = element('select', '', { id: 'quality' }); for (const value of ['smooth', 'clarity', 'data']) selector.append(element('option', copy(value), { value })); selector.value = quality;
  selector.onchange = () => { quality = selector.value; configure(); };
  const qualityLabel = element('label', copy('quality')); qualityLabel.append(selector);
  const textMode = element('select', '', { id: 'text-input' });
  for (const [value, key] of [['host', 'hostInput'], ['paste', 'pasteInput']]) textMode.append(element('option', copy(key), { value }));
  textMode.value = textInput; textMode.title = copy(textInput === 'host' ? 'hostInput' : 'pasteInput');
  textMode.setAttribute('aria-label', copy('textInput'));
  textMode.setAttribute('aria-describedby', 'text-input-hint');
  textMode.onchange = () => {
    pointer.reset(); input.bindTarget(null); release(generation);
    textInput = textMode.value; textMode.title = copy(textInput === 'host' ? 'hostInput' : 'pasteInput');
  };
  const textLabel = element('label', copy('textInput')); textLabel.append(textMode);
  const slider = element('input', '', { id: 'volume', type: 'range', min: '0', max: '1', step: '.05', value: String(volume) });
  slider.oninput = () => { volume = Number(slider.value); player.setVolume(volume, !audio); };
  const volumeLabel = element('label', copy('volume')); volumeLabel.append(slider);
  const mute = element('input', '', { id: 'sound', type: 'checkbox', checked: audio });
  mute.onchange = () => void setAudio(mute.checked);
  const muteLabel = element('label', copy('sound')); muteLabel.append(mute);
  const lock = button('lock', async () => {
    const authority = { epoch, generation };
    if (!authorized(authority.generation)) return;
    if (await confirmation('lock', 'lockHint', authority) && authority.epoch === epoch && authorized(authority.generation)) command('lock');
  }); lock.id = 'lock-host';
  openPanel('settings', [section('', [qualityLabel]), section('', [textLabel, element('p', copy('textInputHint'), { id: 'text-input-hint' })]), section('', [muteLabel, volumeLabel]), section('statistics', [element('output', '', { id: 'statistics' })]), lock]); updateTransitionControls(); refreshStats();
};
function section(title, children) {
  const section = element('section', '', { className: 'settings-section' });
  if (title) section.append(element('h3', copy(title)));
  section.append(...children); return section;
}
async function localClipboard(target, paste = false) {
  if (!authorized(target) || clipboardBusy) return;
  clipboardBusy = true;
  const current = epoch;
  try {
    const text = await navigator.clipboard.readText();
    if (current !== epoch || !authorized(target)) return;
    if (paste) pasteClipboard(text);
    else if (text !== clipboardText) { clipboardText = text; command('set_clipboard', { text }); }
  } catch { if (current === epoch && authorized(target)) disableClipboardSync(); } finally { clipboardBusy = false; }
}
function clearClipboard() {
  clipboardSync = false; clipboardText = '';
  if ($('clipboard-text')) $('clipboard-text').value = '';
  if ($('clipboard-sync')) $('clipboard-sync').checked = false;
}
function disableClipboardSync() { clipboardSync = false; if ($('clipboard-sync')) $('clipboard-sync').checked = false; command('set_clipboard_sync', { enabled: false }); notice('clipboardFailed'); }
function pasteClipboard(text) { if (!authorized(generation)) return; if (new TextEncoder().encode(text).length > (1 << 20)) { notice('clipboardFailed'); return; } clipboardText = text; command('set_clipboard', { text }); chord([backend === 'macos' ? 'MetaLeft' : 'ControlLeft', 'KeyV']); }
$('clipboard').onclick = () => {
  const text = element('textarea', '', { id: 'clipboard-text', value: clipboardText, maxLength: 1 << 20 }); text.setAttribute('aria-label', copy('text'));
  const row = element('div', '', { className: 'row' });
  row.append(button('copyRemote', () => { if (authorized(generation)) command('get_clipboard'); }), button('pasteRemote', () => pasteClipboard(text.value)));
  const sync = element('input', '', { id: 'clipboard-sync', type: 'checkbox', checked: clipboardSync }); sync.onchange = () => { clipboardSync = sync.checked; command('set_clipboard_sync', { enabled: clipboardSync }); if (clipboardSync) void localClipboard(generation); };
  const label = element('label', copy('clipboardSync')); label.append(sync);
  for (const control of [...row.children, sync]) control.dataset.remoteControl = '';
  openPanel('clipboard', [element('p', copy('clipboardHint')), element('p', copy('viewHint'), {id: 'view-hint', hidden: session.mode === 'control', className: 'inline-hint'}), text, row, label]);
  updateTransitionControls();
};
window.addEventListener('focus', () => { if (clipboardSync) void localClipboard(generation); });
function chord(codes) { if (!authorized(generation)) return; for (const code of codes) command('input', { input: { kind: 'key', key: code, code, pressed: true, metaKey: codes.includes('MetaLeft'), altKey: codes.includes('AltLeft'), ctrlKey: codes.includes('ControlLeft'), shiftKey: codes.includes('ShiftLeft') } }); for (const code of [...codes].reverse()) command('input', { input: { kind: 'key', key: code, code, pressed: false } }); }
$('shortcuts').onclick = () => {
  const shortcuts = [
    ['switchApp', backend === 'macos' ? ['MetaLeft', 'Tab'] : ['AltLeft', 'Tab'], backend === 'macos' ? '⌘ Tab' : 'Alt + Tab'],
    ['systemMenu', backend === 'macos' ? ['ControlLeft', 'F2'] : ['MetaLeft'], backend === 'macos' ? '⌃ F2' : 'Super'],
  ].map(([key, codes, label]) => {
    const action = button(key, () => { chord(codes); panel.close(); });
    action.className = 'shortcut'; action.dataset.remoteControl = '';
    action.append(element('kbd', label)); return action;
  });
  openPanel('shortcuts', [element('p', copy('shortcutsHint')), ...shortcuts]); updateTransitionControls();
};
$('files').onclick = () => { window.redevenHostApplicationWindow?.request('files'); window.opener?.postMessage({ type: 'redeven:remote-desktop:files', session_id: session.id }, '*'); window.dispatchEvent(new CustomEvent('redeven:remote-desktop:files')); };
$('reconnect').onclick = () => { reconnectAttempts = 0; void connect(); };
function stopViewer() {
  stopped = true; clearTimeout(retry); clearTimeout(hideTimer); epoch++;
  revoke(); player?.close(); control?.close(); media?.close();
  canvas.width = canvas.width; // Erase retained pixels, including screenshots after disconnect.
  state = 'disconnected'; audioRequest = undefined; awaitingState = false;
  awaitingMedia = []; clearClipboard(); audio = false;
  if (panel.open) panel.close();
  $('reconnect').hidden = true; toolbar.classList.remove('hidden-toolbar');
  status('disconnected', 'endedHint'); updateTransitionControls();
}
async function disconnect() {
  if (disconnectBusy) return;
  if (!stopped) stopViewer();
  disconnectBusy = true; $('retry-disconnect').hidden = true;
  status('disconnecting'); updateTransitionControls();
  try {
    const response = await windowTransport.fetch(base + 'disconnect', { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error('Desktop disconnect failed');
    status('disconnected', 'endedHint'); windowTransport.dispose();
  } catch {
    status('disconnected', 'disconnectFailed'); $('retry-disconnect').hidden = false;
  } finally { disconnectBusy = false; updateTransitionControls(); }
}
$('retry-disconnect').onclick = disconnect;
$('disconnect').onclick = disconnect;
// Page unload cannot await a request. Closing the native streams immediately
// releases input and capture; the server expires its bounded reconnect lease.
window.addEventListener('pagehide', () => { stopViewer(); windowTransport.dispose(); });
void connect();
