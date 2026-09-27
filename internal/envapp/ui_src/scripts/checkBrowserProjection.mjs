/* global chrome, window, getComputedStyle */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir, copyFile, symlink } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { chromium, firefox, webkit, _electron as electron } from 'playwright';
import { createProxyServiceWorkerScript } from '@floegence/flowersec-core/proxy';
import { stageBrowserExtension } from '../../../../scripts/stage_browser_extension.mjs';
import { createBuiltDistTLS } from './checkPackagedRenderer.mjs';
import { runBrowserProjectionSoak } from './browserProjectionSoak.mjs';
import { runWebDriverProjection } from './browserProjectionWebDriver.mjs';
import { runBrowserProjectionPerformance } from './browserProjectionPerformance.mjs';
import { runBrowserProjectionSites } from './browserProjectionSites.mjs';
import { runBrowserProjectionMediaSync } from './browserProjectionMediaSync.mjs';
import { checkBrowserInputCongestion } from './browserProjectionCongestion.mjs';

// Driven by TestBrowserProjectionUsesOneFlowersecSession. Only startup metadata
// and results use stdout; artifacts travel through the parent-owned stdin pipe.
const clientName = process.env.REDEVEN_BROWSER_CLIENT ?? 'chromium';
assert.ok(['chromium', 'chrome', 'msedge', 'firefox', 'webkit', 'electron', 'firefox-stable'].includes(clientName),
  `Unsupported qualification client: ${clientName}. Use the requested browser's actual automation driver.`);
const input = createInterface({ input: process.stdin });
const nextMessage = () => new Promise(resolve => input.once('line', line => resolve(JSON.parse(line))));
const firstMessage = nextMessage();
const directory = await mkdtemp(path.join(process.env.REDEVEN_BROWSER_TEST_TEMP_ROOT || tmpdir(), 'redeven-browser-projection-'));
const tls = await createBuiltDistTLS();
let source, managedBrowser, client, website, publicServer, diagnosticPage;
const managedSource = process.env.REDEVEN_BROWSER_SOURCE === 'managed';
const extensionSource = process.env.REDEVEN_BROWSER_SOURCE === 'extension';
let extension, resources, testingManifest, cleanupWork;
const cleanup = () => cleanupWork ??= (async () => {
  input.close();
  await Promise.allSettled([client?.close(), managedBrowser ? managedBrowser.close() : source?.close()]);
  for (const server of [publicServer, website]) { server?.closeAllConnections(); server?.close(); }
  if (testingManifest) await rm(testingManifest, { force: true });
  await tls.cleanup(); await rm(directory, { recursive: true, force: true });
})();
process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(1)); });
process.once('SIGINT', () => { void cleanup().finally(() => process.exit(1)); });
try {
  if (extensionSource) {
    resources = path.join(directory, 'resources');
    await mkdir(resources);
    for (const name of await readdir('scripts')) if (/^(computer|redeven).*\.mjs$/u.test(name) && !name.endsWith('.node-test.mjs')) await copyFile(path.join('scripts', name), path.join(resources, name));
    await symlink(path.resolve('node_modules'), path.join(resources, 'node_modules'));
    extension = path.join(resources, 'extension'); stageBrowserExtension(extension);

  }
  let requestedDownloads = 0;
  const fileContent = Buffer.from('Flowersec browser file fixture\n'.repeat(8192));
  const syncMedia = await readFile(new URL('./fixtures/media/browser-av-sync.webm', import.meta.url));
  const dragFixture = `<div id="drag-track" style="position:fixed;right:24px;top:220px;width:280px;height:48px;background:#d8e5f3"><div id="drag-thumb" style="width:64px;height:48px;background:#3478bc;touch-action:none;user-select:none"></div><output id="drag-value">0</output></div><script>
    window.dragPositions=[];window.dragX=0;let dragHeld=false,dragOrigin=0;const dragThumb=document.getElementById('drag-thumb');
    dragThumb.onpointerdown=e=>{dragHeld=true;dragOrigin=e.clientX-window.dragX;dragThumb.setPointerCapture(e.pointerId)};
    dragThumb.onpointermove=e=>{if(!dragHeld)return;window.dragX=Math.max(0,Math.min(216,e.clientX-dragOrigin));window.dragPositions.push(window.dragX);dragThumb.style.transform='translateX('+window.dragX+'px)';document.getElementById('drag-value').textContent=window.dragX};
    dragThumb.onpointerup=()=>dragHeld=false;dragThumb.onlostpointercapture=()=>dragHeld=false;
  </script>`;
  website = http.createServer((request, response) => {
    if (request.url === '/av-sync.webm') {
      response.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': syncMedia.length });
      response.end(syncMedia);
    } else if (request.url === '/picture.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="32"><rect width="44" height="32" fill="green"/></svg>');
    } else if (['/fixture-download', '/browser-binary.bin'].includes(request.url)) {
      requestedDownloads++;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', ...(request.url === '/fixture-download' ? { 'Content-Disposition': 'attachment; filename=browser-fixture.txt' } : {}), 'Content-Length': fileContent.length });
      response.end(fileContent);
    } else if (request.url === '/theme.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end('#counter { color: rgb(13, 87, 143); font-size: 24px; } object#html-fallback { display: flex; align-items: center; gap: 8px; width: 470px; min-height: 64px; box-sizing: border-box; padding: 12px; border: 1px solid #dce2ea; background: #f6f8fb; font: 16px/24px Arial; } object#html-fallback input { width: 180px; }');
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>' + (request.url?.startsWith('/popup') ? 'Popup ' + request.url.slice(1) : 'Shared source fixture') + '</title><link rel="stylesheet" href="/theme.css"><h1>Source-only website</h1><object id="html-fallback"><label>Note <input id="focus-note" autofocus></label><img id="picture" src="/picture.svg"><button id="counter" onclick="this.textContent = `Count ${++window.count}`">Count 0</button></object><p><input id="upload" type="file" onchange="this.files[0].text().then(text=>document.getElementById(&quot;uploaded&quot;).textContent=text.length)"><output id="uploaded"></output></p><a id="download" href="/fixture-download">Download fixture</a> <a id="binary-download" href="/browser-binary.bin">Download binary</a> <button id="blob-download" onclick="const a=document.createElement(&quot;a&quot;);a.href=window.URL.createObjectURL(new Blob([&quot;source Blob bytes&quot;]));a.download=&quot;browser-blob.txt&quot;;a.click();window.URL.revokeObjectURL(a.href)">Download Blob</button><p><a id="popup-link" href="/popup" target="_blank">Open source popup</a></p><p><canvas id="scene" width="160" height="90"></canvas><video id="clip" width="160" height="90" autoplay muted playsinline></video></p><script>window.count=0;window.websiteExecuted=true;const scene=document.getElementById("scene"),ctx=scene.getContext("2d"),clip=document.getElementById("clip");setInterval(()=>{ctx.fillStyle=window.count<3?"#00ff00":"#0000ff";ctx.fillRect(0,0,160,90)},80);clip.srcObject=scene.captureStream(15);clip.play()</script>' + dragFixture);
    }
  });
  website.listen(0, '127.0.0.1'); await once(website, 'listening');
  const sourceOrigin = `http://127.0.0.1:${website.address().port}`;
  let page, port, targetInfo;
  if (!managedSource) {
  const executablePath = process.env.REDEVEN_BROWSER_TEST_EXECUTABLE;
  assert(executablePath && path.isAbsolute(executablePath), 'Source browser qualification requires an explicit verified executable');
  source = await chromium.launchPersistentContext(directory, { headless: true, executablePath, chromiumSandbox: true, ignoreDefaultArgs: extensionSource ? ['--disable-extensions'] : [], args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', ...(extensionSource ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : [])] });
  page = source.pages()[0]; await page.goto(sourceOrigin);
  const probe = await source.newCDPSession(page);
  ({ targetInfo } = await probe.send('Target.getTargetInfo')); await probe.detach();
  port = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
  }
  // Library mode preserves Node environment expressions by default. This
  // executable browser fixture needs the same production constant as the app.
  const bundle = await build({ configFile: false, plugins: [solid()], define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { conditions: ['browser'] }, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: 'scripts/browserProjectionFixture.tsx', formats: ['es'] },
    rolldownOptions: { output: { codeSplitting: false } },
  } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle).output;
  const script = output.find(item => item.type === 'chunk').code;
  const style = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
  const worker = createProxyServiceWorkerScript({ proxyPathPrefix: '/_redeven_proxy/', stripProxyPathPrefix: false });
  const directProxyRequests = [];
  publicServer = https.createServer({ cert: tls.certificate, key: tls.privateKey }, (request, response) => {
    if (request.url === '/_redeven_sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(worker); }
    else if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(style); }
    else if (request.url?.startsWith('/fixture.html')) { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><link rel="stylesheet" href="/fixture.css"><script type="module" src="/fixture.js"></script><body style="margin:0"><button id="open">Open independent browser</button>'); }
    else { if (request.url?.startsWith('/_redeven_proxy/')) { directProxyRequests.push(request.url); console.error('Unproxied browser resource', request.url); } response.writeHead(404); response.end(); }
  });
  publicServer.listen(0, '127.0.0.1'); await once(publicServer, 'listening');
  const origin = `https://127.0.0.1:${publicServer.address().port}`;
  process.stdout.write(JSON.stringify({ Resources: resources, Origin: origin, Endpoint: `http://127.0.0.1:${port}`, Tab: targetInfo?.targetId, Profile: targetInfo?.browserContextId || 'default', Certificate: tls.certificatePath, Key: tls.privateKeyPath }) + '\n');
  let configuration = await firstMessage;
  if (managedSource) {
    port = (await readFile(path.join(configuration.managedProfileDirectory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    managedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    source = managedBrowser.contexts()[0];
    page = source.pages()[0];
    await page.goto(sourceOrigin);
    const settings = nextMessage();
    process.stdout.write(JSON.stringify({ managedReady: true }) + '\n');
    configuration = await settings;
  }

  if (extensionSource) {
    const settings = nextMessage();
    // Native Messaging resolves user-level hosts under --user-data-dir. Copy
    // this Runtime's exact registration into the disposable browser profile.
    // See Chromium chrome/common/chrome_paths.cc, DIR_USER_NATIVE_MESSAGING.
    {
      const manifest = await readFile(path.join(configuration.nativeManifestDirectory, configuration.nativeHost + '.json'));
      testingManifest = path.join(directory, 'NativeMessagingHosts', configuration.nativeHost + '.json');
      await mkdir(path.dirname(testingManifest), { recursive: true });
      await writeFile(testingManifest, manifest, { flag: 'wx', mode: 0o600 });
    }
    const popup = await source.newPage();
    await popup.goto(`chrome-extension://${configuration.extensionID}/popup.html#${configuration.nativeHost}`);
    await popup.locator('summary').click();
    await popup.locator('#profile').fill('Projection fixture');
    await popup.locator('#connect-button').click();
    try { await popup.locator('#disconnect').waitFor({ state: 'visible', timeout: 10000 }); }
    catch (error) { console.error('Extension connection:', await popup.locator('#status').textContent(), await popup.evaluate(() => chrome.runtime.sendMessage({ command: 'status' }))); throw error; }
    await popup.close();
    process.stdout.write(JSON.stringify({ connected: true, sourceURL: sourceOrigin, sourceTitle: await page.title() }) + '\n');
    configuration = await settings;
  }
  if (process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE) await writeFile(process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE, JSON.stringify({
    mode: 'Product browser measurement', qualificationManifest: process.env.REDEVEN_BROWSER_RUN_MANIFEST ?? null,
    runtime_pid: configuration.runtimePID, fixture_pid: process.pid, origin, source_origin: sourceOrigin,
    source_cdp_port: Number(port), source_kind: managedSource ? 'runtime-managed' : extensionSource ? 'chrome-extension-native-messaging' : 'cdp', state_path: directory, started_at: new Date().toISOString(),
  }, null, 2) + '\n');
  if (clientName === 'firefox-stable') {
    await runWebDriverProjection({ origin, sourceOrigin, configuration, page, directory });
    assert.deepEqual(directProxyRequests, [], 'Stable browser Runtime requests use Flowersec');
  } else {
  const desktop = clientName === 'electron';
  let context, viewer;
  if (desktop) {
    const desktopRequire = createRequire(path.resolve('../../../desktop/package.json'));
    const { build: buildElectron } = desktopRequire('esbuild');
    const main = path.join(directory, 'projection-electron.cjs'), preload = path.join(directory, 'projection-preload.cjs');
    await buildElectron({ entryPoints: ['scripts/browserProjectionElectronFixture.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: main });
    await buildElectron({ stdin: { contents: "import { bootstrapDesktopShellBridge } from '../../../desktop/src/preload/desktopShell.ts'; bootstrapDesktopShellBridge();", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: preload });
    client = await electron.launch({ executablePath: desktopRequire('electron'), args: [main], env: { ...process.env,
      REDEVEN_BROWSER_ELECTRON_FIXTURE: JSON.stringify({ url: origin + '/fixture.html', spki: tls.certificateSPKIHash, state: path.join(directory, 'electron-state'), preload }),
    } });
    context = client.context(); viewer = await client.firstWindow();
  } else {
    const engine = { firefox, webkit }[clientName] ?? chromium;
    client = await engine.launch({ headless: true, ...(engine === chromium ? { args: [`--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`], ...(process.env.REDEVEN_BROWSER_CLIENT_EXECUTABLE ? { executablePath: process.env.REDEVEN_BROWSER_CLIENT_EXECUTABLE } : ['chrome', 'msedge'].includes(clientName) ? { channel: clientName } : {}) } : {}) });
    context = await client.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 900 } });
    viewer = await context.newPage();
  }
  context.on('response', async response => { if (response.status() >= 400) console.error('HTTP', response.status(), response.url(), await response.text().catch(() => '')); });
  context.on('requestfailed', request => console.error('request failed', request.url(), request.failure()));
  await context.addInitScript(() => {
    window.fixtureDirectRTC = 0;
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, { construct() { window.fixtureDirectRTC++; throw new Error('Client RTC is forbidden'); } });
  });
  const forbiddenRequests = [];
  await context.route(`${sourceOrigin}/**`, route => { forbiddenRequests.push(route.request().url()); return route.abort(); });
  viewer.on('pageerror', error => console.error('viewer:', error.message));
  viewer.on('console', message => { if (message.type() === 'error') console.error('viewer:', message.text()); });
  if (!desktop) await viewer.goto(origin + '/fixture.html');
  await viewer.waitForFunction(() => typeof window.startBrowserFixture === 'function');
  diagnosticPage = viewer;
  await viewer.evaluate(value => window.startBrowserFixture(value), configuration);
  const document = viewer.frameLocator('#browser-document');
  const replay = document.frameLocator('iframe');
  await replay.locator('#counter').waitFor({ state: 'visible', timeout: 20000 });
  await replay.locator('#picture').evaluate(image => image.decode());
  assert.equal(await replay.locator('#picture').evaluate(image => image.naturalWidth), 44);
  assert.equal(await replay.locator('#counter').evaluate(button => getComputedStyle(button).color), 'rgb(13, 87, 143)');
  assert.equal(await replay.locator('body').evaluate(() => window.websiteExecuted), undefined, 'source scripts never execute in the client replay');
  // Repeated source focus must restore a visible native caret, even when the
  // source selection did not move. Unicode input uses the same authorized Session.
  for (let click = 0; click < 2; click++) {
    const field = await replay.locator('#focus-note').boundingBox(); assert.ok(field);
    await viewer.mouse.click(field.x + 10, field.y + field.height / 2);
    await document.locator('.floe-input-proxy').waitFor({ state: 'visible' });
    await document.locator('.floe-input-proxy').evaluate(control => {
      if (control.ownerDocument.activeElement !== control) throw new Error('Source caret is not focused');
    });
  }
  await viewer.keyboard.insertText('光标验收');
  await page.waitForFunction(() => document.querySelector('#focus-note').value === '光标验收');
  // A Mac client must select the source text, including when Runtime is Linux.
  await viewer.keyboard.press('Meta+a');
  await page.waitForFunction(() => {
    const input = document.querySelector('#focus-note');
    return input.selectionStart === 0 && input.selectionEnd === input.value.length;
  }, undefined, { timeout: 3000 });
  await viewer.keyboard.insertText('全选替换验收');
  await page.waitForFunction(() => document.querySelector('#focus-note').value === '全选替换验收');
  await checkBrowserInputCongestion({ viewer, document, source: page });
  const inlineAddress = document.getByRole('combobox', { name: 'Website address' });
  await inlineAddress.fill(sourceOrigin + '/inline-navigation');
  await inlineAddress.press('Enter');
  await page.waitForURL(sourceOrigin + '/inline-navigation');
  await inlineAddress.fill(sourceOrigin + '/');
  await document.getByRole('button', { name: 'Open website', exact: true }).click();
  await page.waitForURL(sourceOrigin + '/');
  await replay.locator('#counter').waitFor({ state: 'visible' });
  assert.equal(await replay.locator('#html-fallback').evaluate(element => element.localName), 'floe-object', 'Ordinary object HTML is projected as an inert container');
  assert.equal(await replay.locator('object,embed,[data-floebrowser-unsupported]').count(), 0, 'Resource-free HTML does not become an unsupported surface');
  // Compare the authored, painted object surface rather than platform-native
  // inline font union metrics. Source input and script isolation remain required.
  const fallbackGeometry = element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height });
  assert.deepEqual(await replay.locator('#html-fallback').evaluate(fallbackGeometry), await page.locator('#html-fallback').evaluate(fallbackGeometry), 'Fallback HTML preserves source layout');

  const button = await replay.locator('#counter').boundingBox(); assert.ok(button);
  await viewer.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await page.waitForFunction(() => window.count === 1);
  await replay.getByText('Count 1', { exact: true }).waitFor();
  // Real trusted input traverses the same product Session as ordinary page clicks.
  // The source and projected slider must follow both directions without rollback.
  for (const [from, to] of [[0, 180], [180, 40]]) {
    const thumb = await replay.locator('#drag-thumb').boundingBox(); assert.ok(thumb);
    await page.evaluate(() => { window.dragPositions = []; });
    await viewer.mouse.move(thumb.x + 16, thumb.y + 24);
    await viewer.mouse.down();
    await viewer.mouse.move(thumb.x + 16 + to - from, thumb.y + 24, { steps: 28 });
    await page.waitForFunction(to => window.dragX === to, to);
    await viewer.mouse.up();
    await replay.locator('#drag-value').getByText(String(to), { exact: true }).waitFor();
    const positions = await page.evaluate(() => window.dragPositions);
    assert(positions.length > 0, 'Source receives real drag samples');
    for (let i = 1; i < positions.length; i++) assert((positions[i] - positions[i - 1]) * Math.sign(to - from) >= 0, 'Continuous drag never rolls back against pointer direction');
    assert(positions.every(value => value >= Math.min(from, to) && value <= Math.max(from, to)), 'Source drag stays within the actual pointer path');
  }

  await document.getByRole('button', { name: 'Bookmarks and history', exact: true }).click();
  await document.getByRole('button', { name: 'Bookmark this page', exact: true }).click();
  await document.locator('.browser-library-entries').getByText(sourceOrigin + '/', { exact: true }).waitFor();
  await document.getByRole('button', { name: 'Close library', exact: true }).click();
  const chooseProfile = async (surface, name) => {
    await surface.getByRole('button', { name: 'More browser actions', exact: true }).click();
    await surface.getByRole('menuitem', { name: 'Browser sources', exact: true }).click();
    await surface.getByRole('button', { name: 'Built-in browser', exact: true }).click();
    await surface.getByRole('radio', { name }).click();
    await surface.getByRole('button', { name: 'Open selection', exact: true }).click();
    await surface.getByRole('dialog').waitFor({ state: 'hidden' });
  };
  if (managedSource) {
    await document.getByRole('button', { name: 'More browser actions', exact: true }).click();
    await document.getByRole('menuitem', { name: 'Browser sources', exact: true }).click();
    await document.getByRole('button', { name: 'Built-in browser', exact: true }).click();
    await document.getByRole('button', { name: 'Create profile', exact: true }).click();
    await document.getByRole('textbox', { name: 'New profile name', exact: true }).fill('Inline selection');
    await document.getByRole('button', { name: 'Create profile', exact: true }).click();
    await document.getByRole('radio', { name: /Inline selection/ }).waitFor();
    await document.getByRole('button', { name: 'Open selection', exact: true }).click();
    await document.getByRole('dialog').waitFor({ state: 'hidden' });
    await document.getByRole('tab').waitFor();
    await inlineAddress.fill(sourceOrigin + '/inline-selected'); await inlineAddress.press('Enter');
    await replay.getByText('Count 0', { exact: true }).waitFor();
    assert.equal(page.url(), sourceOrigin + '/', 'Replacing the inline view never navigates the preceding profile');
    await chooseProfile(document, /Default profile/);
    await replay.getByText('Count 1', { exact: true }).waitFor();
  }
  let privateDescendant;
  if (extensionSource) {
    await viewer.evaluate(() => window.setBrowserFixturePrivate(true));
    const opened = page.waitForEvent('popup');
    await page.locator('#popup-link').click();
    const privatePopup = await opened; await privatePopup.waitForLoadState('domcontentloaded');
    const nested = privatePopup.waitForEvent('popup');
    await privatePopup.locator('#popup-link').click();
    privateDescendant = await nested; await privateDescendant.waitForLoadState('domcontentloaded');
    await privatePopup.close();
    const cdpTabs = await viewer.evaluate(endpoint => window.browserFixtureCDPTabs(endpoint), `http://localhost:${port}`);
    assert.equal(cdpTabs.some(tab => tab.title.includes('Popup') || tab.title === 'Shared source fixture'), false, 'CDP discovery cannot reveal the extension private root or descendants, including across a closed intermediate page');
  }
  const popupPromise = viewer.waitForEvent('popup');
  await viewer.locator('#open').click();
  const popup = await popupPromise;
  popup.on('pageerror', error => console.error('Popup error:', error.message));
  diagnosticPage = popup; popup.setDefaultTimeout(10000);
  const popupReplay = popup.frameLocator('iframe');
  await popup.getByRole('button', { name: 'More browser actions', exact: true }).click({ timeout: 2000 });
  await popup.getByRole('menuitem', { name: 'Browser sources', exact: true }).click();
  assert.equal(await popup.locator('.redeven-browser-document-bar').count(), 0, 'Product actions share the address row');
  await popup.getByRole('dialog').waitFor();
  await popup.getByRole('button', { name: 'Built-in browser', exact: true }).click();
  await popup.getByRole('button', { name: 'Create profile', exact: true }).click();
  await popup.getByRole('textbox', { name: 'New profile name', exact: true }).fill('Sandbox profile');
  await popup.getByRole('button', { name: 'Create profile', exact: true }).click();
  await popup.getByRole('radio', { name: /Sandbox profile/ }).waitFor();
  if (extensionSource) {
    await popup.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await popup.getByRole('button', { name: 'Personal browser', exact: true }).click();
    await popup.getByRole('radio', { name: /New background tab/ }).waitFor();
    assert.equal(await popup.getByRole('radio', { name: /Popup popup/ }).count(), 0, 'Private native descendants stay outside source selection after their direct opener closes');
    assert.equal(await popup.getByRole('radio', { name: /Shared source fixture/ }).count(), 0, 'The private root is absent from another window inventory');
  }
  if (managedSource) {
    await popup.getByRole('button', { name: 'Open selection', exact: true }).click();
    await popup.getByRole('dialog').waitFor({ state: 'hidden' });
    await popup.getByRole('tab').waitFor();
    const selectedAddress = popup.getByRole('combobox', { name: 'Website address' });
    await selectedAddress.fill(sourceOrigin + '/popup-selected'); await selectedAddress.press('Enter');
    await popupReplay.getByText('Count 0', { exact: true }).waitFor();
    await replay.getByText('Count 1', { exact: true }).waitFor();
    await chooseProfile(popup, /Default profile/);
    assert.equal(popup.isClosed(), false, 'Successful source replacement retains the independent window');
  } else await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  if (extensionSource) {
    await viewer.evaluate(() => window.setBrowserFixturePrivate(false));
    await privateDescendant.close();
  }
  await popupReplay.locator('#counter').waitFor({ state: 'visible' });
  popup.on('pageerror', error => console.error('popup:', error.message));
  popup.on('console', message => { if (message.type() === 'error') console.error('popup:', message.text()); });
  await popupReplay.locator('#picture').evaluate(image => image.decode());
  assert.equal(await popupReplay.locator('#picture').evaluate(image => image.naturalWidth), 44);
  await popup.getByRole('button', { name: 'Bookmarks and history', exact: true }).click();
  await popup.locator('.browser-library-entries').getByText(sourceOrigin + '/', { exact: true }).waitFor();
  await popup.getByRole('button', { name: 'History', exact: true }).click();
  await popup.locator('.browser-library-entries').getByText(sourceOrigin + '/', { exact: true }).waitFor();
  await popup.getByRole('button', { name: 'Close library', exact: true }).click();
  if (desktop) assert.deepEqual(await popup.evaluate(() => [typeof window.redevenDesktopShell, typeof window.require, typeof window.process]), ['undefined', 'undefined', 'undefined']);
  await viewer.evaluate(() => window.leaveBrowserPage());
  assert.equal(popup.isClosed(), false, 'leaving the inline browser does not close the environment-owned window');
  const takeControl = popup.getByRole('button', { name: 'Take control', exact: true });
  await takeControl.waitFor({ state: 'visible' });
  await takeControl.click();
  await takeControl.waitFor({ state: 'hidden' });
  await popup.waitForFunction(() => {
    const viewport = document.querySelector('.floe-viewport');
    const frame = viewport?.querySelector('iframe');
    return frame && Number(frame.width) === viewport.clientWidth;
  });
  const independentButton = await popupReplay.locator('#counter').boundingBox(); assert.ok(independentButton);
  await popup.mouse.click(independentButton.x + independentButton.width / 2, independentButton.y + independentButton.height / 2);
  await popupReplay.getByText('Count 2', { exact: true }).waitFor();
  assert.equal(await page.locator('#counter').textContent(), 'Count 2');
  const uploadPoint = await popupReplay.locator('#upload').boundingBox(); assert.ok(uploadPoint);
  await popup.mouse.click(uploadPoint.x + 15, uploadPoint.y + uploadPoint.height / 2);
  const chooser = popup.getByRole('dialog', { name: 'Choose files for this website' });
  await chooser.waitFor({ state: 'visible' });
  await chooser.locator('input[type=file]').setInputFiles({ name: 'browser-fixture.txt', mimeType: 'text/plain', buffer: fileContent });
  await popupReplay.locator('#uploaded').getByText(String(fileContent.length), { exact: true }).waitFor();
  assert.equal(await page.locator('#upload').evaluate(input => input.files[0].size), fileContent.length);
  await chooser.waitFor({ state: 'hidden' });
  for (const [index, [selector, filename]] of [['#download', 'browser-fixture.txt'], ['#binary-download', 'browser-binary.bin'], ['#blob-download', 'browser-blob.txt']].entries()) {
    const downloadPoint = await popupReplay.locator(selector).boundingBox(); assert.ok(downloadPoint);
    await popup.mouse.click(downloadPoint.x + downloadPoint.width / 2, downloadPoint.y + downloadPoint.height / 2);
    await popup.getByRole('button', { name: 'Downloads', exact: true }).click();
    const downloads = popup.getByRole('dialog', { name: 'Downloads', exact: true });
    const row = downloads.locator('.download-row').filter({ has: popup.getByRole('heading', { name: filename, exact: true }) });
    await row.waitFor();
    const saved = desktop ? client.evaluate(({ session }, destination) => new Promise((resolve, reject) => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(destination);
        item.once('done', (_event, state) => state === 'completed' ? resolve({ filename: item.getFilename(), path: destination }) : reject(new Error(`Native download ${state}`)));
      });
    }), path.join(directory, 'saved-' + filename)) : popup.waitForEvent('download').then(async item => ({ filename: item.suggestedFilename(), path: await item.path() }));
    await row.getByRole('button', { name: 'Save file', exact: true }).click();
    const file = await saved;
    assert.equal(file.filename, filename);
    assert.deepEqual(await readFile(file.path), selector === '#blob-download' ? Buffer.from('source Blob bytes') : fileContent);
    assert.equal(requestedDownloads, Math.min(index + 1, 2), 'saving consumes each original response once and Blob exports make no network request');
    await downloads.getByRole('button', { name: 'Close downloads' }).click();
  }
  const mediaPixels = color => popup.waitForFunction(color => {
    const replay = document.querySelector('.floe-viewport iframe')?.contentDocument;
    const scene = replay?.querySelector('#scene'), clip = replay?.querySelector('#clip');
    if (!scene?.complete || !scene.naturalWidth || !clip?.videoWidth || clip.readyState < 2) return false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    return [scene, clip].every(element => {
      context.drawImage(element, 0, 0, 1, 1);
      const rgba = context.getImageData(0, 0, 1, 1).data;
      return color === 'green' ? rgba[1] > 180 && rgba[0] < 80 && rgba[2] < 80 : rgba[2] > 180 && rgba[0] < 80 && rgba[1] < 80;
    });
  }, color, { timeout: 15000 });
  await mediaPixels('green');
  const afterFiles = await popupReplay.locator('#counter').boundingBox(); assert.ok(afterFiles);
  await popup.mouse.click(afterFiles.x + afterFiles.width / 2, afterFiles.y + afterFiles.height / 2);
  await popupReplay.getByText('Count 3', { exact: true }).waitFor();
  await mediaPixels('blue');
  assert.equal(await popup.evaluate(() => window.fixtureDirectRTC), 0);

  await popup.getByRole('button', { name: 'Page zoom', exact: true }).click();
  await popup.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.waitForFunction(() => Math.abs(window.devicePixelRatio - 1.1) < .001);
  await popup.getByRole('button', { name: 'Page zoom', exact: true }).click();
  const anotherOrigin = sourceOrigin.replace('127.0.0.1', 'localhost');
  await context.route(`${anotherOrigin}/**`, route => { forbiddenRequests.push(route.request().url()); return route.abort(); });
  const address = popup.getByRole('combobox', { name: 'Website address' });
  await address.fill(anotherOrigin + '/zoom-check'); await address.press('Enter');
  await page.waitForURL(anotherOrigin + '/zoom-check');
  await page.waitForFunction(() => window.devicePixelRatio === 1);
  await address.fill(sourceOrigin + '/zoom-restored'); await address.press('Enter');
  await page.waitForURL(sourceOrigin + '/zoom-restored');
  await page.waitForFunction(() => Math.abs(window.devicePixelRatio - 1.1) < .001);

  const createdPagePromise = source.waitForEvent('page');
  await popup.getByRole('button', { name: 'New tab', exact: true }).click({ timeout: 2000 });
  const createdPage = await createdPagePromise;
  await popup.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2, undefined, { timeout: 10000 });
  await popup.waitForFunction(() => document.querySelector('[role=combobox]').value === '', undefined, { timeout: 10000 });
  assert.equal(await popup.getByRole('tab').count(), 2, 'Only the selected source and the explicitly created page are granted');
  await popup.waitForFunction(() => !document.querySelector('.floe-viewport').parentElement.classList.contains('switching') && !document.querySelector('[role=combobox]').readOnly);
  await address.fill(sourceOrigin + '/created-tab'); await address.press('Enter');
  await createdPage.waitForURL(sourceOrigin + '/created-tab');
  await popup.waitForFunction(() => !document.querySelector('.floe-viewport').parentElement.classList.contains('switching'));
  await popupReplay.locator('#counter').waitFor({ state: 'visible' });
  await popup.getByRole('tab', { selected: true }).press('Control+w');
  await popup.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 1);
  await popupReplay.locator('#counter').waitFor({ state: 'visible' });
  await popup.getByRole('tab').click({ button: 'right' });
  assert.equal(await popup.getByRole('menuitem', { name: 'Reopen closed tab', exact: true }).isDisabled(), !managedSource, 'Only managed sources support recreating a closed tab from its saved URL');
  if (managedSource) {
    await popup.getByRole('menuitem', { name: 'Reopen closed tab', exact: true }).click();
    await popup.waitForFunction(url => document.querySelectorAll('[role=tab]').length === 2 && document.querySelector('[role=combobox]').value === url && !document.querySelector('.floe-viewport').parentElement.classList.contains('switching'), sourceOrigin + '/created-tab');
    await popupReplay.getByText('Count 0', { exact: true }).waitFor();
    await popup.getByRole('tab', { selected: true }).press('Control+w');
    await popup.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 1);
  } else await popup.keyboard.press('Escape');
  await popup.waitForFunction(() => !document.querySelector('[role=combobox]').readOnly && !document.querySelector('.floe-viewport').parentElement.classList.contains('switching'));
  const currentSourceWidth = await page.evaluate(() => window.innerWidth);
  await popup.waitForFunction(width => Number(document.querySelector('.floe-viewport iframe')?.width) === width, currentSourceWidth);

  if (managedSource) {
    const openerURL = await address.inputValue();
    // Chromium's middle-click disposition creates a context page without a
    // Playwright opener popup event. The managed directory must still admit it.
    const backgroundPopupPromise = source.waitForEvent('page', { timeout: 5000 });
    await popupReplay.locator('#popup-link').click({ button: 'middle' });
    const backgroundPopup = await backgroundPopupPromise;
    await backgroundPopup.waitForLoadState('domcontentloaded');
    await popup.getByRole('tab', { name: 'Popup popup', exact: true }).waitFor();
    assert.equal(await popup.getByRole('tab').count(), 2, 'Middle click admits the new managed tab');
    assert.equal(await popup.getByRole('tab', { name: 'Popup popup', exact: true }).getAttribute('aria-selected'), 'false', 'Middle click keeps its tab in the background');
    assert.equal(await address.inputValue(), openerURL, 'Middle click preserves the current page');
    await backgroundPopup.close();
    await popup.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 1);
  }

  // Native external popups remain ungranted until explicitly chosen in the
  // shared source dialog. A stale selection keeps the current view intact.
  const nativePopupPromise = page.waitForEvent('popup', { timeout: 5000 });
  await popupReplay.locator('#popup-link').click();
  const nativePopup = await nativePopupPromise;
  await nativePopup.waitForLoadState('domcontentloaded');
  if (managedSource) {
    await popup.getByRole('tab', { name: 'Popup popup', exact: true, selected: true }).waitFor();
    assert.equal(await popup.getByRole('tab').count(), 2, 'A managed popup joins its opened profile directory');
  } else {
  const findSources = async () => {
    await popup.getByRole('button', { name: 'More browser actions', exact: true }).click();
    await popup.getByRole('menuitem', { name: 'Browser sources', exact: true }).click();
    const dialog = popup.getByRole('dialog');
    await dialog.waitFor();
    if (!extensionSource) {
      await dialog.getByText('Discover a self-managed Chromium browser', { exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Browser debugging endpoint', exact: true }).fill(`http://127.0.0.1:${port}`);
      await dialog.getByRole('button', { name: 'Find tabs', exact: true }).click();
    } else await dialog.getByRole('button', { name: 'Personal browser', exact: true }).click();
    return dialog;
  };
  let sourceDialog = await findSources();
  await sourceDialog.getByRole('radio', { name: `Popup popup ${sourceOrigin}/popup`, exact: true }).check();
  assert.equal(await popup.getByRole('tab').count(), 1, 'A discovered popup is not an observation grant');
  await nativePopup.goto(sourceOrigin + '/popup-changed');
  await sourceDialog.getByRole('button', { name: 'Open selection', exact: true }).click();
  await sourceDialog.getByRole('alert').waitFor();
  assert.equal(await popup.getByRole('tab').count(), 1, 'Failed replacement preserves the current directory');
  await sourceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await popupReplay.locator('#counter').waitFor({ state: 'visible' });
  sourceDialog = await findSources();
  await sourceDialog.getByRole('radio', { name: `Popup popup-changed ${sourceOrigin}/popup-changed`, exact: true }).check();
  const previousDocumentURL = popup.url();
  await sourceDialog.getByRole('button', { name: 'Open selection', exact: true }).click();
  await popup.waitForURL(url => url.href !== previousDocumentURL);
  await popup.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2);
  await popup.getByRole('tab', { name: 'Popup popup-changed', exact: true }).waitFor();
  }
  await popup.waitForFunction(url => { const address = document.querySelector('[role=combobox]'); return !address.readOnly && address.value === url && !document.querySelector('.floe-viewport').parentElement.classList.contains('switching'); }, nativePopup.url());
  await popupReplay.locator('#counter').click();
  await nativePopup.getByText('Count 1', { exact: true }).waitFor();

  if (process.env.REDEVEN_BROWSER_SOAK_SECONDS) await runBrowserProjectionSoak({ popup, sourcePages: [page, nativePopup], sourceOrigin, runtimePID: configuration.runtimePID,
    seconds: Number(process.env.REDEVEN_BROWSER_SOAK_SECONDS), evidence: process.env.REDEVEN_BROWSER_SOAK_EVIDENCE });
  if (process.env.REDEVEN_BROWSER_PERFORMANCE_EVIDENCE) await runBrowserProjectionPerformance({ popup, sourcePages: [page, nativePopup], evidence: process.env.REDEVEN_BROWSER_PERFORMANCE_EVIDENCE });
  if (process.env.REDEVEN_BROWSER_SITES_EVIDENCE) await runBrowserProjectionSites({ popup, source: nativePopup, evidence: process.env.REDEVEN_BROWSER_SITES_EVIDENCE });
  if (process.env.REDEVEN_BROWSER_SYNC_EVIDENCE) await runBrowserProjectionMediaSync({ popup, source: nativePopup, evidence: process.env.REDEVEN_BROWSER_SYNC_EVIDENCE });
  if (process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE) await popup.screenshot({ path: process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE.replace(/\.json$/u, '.png') });
  await popup.close();
  assert.equal(page.isClosed(), false, 'closing an observation does not close its source page');
  assert.deepEqual(forbiddenRequests, [], 'projection never requests the source website directly');
  assert.deepEqual(directProxyRequests, [], 'all Runtime HTTP and resource requests use Flowersec');
  await viewer.evaluate(() => window.closeBrowserFixture());
  process.stdout.write(`PASS (${clientName}): environment-owned window survives page changes; one Session carries DOM, input, CSS, images, files, shared bookmarks/history, restored origin zoom and decoded Canvas/video; replay has no source scripts or Desktop bridge\n`);
  }
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    if (process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE) await diagnosticPage.screenshot({ path: process.env.REDEVEN_BROWSER_DEBUG_EVIDENCE.replace(/\.json$/u, '-failure.png') }).catch(() => {});
    console.error('Browser fixture chrome:', await diagnosticPage.locator('.floe-browser').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally { await cleanup(); }
