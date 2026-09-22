/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, writeFile } from 'node:fs/promises';
import net from 'node:net';

// Stable Firefox uses its native WebDriver/BiDi implementation. Playwright's
// patched Firefox build is separate development coverage, not stable qualification.
export async function runWebDriverProjection({ origin, sourceOrigin, configuration, page, directory }) {
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const executable = process.env.REDEVEN_BROWSER_WEBDRIVER;
  const binary = process.env.REDEVEN_BROWSER_CLIENT_EXECUTABLE;
  assert.ok(executable && binary, 'Stable qualification needs explicit task-owned browser and WebDriver executables');
  await Promise.all([access(executable), access(binary)]);
  const driver = spawn(executable, ['--host', '127.0.0.1', '--port', String(port), '--websocket-port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let driverLog = '', session, socket;
  let driverError;
  driver.on('error', error => { driverError = error; });
  driver.stderr.on('data', value => { driverLog = (driverLog + value).slice(-16384); });
  const pending = new Map(), forbiddenRequests = [];
  let sequence = 0;
  const command = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
    const { value } = await response.json();
    if (!response.ok) throw new Error(`WebDriver ${path}: ${value.message}`);
    return value;
  };
  const until = async (probe, label) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const value = await probe();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Stable browser did not reach ${label}`);
  };
  const call = (method, path, body) => command(method, `/session/${session}${path}`, body);
  const evaluate = (fn, ...args) => call('POST', '/execute/sync', { script: `return (${fn.toString()})(...arguments)`, args });
  const asyncEvaluate = (fn, ...args) => call('POST', '/execute/async', { script: `const done=arguments[arguments.length-1]; Promise.resolve((${fn.toString()})(...Array.from(arguments).slice(0,-1))).then(value=>done({value}),error=>done({error:String(error)}))`, args });
  const element = async selector => {
    const values = await call('POST', '/elements', { using: 'css selector', value: selector });
    return values[0];
  };
  const elementID = value => value['element-6066-11e4-a52e-4f735466cecf'];
  const click = async selector => {
    const target = await until(() => element(selector), selector);
    await call('POST', `/element/${elementID(target)}/click`, {});
  };
  const clickButton = async name => {
    const target = await until(() => evaluate(label => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent.trim() === label) ?? null, name), name);
    await call('POST', `/element/${elementID(target)}/click`, {});
  };
  const frame = async selector => {
    const target = await until(() => element(selector), selector);
    await call('POST', '/frame', { id: target });
  };
  const top = () => call('POST', '/frame', { id: null });
  const bidi = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await until(() => { if (driverError) throw driverError; return command('GET', '/status').catch(() => false); }, 'WebDriver startup');
    const created = await command('POST', '/session', { capabilities: { alwaysMatch: {
      browserName: 'firefox', acceptInsecureCerts: true, webSocketUrl: true,
      'moz:firefoxOptions': { binary, args: ['-headless'], prefs: { 'dom.disable_open_during_load': false } },
    } } });
    session = created.sessionId;
    socket = new WebSocket(created.capabilities.webSocketUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const waiting = pending.get(message.id);
      if (waiting) { pending.delete(message.id); if (message.type === 'error') waiting.reject(new Error(message.message)); else waiting.resolve(message.result); }
      else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
        forbiddenRequests.push(message.params.request.url);
        void bidi('network.failRequest', { request: message.params.request.request }).catch(() => {});
      }
    });
    await bidi('session.subscribe', { events: ['network.beforeRequestSent'] });
    await bidi('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [sourceOrigin, sourceOrigin.replace('127.0.0.1', 'localhost')].map(value => {
      const url = new URL(value); return { type: 'pattern', protocol: 'http', hostname: url.hostname, port: url.port };
    }) });
    await bidi('script.addPreloadScript', { functionDeclaration: `() => {
      window.fixtureDirectRTC=0;
      window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, { construct() { window.fixtureDirectRTC++; throw new Error('Client RTC is forbidden'); } });
      window.fixtureMediaEvents={sent:{},received:{},errors:[]};
      const Native=Worker;
      window.Worker=class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({data}) => { const events=window.fixtureMediaEvents.received; events[data.type]=(events[data.type]??0)+1; if(data.type==='error')window.fixtureMediaEvents.errors.push(data.message); });
          this.addEventListener('error', event => window.fixtureMediaEvents.errors.push(event.message));
        }
        postMessage(data, transfer) { const events=window.fixtureMediaEvents.sent; const key=data.type==='frame'?data.frame.header.codec:data.type; events[key]=(events[key]??0)+1; super.postMessage(data, transfer); }
      };
    }` });
    await call('POST', '/window/rect', { width: 1200, height: 900 });
    await call('POST', '/url', { url: origin + '/fixture.html' });
    await until(() => evaluate(() => typeof window.startBrowserFixture === 'function'), 'fixture readiness');
    const started = await asyncEvaluate(value => window.startBrowserFixture(value), configuration);
    assert.equal(started.error, undefined);
    await frame('#browser-document');
    await until(() => evaluate(() => {
      const replay = document.querySelector('iframe')?.contentDocument;
      return replay?.querySelector('#counter') && replay.querySelector('#picture')?.naturalWidth === 44;
    }), 'projected DOM, stylesheet and image');
    const content = await evaluate(() => {
      const replay = document.querySelector('iframe');
      return { color: getComputedStyle(replay.contentDocument.querySelector('#counter')).color,
        script: replay.contentWindow.websiteExecuted ?? null, rtc: window.fixtureDirectRTC,
        bridge: replay.contentWindow.redevenDesktop ?? null };
    });
    assert.deepEqual(content, { color: 'rgb(13, 87, 143)', script: null, rtc: 0, bridge: null });
    await frame('iframe');
    await click('#counter');
    await page.waitForFunction(() => window.count === 1);
    await until(() => evaluate(() => document.querySelector('#counter')?.textContent === 'Count 1'), 'input feedback');
    await top();
    const original = await call('GET', '/window');
    await click('#open');
    const popup = await until(async () => (await call('GET', '/window/handles')).find(value => value !== original), 'independent window');
    await call('POST', '/window', { handle: popup });
    await until(() => evaluate(() => !!document.querySelector('iframe')?.contentDocument?.querySelector('#counter')), 'independent projection');
    await call('POST', '/window', { handle: original });
    await evaluate(() => window.leaveBrowserPage());
    await call('POST', '/window', { handle: popup });
    await click('[data-floe-ui="take-control"]');
    await until(() => evaluate(() => !document.querySelector('[role=combobox]')?.readOnly), 'control grant');
    await until(() => evaluate(() => {
      const viewport = document.querySelector('.floe-viewport'), replay = viewport?.querySelector('iframe');
      return replay && Number(replay.width) === viewport.clientWidth && !viewport.parentElement.classList.contains('switching') && replay.contentDocument?.querySelector('#counter')?.textContent === 'Count 1';
    }), 'controller viewport and current projection');
    await frame('iframe');
    await click('#counter');
    await page.waitForFunction(() => window.count === 2);
    await top();
    const mediaPixels = color => until(() => evaluate(expected => {
      const replay = document.querySelector('iframe')?.contentDocument;
      const video = replay?.querySelector('#clip'), image = replay?.querySelector('#scene');
      if (!video || video.videoWidth !== 160 || video.readyState < 2 || !image?.naturalWidth) return false;
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d');
      return [video, image].every(element => {
        context.drawImage(element, 0, 0);
        const rgba = context.getImageData(20, 20, 1, 1).data;
        return expected === 'green' ? rgba[1] > 200 && rgba[2] < 80 : rgba[2] > 200 && rgba[1] < 80;
      });
    }, color), `actual decoded ${color} video and Canvas`);
    await mediaPixels('green');
    await click('[aria-label="Bookmarks and history"]');
    await clickButton('Bookmark this page');
    await until(() => evaluate(url => document.querySelector('.browser-library-entries')?.textContent.includes(url), sourceOrigin), 'shared bookmark persistence');
    await clickButton('Close library');
    await frame('iframe');
    await click('#counter');
    await page.waitForFunction(() => window.count === 3);
    await top();
    await mediaPixels('blue');
    console.error('Stable Firefox media evidence:', JSON.stringify(await evaluate(() => window.fixtureMediaEvents)));
    assert.equal(await evaluate(() => window.fixtureDirectRTC), 0);
    assert.deepEqual(forbiddenRequests, [], 'Stable client never fetches the source website');
    const screenshot = await call('GET', '/screenshot');
    if (process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE) await writeFile(process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE.replace(/\.json$/u, '.png'), Buffer.from(screenshot, 'base64'));
    await call('DELETE', '/window');
    assert.equal(page.isClosed(), false);
    await call('POST', '/window', { handle: original });
    const closed = await asyncEvaluate(() => window.closeBrowserFixture());
    assert.equal(closed.error, undefined);
    process.stdout.write(`PASS (stable Firefox ${created.capabilities.browserVersion}): native WebDriver/BiDi; source-isolated Flowersec DOM, CSS, images, input, independent window lifetime, bookmarks and decoded Canvas/video\n`);
  } catch (error) {
    if (session) {
      await top().catch(() => {});
      console.error('Stable browser fixture:', await evaluate(() => document.body.innerText).catch(() => 'unavailable'));
      console.error('Stable browser media:', await evaluate(() => {
        const replay = document.querySelector('iframe')?.contentDocument, video = replay?.querySelector('#clip'), image = replay?.querySelector('#scene');
        return { events: window.fixtureMediaEvents, decoders: [typeof VideoDecoder, typeof AudioDecoder], video: video && { tag: video.tagName, width: video.videoWidth, ready: video.readyState, paused: video.paused, error: video.error?.message }, image: image && { tag: image.tagName, width: image.naturalWidth, src: image.src?.slice(0, 100) } };
      }).catch(() => 'unavailable'));
      if (process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE) await call('GET', '/screenshot').then(value => writeFile(process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE.replace(/\.json$/u, '-failure.png'), Buffer.from(value, 'base64'))).catch(() => {});
      console.error('Stable source counter:', await page.evaluate(() => ({ count: window.count, width: window.innerWidth, height: window.innerHeight })).catch(() => 'unavailable'));
      console.error('WebDriver log:', driverLog);
    }
    throw error;
  } finally {
    socket?.close();
    if (session) await call('DELETE', '').catch(() => {});
    driver.kill('SIGTERM');
    await writeFile(`${directory}/webdriver.log`, driverLog).catch(() => {});
  }
}
