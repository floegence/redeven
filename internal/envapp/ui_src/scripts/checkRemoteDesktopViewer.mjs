/* global document, window, innerWidth, CompositionEvent, MouseEvent, getComputedStyle */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, _electron } from 'playwright';
import { WebSocketServer } from 'ws';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '../../../..');
const assets = path.join(root, 'internal/codeapp/appserver/remote_desktop_viewer');
const shared = path.join(root, 'internal/codeapp/appserver/host_application_viewer');
const native = JSON.parse(execFileSync('go', ['list', '-m', '-json', 'github.com/floegence/floe-native-apps'], { cwd: root, env: { ...process.env, GOWORK: 'off' }, encoding: 'utf8' })).Dir;
const token = 'qualification-private-ticket';
const backend = process.argv.includes('--macos') ? 'macos' : process.argv.includes('--wayland') ? 'wayland' : 'x11';
let messages = [], controls = [], sockets = [], generation = 0, frame = 0, selectedMode = 'control';
let control, media, display = 'one', connectionCount = 0, disconnects = 0, ticketFailures = 0;
let conflictNextConnect = false;
let failDisconnect = true;
let lockedNextConnect = false;
let delayAudio = false, audioResponse;
const configuration = { session: { id: 'qualification', host_name: 'Task desktop', locale: 'en-US', mode: 'control', display_id: '' }, base: '/_redeven_desktop/' };
const names = { 'input.js': 'remote-input.generated.js', 'pointer.js': 'remote-pointer.generated.js' };
const server = http.createServer((request, response) => {
  if (delayAudio && request.url.endsWith('/host_desktop_audio.mjs')) { audioResponse = response; return; }
  if (request.url === '/launcher') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Viewer owner fixture</title>'); return; }
  if (request.url === '/_redeven_desktop/ticket') {
    connectionCount++;
    if (ticketFailures > 0) { ticketFailures--; response.writeHead(503).end(); return; }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, data: { token, session: { ...configuration.session, mode: selectedMode } } })); return;
  }
  if (request.url === '/_redeven_desktop/disconnect') { disconnects++; response.writeHead(failDisconnect ? 503 : 200).end('{}'); return; }
  if (request.url === '/_redeven_desktop/') {
    // This fixture owns media/input behavior. Native carrier qualification is
    // TestWindowBrowserE2E and TestWindowTunnelBrowserE2E.
    const html = readFileSync(path.join(assets, 'viewer.html'), 'utf8').replaceAll('{{.Base}}', '/_redeven_desktop/').replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Theme}}', 'porcelain-dark').replaceAll('{{.Nonce}}', 'qualification').replaceAll('{{.Configuration}}', JSON.stringify(configuration))
      .replace('<script src="{{.TransportScript}}"></script>', `<script>
        const fixtureFetch = window.fetch.bind(window);
        window.transportEvents = [];
        window.RedevenWindowTransport = { create: () => ({
          fetch: async (...args) => {
            window.transportEvents.push(String(args[0]));
            const response = await fixtureFetch(...args);
            window.transportEvents.push('response:' + String(args[0]));
            return response;
          },
          WebSocket: window.WebSocket,
          dispose: () => window.transportEvents.push('disposed'),
        }) };
        window.fetch = () => { throw new Error('Viewer bypassed the native transport'); };
      </script>`);
    response.setHeader('Content-Type', 'text/html'); response.end(html); return;
  }
  const name = request.url?.split('/').at(-1);
  if (!/^[a-zA-Z_.-]+$/.test(name ?? '')) { response.writeHead(404).end(); return; }
  if (name === 'floe.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(['appearance.generated.css', 'remote-input.generated.css', 'remote-pointer.generated.css'].map(file => readFileSync(path.join(shared, file), 'utf8')).join('\n'));
    return;
  }
  const source = names[name] ? path.join(shared, names[name]) : name.startsWith('host_desktop_') ? path.join(native, name) : path.join(assets, name);
  try { response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(readFileSync(source)); } catch { response.writeHead(404).end(); }
});
const ws = new WebSocketServer({ noServer: true });
const displays = [{ id: 'one', name: 'Fixture one', width: 320, height: 180, primary: true }, { id: 'two', name: 'Fixture two', width: 640, height: 360, primary: false }];
function state() { control.send(JSON.stringify({ version: 1, type: 'state', state: 'active', mode: selectedMode, generation, display_id: display, displays })); }
function paint() {
  const png = new PNG({ width: display === 'one' ? 320 : 640, height: display === 'one' ? 180 : 360 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 30; png.data[i + 1] = 80; png.data[i + 2] = 120; png.data[i + 3] = 255; }
  const data = PNG.sync.write(png);
  const header = Buffer.from(JSON.stringify({ version: 1, type: 'frame', codec: 'png', key: true, generation, frame_id: ++frame, width: png.width, height: png.height, timestamp: 1, bytes: data.length }));
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
  media.send(Buffer.concat([prefix, header, data]));
}
server.on('upgrade', (request, socket, head) => {
  assert.equal(request.headers['sec-websocket-protocol'], `redeven-desktop-v1, ${token}`);
  assert(!request.url.includes(token));
  ws.handleUpgrade(request, socket, head, connection => {
    sockets.push(connection);
    if (request.url.endsWith('/media')) media = connection;
    else {
      control = connection; controls.push(connection);
      connection.on('message', data => {
        const packet = JSON.parse(data); const command = packet.command; messages.push(packet);
        if (command.method === 'probe') connection.send(JSON.stringify({ version: 1, type: 'capabilities', capabilities: { backend, displays } }));
        if (command.method === 'connect') {
          if (lockedNextConnect) {
            lockedNextConnect = false;
            connection.send(JSON.stringify({ version: 1, type: 'error', code: 'LOCKED', generation: ++generation }));
            return;
          }
          if (conflictNextConnect) {
            conflictNextConnect = false;
            connection.send(JSON.stringify({ version: 1, type: 'error', code: 'CONTROL_IN_USE' }));
            return;
          }
          generation++; selectedMode = command.mode; display = command.display_id || displays.find(item => item.primary).id; state();
        }
        if (['select_display', 'configure', 'set_mode'].includes(command.method)) {
          assert.equal(command.generation, generation, 'overlapping transition used a stale generation');
          // An already encoded old picture may cross the requested transition.
          // It must not authorize input or produce a stale native paint receipt.
          const previousFrame = frame + 1, previousGeneration = generation;
          paint();
          setTimeout(() => {
            assert(!messages.some(item => item.command.method === 'frame_ack' && item.command.generation === previousGeneration && item.command.frame_id === previousFrame), 'transition acknowledged an old picture');
            generation++; display = command.display_id ?? display; selectedMode = command.mode ?? selectedMode; state(); setTimeout(paint, 25);
          }, 60);
        }
        if (command.method === 'get_clipboard') connection.send(JSON.stringify({ version: 1, type: 'clipboard', generation, text: 'Task clipboard 中文' }));
      });
    }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const desktop = process.argv.includes('--electron');
let directory, application;
let browser;
try {
  let page, opener;
  if (desktop) {
    const requireDesktop = createRequire(path.join(root, 'desktop/package.json'));
    execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
    directory = await mkdtemp(path.join(tmpdir(), 'redeven-remote-desktop-'));
    const { build } = requireDesktop('esbuild');
    for (const [source, name] of [['scripts/fixtures/remote-desktop.ts', 'fixture.cjs'], ['src/preload/hostApplicationWindow.ts', 'preload.cjs']]) {
      await build({ entryPoints: [path.join(root, 'desktop', source)], outfile: path.join(directory, name), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
    }
    const marker = randomUUID();
    application = await _electron.launch({ cwd: directory, executablePath: requireDesktop('electron'), args: [path.join(directory, 'fixture.cjs'), `--user-data-dir=${directory}/profile`, `--redeven-remote-desktop-run=${marker}`], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, REDEVEN_DESKTOP_FIXTURE_URL: `http://127.0.0.1:${server.address().port}/_redeven_desktop/`, REDEVEN_DESKTOP_FIXTURE_PRELOAD: path.join(directory, 'preload.cjs') } });
    console.log('Owned desktop fixture:', JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), pid: application.process().pid, state: directory, marker }));
    page = await application.firstWindow();
  } else {
    browser = await chromium.launch({ headless: true });
    opener = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    await opener.goto(`http://127.0.0.1:${server.address().port}/launcher`);
    const popup = opener.waitForEvent('popup');
    await opener.evaluate(() => { window.addEventListener('message', event => { window.filesMessage = event.data; }); window.open('about:blank', '_blank'); });
    page = await popup;
  }
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Viewer error:', error.stack); });
  await page.addInitScript(() => {
    window.qualificationAudioSamples = [];
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) { super(...args); window.qualificationAudioContext = this; }
    };
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...transfer) => {
          if (message.type === 'samples') window.qualificationAudioSamples.push({ generation: message.generation, frames: message.planes[0].length });
          return send(message, ...transfer);
        };
      }
    };
    const denied = async () => { throw new DOMException('Fixture clipboard permission denied', 'NotAllowedError'); };
    Object.defineProperty(navigator, 'clipboard', { value: { readText: denied, writeText: denied } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/_redeven_desktop/`);
  await page.waitForFunction(() => document.querySelector('#connection').hidden);
  const canvasCursor = () => page.locator('#desktop').evaluate(element => getComputedStyle(element).cursor);
  assert.notEqual(await canvasCursor(), 'none', 'waiting for the first picture must retain the local cursor');
  if (desktop) {
    const layout = await page.evaluate(() => {
      const root = document.documentElement, bar = document.querySelector('#toolbar');
      const bounds = bar.getBoundingClientRect();
      const start = parseFloat(getComputedStyle(root).getPropertyValue('--redeven-desktop-titlebar-start-inset'));
      const end = parseFloat(getComputedStyle(root).getPropertyValue('--redeven-desktop-titlebar-end-inset'));
      return { height: bounds.height, expected: parseFloat(getComputedStyle(root).getPropertyValue('--redeven-desktop-titlebar-height')),
        hostLeft: document.querySelector('.identity').getBoundingClientRect().left, start,
        lastRight: document.querySelector('#disconnect').getBoundingClientRect().right, availableRight: innerWidth - end,
        stageTop: document.querySelector('#stage').getBoundingClientRect().top,
        duplicateClose: !!document.querySelector('#window-close'),
        drag: getComputedStyle(bar).getPropertyValue('-webkit-app-region'),
        buttonDrag: getComputedStyle(document.querySelector('#fullscreen')).getPropertyValue('-webkit-app-region') };
    });
    assert.equal(layout.height, layout.expected, 'Desktop titlebar and toolbar must share one row');
    assert.equal(layout.stageTop, layout.height, 'remote picture must start directly below the shared row');
    assert(layout.hostLeft >= layout.start && layout.lastRight <= layout.availableRight, 'toolbar overlapped native window buttons');
    assert.equal(layout.duplicateClose, false, 'native window buttons must not have a duplicate close control');
    assert.equal(layout.drag, 'drag'); assert.equal(layout.buttonDrag, 'no-drag');
    console.log('Unified toolbar:', JSON.stringify(layout));
  }
  await page.locator('#desktop').evaluate(canvas => canvas.dispatchEvent(new MouseEvent('pointerdown', {bubbles:true}))); await page.keyboard.press('a');
  assert.equal(messages.filter(item => item.command.method === 'input').length, 0, 'input before first paint');
  paint();
  await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  assert.equal(await canvasCursor(), 'none', 'the captured desktop cursor must not be doubled by the local cursor');
  assert.equal(await page.locator('#settings').evaluate(element => getComputedStyle(element).cursor), 'pointer', 'desktop cursor policy must not hide toolbar cursors');
  assert.deepEqual(await page.locator('.floe-remote-input').evaluate(input => {
    const style = getComputedStyle(input);
    return { position: style.position, opacity: style.opacity };
  }), { position: 'fixed', opacity: '0' }, 'idle remote input must not consume space below the desktop');
  if (backend === 'wayland') {
    for (const [authorization, label] of [['restoring', 'Restoring sharing approval…'], ['needs_consent', 'Connecting to desktop…']]) {
      control.send(JSON.stringify({ version: 1, type: 'state', state: 'authorizing', authorization, generation: ++generation }));
      await page.waitForFunction(expected => document.querySelector('#status').textContent === expected, label);
      assert(await page.locator('.floe-remote-input').isDisabled(), 'authorization enabled input before new paint');
      assert(await page.locator('#reconnect').isHidden(), 'pending portal request allowed competing reconnect');
    }
    for (const [code, label] of [['PORTAL_FAILED', 'Previous approval recovery did not finish'], ['AUTHORIZATION_PENDING', 'A sharing request is already in progress. Finish or cancel it on the host, then retry.']]) {
      control.send(JSON.stringify({ version: 1, type: 'error', code, authorization: 'unknown', generation }));
      await page.waitForFunction(expected => document.querySelector('#status').textContent === expected, label);
      assert(await page.locator('#reconnect').isVisible(), 'failed authorization had no retry action');
      assert(await page.locator('.floe-remote-input').isDisabled(), 'failed authorization retained input');
    }
    generation++; state(); paint();
    await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  }
  if (process.env.REDEVEN_DESKTOP_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.REDEVEN_DESKTOP_EVIDENCE_DIR, `toolbar-${desktop ? 'electron' : 'browser'}.png`) });
  if (process.env.REDEVEN_DESKTOP_VISUAL_MATRIX === '1') {
    const evidence = process.env.REDEVEN_DESKTOP_EVIDENCE_DIR;
    assert(evidence, 'visual matrix requires an evidence directory');
    for (const theme of ['porcelain-light', 'porcelain-dark']) for (const width of [1280, 860, 360]) for (const locale of ['en-US', 'zh-CN']) {
      await page.setViewportSize({width, height:width === 360 ? 740 : 820});
      await page.evaluate(({theme,locale}) => { document.documentElement.dataset.floeShellTheme = theme; document.documentElement.lang = locale; }, {theme,locale});
      const prefix = `${desktop ? 'electron' : 'browser'}-${theme}-${width}-${locale}`;
      await page.screenshot({path:path.join(evidence, `${prefix}-toolbar.png`)});
      for (const id of ['display-settings','clipboard','shortcuts','settings']) {
        await page.locator('#'+id).click();
        assert.equal(await page.locator('#'+id).getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Tab');
        assert(await page.locator('#panel').evaluate(panel => panel.contains(document.activeElement)), 'dialog lost keyboard focus');
        const bounds = await page.locator('#panel').evaluate(panel => ({width:panel.clientWidth,content:panel.scrollWidth,top:panel.getBoundingClientRect().top,bottom:panel.getBoundingClientRect().bottom}));
        assert(bounds.content <= bounds.width && bounds.top >= 0 && bounds.bottom <= (width === 360 ? 740 : 820), `${prefix} ${id} clipped: ${JSON.stringify(bounds)}`);
        await page.screenshot({path:path.join(evidence, `${prefix}-${id}.png`)});
        await page.keyboard.press('Escape');
        assert(await page.locator('#'+id).evaluate(element => element === document.activeElement), `${id} did not restore keyboard focus`);
      }
    }
    await page.setViewportSize({width:1000,height:720});
    await page.evaluate(() => { document.documentElement.dataset.floeShellTheme = 'porcelain-dark'; document.documentElement.lang = 'en-US'; });
  }
  delayAudio = true;
  await page.locator('#settings').click();
  assert.notEqual(await page.locator('#panel-body').evaluate(element => getComputedStyle(element).cursor), 'none', 'local dialogs must retain their cursor');
  await page.getByLabel('System sound', { exact: true }).check();
  try {
    for (let attempt = 0; !audioResponse && attempt < 100; attempt++) await page.waitForTimeout(20);
    assert(audioResponse, 'audio setup did not request its worklet');
    assert(await page.getByRole('button', { name: 'Lock host', exact: true }).isDisabled(), 'lock remained available during asynchronous audio setup');
    assert(await page.locator('#quality').isDisabled(), 'configuration competed with asynchronous audio setup');
  } finally {
    delayAudio = false;
    if (audioResponse) { audioResponse.setHeader('Content-Type', 'text/javascript'); audioResponse.end(readFileSync(path.join(native, 'host_desktop_audio.mjs'))); }
  }
  await page.waitForFunction(() => !document.querySelector('#quality').disabled && document.querySelector('#sound').checked);
  await page.waitForFunction(() => !document.querySelector('#lock-host').disabled);
  await page.keyboard.press('Escape');
  await page.locator('#settings').click();
  assert.deepEqual(await page.evaluate(() => {
    document.querySelector('#quality').value = 'clarity';
    document.querySelector('#quality').dispatchEvent(new Event('change'));
    const lock = [...document.querySelectorAll('#panel-body button')].find(button => button.textContent === 'Lock host');
    const disabled = lock.disabled;
    lock.click();
    return [disabled, document.querySelector('#panel-title').textContent];
  }), [true, 'Desktop settings'], 'lock must wait for the configuration and fresh paint');
  await page.getByRole('button', { name: 'Lock host', exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('#panel-body button')].find(button => button.textContent === 'Lock host').disabled);
  await page.keyboard.press('Escape');
  for (const response of ['cancel', 'escape', 'confirm']) {
    const beforeLock = messages.filter(item => item.command.method === 'lock').length;
    await page.locator('#settings').click();
    await page.getByRole('button', { name: 'Lock host', exact: true }).click();
    await page.waitForTimeout(80); // Drain the preceding settings interaction.
    assert(await page.getByRole('dialog').isVisible(), 'lock confirmation disappeared');
    assert(await page.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => element === document.activeElement), 'replacement confirmation did not focus Cancel');
    assert.equal(messages.filter(item => item.command.method === 'lock').length, beforeLock, 'lock sent before confirmation');
    if (response === 'escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: response === 'confirm' ? 'Lock host' : 'Cancel', exact: true }).click();
    await page.waitForTimeout(80);
    assert.equal(messages.filter(item => item.command.method === 'lock').length, beforeLock + (response === 'confirm' ? 1 : 0), `lock ${response} did not apply the user's choice`);
    assert(!await page.getByRole('dialog').isVisible(), 'lock confirmation did not close');
    assert(await page.locator('#settings').evaluate(element => element === document.activeElement), 'confirmation did not restore settings focus');
  }
  const beforeRevokedLock = messages.filter(item => item.command.method === 'lock').length;
  await page.locator('#settings').click();
  await page.getByRole('button', { name: 'Lock host', exact: true }).click();
  control.send(JSON.stringify({ version: 1, type: 'state', state: 'suspended', code: 'permission_revoked', generation: ++generation }));
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Host authorization required');
  assert(await page.getByRole('button', { name: 'Lock host', exact: true }).isDisabled(), 'revoked confirmation remained enabled');
  state(); paint();
  await page.waitForFunction(() => document.querySelector('#connection').hidden);
  await page.getByRole('button', { name: 'Lock host', exact: true }).evaluate(button => button.click());
  assert(await page.getByRole('button', { name: 'Lock host', exact: true }).isDisabled(), 'new authority reused an old confirmation');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  assert.equal(messages.filter(item => item.command.method === 'lock').length, beforeRevokedLock, 'revoked confirmation sent a lock command');
  await page.locator('#desktop').click(); await page.keyboard.press('x');
  const compose = text => page.locator('.floe-remote-input').evaluate((element, text) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
  }, text);
  await compose('默认不提交');
  await page.waitForTimeout(80);
  assert(!messages.some(item => ['text', 'paste'].includes(item.command.input?.kind)), 'host input mode must not silently submit client text');
  assert.match(await page.locator('#notice').textContent(), /Paste client text/, 'client composition needs an actionable mode hint');
  await page.locator('#settings').click();
  assert.equal(await page.getByLabel('Text input', { exact: true }).inputValue(), 'host');
  assert.match(await page.locator('#text-input-hint').textContent(), /Finish or cancel.*host.*composition/);
  await page.getByLabel('Text input', { exact: true }).selectOption('paste');
  await page.keyboard.press('Escape');
  await page.locator('#desktop').click();
  await compose('中文办公😀');
  await page.waitForTimeout(80);
  assert(messages.some(item => item.command.input?.kind === 'paste' && item.command.input.text === '中文办公😀'), 'opted-in client composition must use explicit native paste');
  assert(messages.some(item => item.command.input?.code === 'KeyX'), 'physical key not delivered');
  await page.locator('.floe-remote-input').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.locator('#settings').click();
  await page.getByLabel('Text input', { exact: true }).selectOption('host');
  await page.keyboard.press('Escape');
  await page.locator('.floe-remote-input').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { data: '过期文本', bubbles: true })));
  await page.waitForTimeout(80);
  assert(!messages.some(item => item.command.input?.text === '过期文本'), 'switching modes must cancel the old client composition');
  await page.locator('#clipboard').click();
  await page.getByRole('button', { name: 'Copy from host', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#clipboard-text').value === 'Task clipboard 中文');
  await page.locator('#clipboard-text').fill('fixture paste');
  await page.getByRole('button', { name: 'Paste to host', exact: true }).click();
  await page.waitForTimeout(80);
  const paste = messages.findLastIndex(item => item.command.method === 'set_clipboard' && item.command.text === 'fixture paste');
  assert(paste >= 0, 'panel must publish clipboard before native paste');
  assert(messages.slice(paste + 1).some(item => item.command.input?.code === 'KeyV' && item.command.input.pressed), 'panel paste missing native chord');
  await page.getByLabel('Sync text clipboard', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#clipboard-sync').checked);
  assert(await page.locator('#notice').textContent(), 'denied browser clipboard must explain manual fallback');
  await page.keyboard.press('Escape');
  await page.locator('#display-settings').click();
  await page.keyboard.press('Escape');
  for (const [name, expected] of [
    ['Switch application', backend === 'macos' ? ['MetaLeft','Tab'] : ['AltLeft','Tab']],
    ['System menu', backend === 'macos' ? ['ControlLeft','F2'] : ['MetaLeft']],
  ]) {
    const start = messages.length;
    await page.locator('#shortcuts').click();
    await page.getByRole('button', {name:new RegExp(name)}).click();
    await page.waitForFunction(() => !document.querySelector('#panel').open);
    await page.waitForTimeout(60);
    const keys = messages.slice(start).filter(item=>item.command.input?.kind==='key').map(item=>[item.command.input.code,item.command.input.pressed]);
    assert.deepEqual(keys, [...expected.map(code=>[code,true]), ...[...expected].reverse().map(code=>[code,false])]);
  }
  // Native generations may repeat after a new attachment. Clipboard permission
  // promises must still belong to the exact connection that requested them.
  await page.locator('#clipboard').click();
  await page.evaluate(() => { navigator.clipboard.readText = () => new Promise(resolve => {window.finishClipboard = resolve;}); });
  await page.getByLabel('Sync text clipboard', {exact:true}).check();
  await page.waitForFunction(() => !!window.finishClipboard);
  const previousConnections = connectionCount;
  generation--; controls.at(-1).close();
  for (let attempt=0; connectionCount===previousConnections && attempt<150; attempt++) await page.waitForTimeout(20);
  assert(connectionCount>previousConnections);
  await page.waitForFunction(() => document.querySelector('#connection').hidden);
  paint();
  await page.waitForFunction(() => document.querySelector('#desktop').hasAttribute('data-painted'));
  await page.evaluate(() => { window.finishClipboard('clipboard from retired connection'); navigator.clipboard.readText = async () => {throw new DOMException('Denied','NotAllowedError');}; });
  await page.waitForTimeout(80);
  assert(!messages.some(item => item.command.text === 'clipboard from retired connection'), 'late clipboard escaped its connection');
  assert.equal(await page.locator('#clipboard-text').inputValue(), '', 'reconnect retained the old clipboard panel text');
  assert(!await page.locator('#clipboard-sync').isChecked());
  await page.keyboard.press('Escape');
  await page.locator('#display-settings').click();
  const beforeRapid = messages.filter(item => item.command.method === 'configure').length;
  assert.deepEqual(await page.evaluate(() => {
    document.querySelector('#pixels').click();
    const disabled = ['fit', 'pixels', 'display', 'mode'].map(id => document.getElementById(id).disabled);
    document.querySelector('#fit').click();
    return disabled;
  }), [true, true, true, true], 'transition controls remained interactive before the successor state');
  await page.waitForFunction(() => !document.querySelector('#fit').disabled && document.querySelector('#desktop').hasAttribute('data-painted'));
  assert.equal(messages.filter(item => item.command.method === 'configure').length, beforeRapid + 1, 'rapid clicks issued competing configurations');
  await page.locator('#display').selectOption('two');
  await page.waitForFunction(() => document.querySelector('#desktop').width === 640);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  assert.equal(await canvasCursor(), 'none', 'display replacement must retain only the captured cursor');
  await page.locator('#mode').selectOption('view');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#desktop')).cursor === 'none');
  assert(await page.locator('#shortcuts').isDisabled(), 'view-only shortcuts remained interactive');
  await page.locator('#clipboard').click();
  assert(await page.getByRole('button', {name:'Paste to host',exact:true}).isDisabled());
  assert.equal(await page.locator('#clipboard-text').inputValue(), '', 'view-only retained the previous controller clipboard');
  assert(!await page.locator('#clipboard-sync').isChecked(), 'view-only still advertised clipboard synchronization');
  await page.keyboard.press('Escape');
  const count = messages.filter(item => item.command.method === 'input').length;
  await page.locator('#desktop').click(); await page.keyboard.press('b');
  assert.equal(messages.filter(item => item.command.method === 'input').length, count, 'view mode delivered input');
  await page.locator('#mode').selectOption('control');
  assert(await page.getByRole('dialog').isVisible(), 'takeover missing confirmation');
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  assert.equal(await canvasCursor(), 'none', 'taking control must retain only the captured cursor');
  assert(messages.some(item => item.command.method === 'set_mode' && item.takeover), 'takeover missing explicit flag');
  control.send(JSON.stringify({ version: 1, type: 'state', state: 'suspended', code: 'locked', generation: ++generation }));
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Host is locked');
  assert(await page.locator('.floe-remote-input').isDisabled(), 'locked host retained input');
  assert.notEqual(await canvasCursor(), 'none', 'suspending capture must restore the local cursor');
  state(); paint();
  await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  control.send(JSON.stringify({ version: 1, type: 'state', state: 'suspended', code: 'permission_revoked', generation: ++generation }));
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Host authorization required');
  assert(await page.locator('#reconnect').isVisible(), 'permission recovery missing explicit reconnect');
  state(); paint();
  await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  control.send(JSON.stringify({ version: 1, type: 'state', state: 'suspended', code: 'DISPLAY_CHANGED', generation: ++generation }));
  control.send(JSON.stringify({ version: 1, type: 'displays', displays: [displays[0]] }));
  await page.waitForFunction(() => document.querySelector('#desktop').width === 320 && !document.querySelector('.floe-remote-input').disabled);
  assert.equal(messages.findLast(item => item.command.method === 'select_display').command.display_id, 'one', 'removed monitor must recover to primary');
  ticketFailures = 2;
  controls.at(-1).close();
  await page.waitForFunction(() => !document.querySelector('#connection').hidden);
  await page.waitForFunction(() => document.querySelector('#connection').hidden, null, { timeout: 10000 });
  assert(connectionCount >= 4, 'temporary ticket failures stopped automatic reconnect');
  assert(await page.locator('.floe-remote-input').isDisabled(), 'reconnect reused prior paint');
  assert.notEqual(await canvasCursor(), 'none', 'reconnect must wait for fresh paint before hiding the local cursor');
  paint(); await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  assert.equal(await canvasCursor(), 'none', 'reconnect must hide the duplicate cursor after fresh paint');
  assert.equal(await page.evaluate(() => window.qualificationAudioContext.state), 'running', 'reconnect closed enabled sound while the product still advertised it');
  await page.locator('#settings').click();
  assert(await page.locator('#sound').isChecked(), 'reconnect lost the sound preference');
  await page.keyboard.press('Escape');
  const opus = Buffer.from(await page.evaluate(async () => {
    const chunks = [];
    const encoder = new window.AudioEncoder({ output: chunk => { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); chunks.push([...bytes]); }, error: error => { throw error; } });
    encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    const data = new window.AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 960, numberOfChannels: 2, timestamp: 0, data: new Float32Array(1920).fill(.1) });
    encoder.encode(data); data.close(); await encoder.flush(); encoder.close();
    return chunks[0];
  }));
  const audioHeader = Buffer.from(JSON.stringify({ version: 1, type: 'audio', codec: 'opus', generation, sample_rate: 48000, channels: 2, timestamp: 0, bytes: opus.length }));
  const audioPrefix = Buffer.alloc(4); audioPrefix.writeUInt32BE(audioHeader.length);
  media.send(Buffer.concat([audioPrefix, audioHeader, opus]));
  await page.waitForFunction(current => window.qualificationAudioSamples.some(sample => sample.generation === current && sample.frames > 0), generation);
  lockedNextConnect = true; controls.at(-1).close();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Host is locked', null, { timeout: 3000 });
  assert(await page.locator('.floe-remote-input').isDisabled(), 'initially locked host retained input');
  assert(await page.locator('#reconnect').isVisible(), 'initially locked host cannot reconnect after local unlock');
  await page.locator('#reconnect').click();
  await page.waitForFunction(() => document.querySelector('#connection').hidden);
  assert(await page.locator('.floe-remote-input').isDisabled(), 'unlock reconnect reused prior paint');
  paint(); await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
  await page.locator('#fullscreen').click();
  try {
    await page.waitForFunction(() => document.documentElement.classList.contains('desktop-fullscreen') && !document.querySelector('#fullscreen').disabled, null, { timeout: 10000 });
  } catch (error) {
    console.error('Fullscreen failure:', JSON.stringify({
      renderer: await page.evaluate(() => ({ fullscreen: !!document.fullscreenElement, classes: document.documentElement.className, disabled: document.querySelector('#fullscreen').disabled, bridge: !!window.redevenHostApplicationWindow, focus: document.hasFocus() })),
      native: desktop ? await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ fullscreen: win.isFullScreen(), visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused() }))) : null,
    }));
    throw error;
  }
  if (desktop) assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), 'fullscreen did not reach the native window');
  assert.equal(await canvasCursor(), 'none', 'fullscreen must retain only the captured cursor');
  await page.locator('#desktop').click();
  await page.mouse.move(500, 400);
  await page.waitForFunction(() => document.querySelector('#toolbar').classList.contains('hidden-toolbar'), null, {timeout:4000});
  await page.mouse.move(500, 2);
  await page.waitForFunction(() => !document.querySelector('#toolbar').classList.contains('hidden-toolbar'));
  await page.locator('#pin').click();
  assert.equal(await page.locator('#pin').getAttribute('aria-pressed'), 'true');
  await page.locator('#desktop').click(); await page.mouse.move(500, 400);
  await page.waitForTimeout(2400);
  assert(!await page.locator('#toolbar').evaluate(bar => bar.classList.contains('hidden-toolbar')), 'pinned toolbar disappeared');
  await page.locator('#pin').click();
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('desktop-fullscreen') && !document.querySelector('#fullscreen').disabled, null, { timeout: 10000 });
  if (desktop) assert(!await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), 'native fullscreen did not exit');
  for (const savedDisplay of ['two', 'removed']) for (const accept of [false, true]) {
    configuration.session.display_id = savedDisplay;
    selectedMode = 'control'; conflictNextConnect = true; controls.at(-1).close();
    await page.getByRole('button', { name: accept ? 'Take control' : 'Cancel', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#connection').hidden);
    const connect = messages.findLast(item => item.command.method === 'connect');
    assert.equal(connect.command.mode, accept ? 'control' : 'view', 'native control conflict did not apply the choice');
    assert.equal(connect.command.display_id, savedDisplay === 'removed' ? '' : savedDisplay, 'native control conflict reused an unavailable display or lost the requested display');
    assert.equal(connect.takeover, accept, 'native control conflict inferred takeover consent');
    paint();
    await page.waitForFunction(width => document.querySelector('#desktop').width === width, savedDisplay === 'removed' ? 320 : 640);
    if (accept) await page.waitForFunction(() => !document.querySelector('.floe-remote-input').disabled);
    else assert(await page.locator('.floe-remote-input').isDisabled(), 'declining takeover enabled input');
  }
  await page.setViewportSize({ width: 360, height: 640 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow window horizontal overflow');
  await page.locator('#settings').click(); await page.keyboard.press('Escape');
  if (desktop) {
    assert.deepEqual(await page.evaluate(() => Object.keys(window.redevenHostApplicationWindow).sort()), ['request', 'subscribe']);
    assert.equal(await page.evaluate(() => typeof window.redevenDesktop), 'undefined');
    await page.locator('#files').click();
    await page.waitForFunction(() => document.documentElement.dataset.fixtureFiles === '1');
  } else {
    await page.locator('#files').click();
    await opener.waitForFunction(() => window.filesMessage?.type === 'redeven:remote-desktop:files' && window.filesMessage.session_id === 'qualification');
    await page.bringToFront();
  }
  const catalogs = await page.evaluate(() => window.remoteDesktopCatalog);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    await page.evaluate(locale => { document.documentElement.lang = locale; }, locale);
    await page.waitForFunction(title => document.title.startsWith(title), catalog.title);
    assert.equal(await page.locator('#files').getAttribute('aria-label'), catalog.files);
    assert.equal(await page.locator('#files').getAttribute('title'), catalog.files);
    assert.equal(await page.locator('#files svg').count(), 1);
    assert.equal(await page.locator('#desktop').getAttribute('aria-label'), catalog.title);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale} narrow window overflow`);
    await page.locator('#settings').click();
    const selector = page.getByLabel(catalog.textInput, { exact: true });
    assert.equal(await selector.getAttribute('title'), catalog.hostInput);
    assert.equal(await page.locator('#text-input-hint').textContent(), catalog.textInputHint);
    const layout = await page.locator('#panel-body').evaluate(element => ({
      width: element.clientWidth, content: element.scrollWidth,
      children: [...element.children].map(child => ({ text: child.textContent, width: child.clientWidth, content: child.scrollWidth })),
    }));
    assert(layout.content <= layout.width, `${locale} narrow settings overflow: ${JSON.stringify(layout)}`);
    if (process.env.REDEVEN_DESKTOP_EVIDENCE_DIR && ['en-US', 'zh-CN'].includes(locale)) {
      await page.screenshot({ path: path.join(process.env.REDEVEN_DESKTOP_EVIDENCE_DIR, `text-input-${desktop ? 'electron' : 'browser'}-${locale}.png`) });
    }
    await page.keyboard.press('Escape');
  }
  await page.locator('#disconnect').click();
  await page.locator('#retry-disconnect').waitFor({state:'visible'});
  assert(!await page.evaluate(() => window.transportEvents.includes('disposed')), 'failed disconnect discarded the only retry transport');
  assert(await page.locator('#desktop').evaluate(element => getComputedStyle(element).visibility === 'hidden'), 'failed disconnect retained a frozen picture');
  failDisconnect = false;
  await page.locator('#retry-disconnect').click();
  await page.waitForFunction(() => window.transportEvents.includes('disposed'));

  assert.notEqual(await canvasCursor(), 'none', 'disconnect must restore the local cursor');
  assert.equal(await page.evaluate(() => window.qualificationAudioContext.state), 'closed', 'explicit disconnect retained the audio device');
  assert.equal(disconnects, 2); assert.deepEqual(errors, []);
  assert(await page.locator('#desktop').evaluate(element => getComputedStyle(element).visibility === 'hidden'), 'disconnected desktop must not retain a visible frozen picture');
  assert(await page.locator('#clipboard').isDisabled(), 'disconnected clipboard still appears usable');
  assert(await page.locator('#reconnect').isHidden(), 'ended session exposes an ineffective reconnect');
  assert(await page.locator('#shortcuts').isDisabled(), 'ended session exposes remote shortcuts');
  assert(await page.locator('#disconnect').isDisabled(), 'ended session exposes duplicate disconnect');
  assert(await page.locator('#retry-disconnect').isHidden(), 'confirmed disconnect retained a retry');
  assert(await page.locator('#desktop').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)].every(value => value === 0)), 'disconnect retained captured pixels');
  const endedTickets = connectionCount;
  await page.waitForTimeout(1200);
  assert.equal(connectionCount, endedTickets, 'explicit disconnect restarted the session');
  if (process.env.REDEVEN_DESKTOP_EVIDENCE_DIR) await page.screenshot({path:path.join(process.env.REDEVEN_DESKTOP_EVIDENCE_DIR, `disconnected-${desktop ? 'electron' : 'browser'}.png`)});

  assert.deepEqual(await page.evaluate(() => window.transportEvents.slice(-3)), [
    '/_redeven_desktop/disconnect', 'response:/_redeven_desktop/disconnect', 'disposed',
  ], 'disconnect must finish through the native transport before disposal');
  console.log(JSON.stringify({ passed: true, checks: ['single desktop cursor', 'local chrome cursors', 'paint authority', 'explicit client text paste', 'host input default', 'composition cancellation', 'physical keys', 'clipboard panel', 'display selection', 'view-only', 'explicit takeover', 'reconnect', 'reconnect audio samples', 'narrow localized settings', 'dialog keyboard', 'shortcut receipts', 'browser and Desktop files', 'clipboard epoch fencing', 'fullscreen hide and pin', 'disconnect retry and cleared pixels'] }));
} finally {
  await application?.close(); await browser?.close(); for (const socket of sockets) socket.terminate(); ws.close(); await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
}
