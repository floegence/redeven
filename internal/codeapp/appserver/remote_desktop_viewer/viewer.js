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
let backend = '', stats, clipboardText = '', clipboardSync = false, clipboardBusy = false;
let original = false, quality = 'smooth', audio = false, volume = .7, pinned = false, hideTimer;
let textInput = 'host';
let awaitingMedia = [], reconnectAttempts = 0, noticeTimer, awaitingState = false;
let nativeFullscreen = false, pendingFullscreen;
let audioRequest;
const windowBridge = window.redevenHostApplicationWindow;
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
function active(target) { return !panel.open && authorized(target); }
function command(method, values = {}, takeover = false) {
  if (control?.readyState !== WebSocket.OPEN) return false;
  if (control.bufferedAmount > 256 * 1024) { control.close(); return false; }
  control.send(JSON.stringify({ command: { version: 1, id: ++sequence, method, ...(!['probe', 'connect', 'disconnect'].includes(method) ? { generation } : {}), ...values }, takeover }));
  return true;
}
function release(target) { if (target === generation && state === 'active') command('release_input'); }
const input = hostApplicationInput.createRemoteInput({
  surface: canvas, label: copy('input'),
  commitText(text, target) {
    pointer.flush();
    if (!active(target)) return;
    if (textInput !== 'paste') { notice('textInputRequired'); return; }
    if (new TextEncoder().encode(text).length > 16000) { notice('textTooLong'); return; }
    command('input', { input: { kind: 'paste', text } });
  },
  sendKey(key, target) { pointer.flush(); if (active(target)) command('input', { input: { kind: 'key', ...key } }); },
  release,
  clipboard(event, target) {
    if (!clipboardSync || !active(target) || !(event.ctrlKey || event.metaKey) || event.code !== 'KeyV') return false;
    event.preventDefault(); void localClipboard(target, true); return true;
  },
});
const pointer = hostApplicationPointer.createRemotePointer({
  surface: canvas, resolveTarget: () => active(generation) ? generation : null, isTargetValid: active,
  onActivate(position) { input.setAnchor(position.clientX, position.clientY); input.focus(); },
  release,
  sendPointer(packet, target) {
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
function revoke() { painted = false; canvas.removeAttribute('data-painted'); pointer.reset(); input.bindTarget(null); }
function updateTransitionControls() {
  for (const id of ['display', 'mode', 'fit', 'pixels', 'quality', 'enable-sound', 'sound']) {
    if ($(id)) $(id).disabled = !!audioRequest || awaitingState || state !== 'active';
  }
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
    if ($('enable-sound')) $('enable-sound').textContent = copy(audio ? 'sound' : 'enableSound');
    updateTransitionControls();
    input.bindTarget(active(generation) ? generation : null);
  }
}
function status(key, hint = '') { $('connection').hidden = key === ''; $('status').textContent = key ? copy(key) : ''; $('hint').textContent = hint ? copy(hint) : ''; }
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
  awaitingState = false;
  if (state === 'active') session.mode = message.mode ?? session.mode;
  $('mode').value = session.mode;
  if (changed || state !== 'active') { revoke(); player.reset(generation); }
  if (state !== 'active' || session.mode !== 'control') { clipboardSync = false; clipboardText = ''; if ($('clipboard-text')) $('clipboard-text').value = ''; if ($('clipboard-sync')) $('clipboard-sync').checked = false; }
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
  if (state === 'active') {
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
      state = 'disconnected'; status('disconnected'); $('reconnect').hidden = false;
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
      acknowledge(g, frame) { if (!awaitingState && state === 'active' && g === generation) command('frame_ack', { frame_id: frame }); },
      painted(g) { if (awaitingState || g !== generation || state !== 'active') return; painted = true; canvas.setAttribute('data-painted', ''); input.bindTarget(active(g) ? g : null); updateTransitionControls(); reconnectAttempts = 0; },
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
        backend = message.capabilities.backend;
        const displays = message.capabilities.displays;
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
          else void navigator.clipboard.writeText(clipboardText).catch(disableClipboardSync);
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
        else if (/PERMISSION|AUTHORIZATION|HOST_ACTION/.test(message.code)) updateState({ ...message, state: 'permission_required' });
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
      clipboardSync = false; clipboardText = ''; awaitingMedia = []; status('disconnected'); $('reconnect').hidden = false;
      retryConnection();
    };
    control.onclose = media.onclose = lost;
  } catch { if (current === epoch && !stopped) { state = 'disconnected'; status('disconnected'); $('reconnect').hidden = false; retryConnection(); } }
}

function element(tag, text, properties = {}) { const node = document.createElement(tag); if (text) node.textContent = text; Object.assign(node, properties); return node; }
function button(key, onClick) { const node = element('button', copy(key), { type: 'button' }); node.onclick = onClick; return node; }
function openPanel(title, children) {
  pointer.reset(); input.bindTarget(null);
  $('panel-title').textContent = copy(title); $('panel-body').replaceChildren(...children);
  if (panel.open) $('panel-body').querySelector('button, input, select, textarea')?.focus();
  else panel.showModal();
}
panel.addEventListener('close', () => { if (active(generation)) input.bindTarget(generation); });
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
  const accepted = await confirmation('takeover', 'takeoverHint');
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
function wakeToolbar() { clearTimeout(hideTimer); toolbar.classList.remove('hidden-toolbar'); if (!pinned && fullscreen()) hideTimer = setTimeout(() => toolbar.classList.add('hidden-toolbar'), 2200); }
document.addEventListener('pointermove', wakeToolbar, { passive: true });
$('pin').onclick = () => { pinned = !pinned; $('pin').setAttribute('aria-pressed', String(pinned)); wakeToolbar(); };

function refreshStats() {
  if (!$('statistics') || !stats) return;
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
  const sound = button(audio ? 'sound' : 'enableSound', () => void setAudio(true));
  sound.id = 'enable-sound';
  const slider = element('input', '', { type: 'range', min: '0', max: '1', step: '.05', value: String(volume) });
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
  openPanel('settings', [qualityLabel, textLabel, element('p', copy('textInputHint'), { id: 'text-input-hint' }), sound, muteLabel, volumeLabel, lock, element('output', '', { id: 'statistics' })]); updateTransitionControls(); refreshStats();
};
async function localClipboard(target, paste = false) {
  if (!authorized(target) || clipboardBusy) return;
  clipboardBusy = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!authorized(target)) return;
    if (paste) pasteClipboard(text);
    else if (text !== clipboardText) { clipboardText = text; command('set_clipboard', { text }); }
  } catch { disableClipboardSync(); } finally { clipboardBusy = false; }
}
function disableClipboardSync() { clipboardSync = false; if ($('clipboard-sync')) $('clipboard-sync').checked = false; command('set_clipboard_sync', { enabled: false }); notice('clipboardFailed'); }
function pasteClipboard(text) { if (!authorized(generation)) return; if (new TextEncoder().encode(text).length > (1 << 20)) { notice('clipboardFailed'); return; } clipboardText = text; command('set_clipboard', { text }); chord([backend === 'macos' ? 'MetaLeft' : 'ControlLeft', 'KeyV']); }
$('clipboard').onclick = () => {
  const text = element('textarea', '', { id: 'clipboard-text', value: clipboardText, maxLength: 1 << 20 }); text.setAttribute('aria-label', copy('text'));
  const row = element('div', '', { className: 'row' });
  row.append(button('copyRemote', () => { if (authorized(generation)) command('get_clipboard'); }), button('pasteRemote', () => pasteClipboard(text.value)));
  const sync = element('input', '', { id: 'clipboard-sync', type: 'checkbox', checked: clipboardSync }); sync.onchange = () => { clipboardSync = sync.checked; command('set_clipboard_sync', { enabled: clipboardSync }); if (clipboardSync) void localClipboard(generation); };
  const label = element('label', copy('clipboardSync')); label.append(sync);
  for (const control of [...row.children, sync]) control.disabled = session.mode !== 'control';
  openPanel('clipboard', [element('p', copy('clipboardHint')), text, row, label]);
};
window.addEventListener('focus', () => { if (clipboardSync) void localClipboard(generation); });
function chord(codes) { if (!authorized(generation)) return; for (const code of codes) command('input', { input: { kind: 'key', key: code, code, pressed: true, metaKey: codes.includes('MetaLeft'), altKey: codes.includes('AltLeft'), ctrlKey: codes.includes('ControlLeft'), shiftKey: codes.includes('ShiftLeft') } }); for (const code of [...codes].reverse()) command('input', { input: { kind: 'key', key: code, code, pressed: false } }); }
$('shortcuts').onclick = () => openPanel('shortcuts', [button('switchApp', () => chord([backend === 'macos' ? 'MetaLeft' : 'AltLeft', 'Tab'])), button('systemMenu', () => chord(backend === 'macos' ? ['ControlLeft', 'F2'] : ['MetaLeft']))]);
$('files').onclick = () => { window.redevenHostApplicationWindow?.request('files'); window.opener?.postMessage({ type: 'redeven:remote-desktop:files', session_id: session.id }, '*'); window.dispatchEvent(new CustomEvent('redeven:remote-desktop:files')); };
$('reconnect').onclick = () => { reconnectAttempts = 0; void connect(); };
function stopViewer() { stopped = true; clearTimeout(retry); epoch++; revoke(); player?.close(); control?.close(); media?.close(); state = 'disconnected'; status('disconnected'); }
async function disconnect() {
  if (stopped) return;
  stopViewer();
  try {
    const response = await windowTransport.fetch(base + 'disconnect', { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Desktop disconnect failed');
  } catch { notice('failure'); }
  finally { windowTransport.dispose(); }
}
$('disconnect').onclick = disconnect;
// Page unload cannot await a request. Closing the native streams immediately
// releases input and capture; the server expires its bounded reconnect lease.
window.addEventListener('pagehide', () => { stopViewer(); windowTransport.dispose(); });
void connect();
