// Drive the opt-in TestInstalledClientInputViewer fixture through the production
// viewer assets and prepared Xpra page. Browser composition events are simulated;
// this verifies transport and application delivery, not a real system IME.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { createServer as tcpServer, connect } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repository, 'internal/envapp/ui_src/package.json'));
const browserName = process.env.REDEVEN_INPUT_BROWSER || 'chromium';
assert(['chromium','firefox','webkit'].includes(browserName), 'unsupported qualification browser');
const browserType = require('playwright')[browserName];
const [host, remoteRoot, output] = process.argv.slice(2);
assert(host && remoteRoot?.startsWith('/tmp/') && output, 'provide SSH host, task-owned /tmp fixture directory and local evidence directory');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const remote = command => execFileSync('ssh', ['-x', host, command], {encoding:'utf8'});
const metadata = JSON.parse(remote(`cat ${quote(remoteRoot + '/connection.json')}`));
const remotePort = Number(metadata.address.split(':')[1]);
assert(remotePort > 0 && metadata.address.startsWith('127.0.0.1:'));
await mkdir(output, {recursive:true});
const reservation = tcpServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const tunnelPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const tunnel = spawn('ssh', ['-x', '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${tunnelPort}:127.0.0.1:${remotePort}`, host], {stdio:'ignore'});
const waitFor = async (check, description, timeout = 15000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(description);
};
let browser;
let page;
const source = path.join(repository, 'internal/codeapp/appserver/host_application_viewer');
const asset = name => readFile(path.join(source, name), 'utf8');
const catalogSource = await asset('catalog.generated.js');
const catalog = JSON.parse(catalogSource.slice(catalogSource.indexOf(' = ') + 3).trim().slice(0, -1));
const css = (await Promise.all(['appearance.generated.css', 'remote-input.generated.css', 'remote-pointer.generated.css', 'viewer.css'].map(asset))).join('\n');
const js = (await Promise.all(['catalog.generated.js', 'remote-input.generated.js', 'remote-pointer.generated.js', 'appearance.js', 'connection.js', 'toolbar.js', 'viewer.js'].map(asset))).join('\n');
const html = (await asset('viewer.html')).replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Theme}}', 'porcelain-light')
  .replaceAll('{{.Name}}', 'Client input acceptance').replaceAll('{{.Nonce}}', 'fixture')
  .replace('{{.Style}}', css).replace('{{.Config}}', JSON.stringify({base:'/fixture',icon:'',copy:catalog.locales['en-US']})).replace('{{.Script}}', js);
const server = createServer((req, res) => {
  if (req.url === '/fixture/_redeven_host_app/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (req.url?.endsWith('/state')) {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({state:'running', password:metadata.password})); return;
  }
  const upstream = request({hostname:'127.0.0.1',port:tunnelPort,path:req.url.replace(/^\/fixture/, ''),method:req.method,headers:{...req.headers,host:`127.0.0.1:${tunnelPort}`}}, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => {res.writeHead(502); res.end();}); req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = request({hostname:'127.0.0.1',port:tunnelPort,path:req.url.replace(/^\/fixture/, '') || '/',headers:{...req.headers,host:`127.0.0.1:${tunnelPort}`}});
  upstream.on('upgrade', (res, stream, rest) => {
    socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n${res.rawHeaders.reduce((s,v,i,a)=>i%2?s:s+a[i]+': '+a[i+1]+'\r\n','')}\r\n`);
    if (rest.length) socket.write(rest); if (head.length) stream.write(head);
    socket.on('error', () => stream.destroy()); stream.on('error', () => socket.destroy()); socket.pipe(stream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
try {
  await waitFor(() => new Promise(resolve => {const socket=connect(tunnelPort,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));}), 'SSH tunnel did not open');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  browser = await browserType.launch({headless:true, executablePath:process.env.REDEVEN_INPUT_BROWSER_EXECUTABLE || undefined});
  page = await browser.newPage({viewport:{width:900,height:640}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/fixture/_redeven_host_app/`);
  await page.waitForFunction(() => document.body.dataset.state === 'active', undefined, {timeout:30000});
  const frame = page.frames().find(item => item.url().includes('/fixture/index.html'));
  assert(frame, 'prepared Xpra frame is missing');
  await frame.evaluate(() => {
    const adapter = window.floeXpraInput.getClient().floeInput;
    const previous = adapter.onError;
    adapter.onError = code => { window.parent.fixtureInputError = code; previous?.(code); };
  });
  await page.mouse.click(300, 170);
  await frame.waitForFunction(() => {
    const cursor = window.floeXpraInput.getClient().floeCursor;
    return cursor?.source?.width === 48 && cursor.current?.width === 24;
  });
  const cursor = await frame.evaluate(async () => {
    const client = window.floeXpraInput.getClient(), owner = client.floeCursor;
    const {width,height,xhot,yhot,url,css} = owner.current;
    const image = new Image(); image.src=url; await image.decode();
    return {source:[owner.source.width,owner.source.height,owner.source.xhot,owner.source.yhot],
      logical:[width,height,xhot,yhot], backing:[image.naturalWidth,image.naturalHeight],
      dpr:devicePixelRatio, css, sent:client.last_button_event.slice(2)};
  });
  assert.deepEqual(cursor.source, [48,48,22,24]);
  assert.deepEqual(cursor.logical, [24,24,11,12]);
  const pointer = () => JSON.parse(remote(`cat ${quote(remoteRoot + '/pointer.json')}`));
  await waitFor(() => JSON.stringify(pointer()) === JSON.stringify(cursor.sent), 'Application click coordinates differ from the cursor hotspot');
  cursor.received = pointer();
  await frame.waitForFunction(() => document.activeElement === document.querySelector('.floe-remote-input'));
  await page.screenshot({path:path.join(output,'before-input.png')});
  const input = frame.locator('.floe-remote-input');
  const compose = text => input.evaluate((element, text) => {
    element.dispatchEvent(new CompositionEvent('compositionstart'));
    element.value=text;
    element.dispatchEvent(new InputEvent('input',{inputType:'insertCompositionText',data:text,isComposing:true}));
    element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true}));
    element.dispatchEvent(new CompositionEvent('compositionend',{data:text}));
    element.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:text}));
    element.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter'}));
  }, text);
  const receipt = () => JSON.parse(remote(`cat ${quote(remoteRoot + '/receipt.json')}`));
  const unicode = '中文日本語한글🙂👩🏽‍💻e\u0301𠮷';
  await compose(unicode); await compose(unicode);
  await waitFor(() => receipt()[0] === unicode + unicode, 'Repeated Unicode commit was not received exactly');
  await page.keyboard.type('abc');
  await page.keyboard.press('Backspace');
  await waitFor(() => receipt()[0] === unicode + unicode + 'ab', 'Physical typing or deletion failed');
  await page.mouse.click(300, 480);
  await compose('第二个输入框');
  await waitFor(() => receipt()[1] === '第二个输入框', 'Pointer focus did not bind the second field');
  await page.locator('.mac-app-controls-toggle').click();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(receipt(), [unicode + unicode + 'ab', '第二个输入框']);
  await page.mouse.click(300, 480);
  await page.screenshot({path:path.join(output,'viewer.png')});
  const expected = receipt();
  assert.deepEqual(errors, []);
  remote(`printf %s ${quote(JSON.stringify(expected))} > ${quote(remoteRoot + '/done.json')}`);
  const identity = {...metadata}; delete identity.password;
  await writeFile(path.join(output,'result.json'), JSON.stringify({passed:true,...identity,port,browserName,browser:browser.version(),expected,cursor,checks:['actual remote PNG normalization','application click coordinates','exact repeated Unicode','physical typing','Backspace','pointer field switch','toolbar isolation'],actualOSCursor:false,systemIME:false},null,2));
  console.log('PASS: published controller → prepared Xpra → actual application text receipt');
} catch (error) {
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(() => {});
  await writeFile(path.join(output,'failure.json'), JSON.stringify({message:error.message,
    inputError:await page?.evaluate(() => window.fixtureInputError),
    received:JSON.parse(remote(`cat ${quote(remoteRoot + '/receipt.json')}`))},null,2));
  // An invalid completion receipt fails the host fixture and runs its cleanup.
  remote(`printf %s ${quote(JSON.stringify({error:error.message}))} > ${quote(remoteRoot + '/done.json')}`);
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  tunnel.kill('SIGTERM');
}
