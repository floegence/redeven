// Drive the opt-in TestInstalledClientInputViewer fixture through the production
// viewer assets and prepared Xpra page. Browser composition events are simulated;
// this verifies transport and application delivery, not a real system IME.
import assert from 'node:assert/strict';
import {installStreamMetrics,checkNativeDesktopStream} from './host_application_stream_acceptance.mjs';
import {checkNativeDesktopInput} from './host_application_native_acceptance.mjs';
import {checkPointer} from './host_application_pointer_acceptance.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { createServer as tcpServer, connect } from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repository, 'internal/envapp/ui_src/package.json'));
const browserName = process.env.REDEVEN_INPUT_BROWSER || 'chromium';
assert(['chromium','firefox','webkit','electron'].includes(browserName), 'unsupported qualification browser');
const playwright = require('playwright');
const browserType = playwright[browserName];
const [host, remoteRoot, output] = process.argv.slice(2);
assert(host && remoteRoot?.startsWith('/tmp/') && output, 'provide SSH host, task-owned /tmp fixture directory and local evidence directory');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const sshOptions = process.env.REDEVEN_TEST_SSH_CONFIG ? ['-F', process.env.REDEVEN_TEST_SSH_CONFIG] : [];
const remote = command => host==='local' ? execFileSync('/bin/sh',['-c',command],{encoding:'utf8'}) : execFileSync('ssh', [...sshOptions, '-x', host, command], {encoding:'utf8'});
const metadata = JSON.parse(remote(`cat ${quote(remoteRoot + '/connection.json')}`));
const pointerMode=metadata.kind?.startsWith('pointer-');
if(pointerMode)assert.equal(browserName,'chromium','native browser touch driver requires Chromium');
const remotePort = Number(metadata.address.split(':')[1]);
assert(remotePort > 0 && metadata.address.startsWith('127.0.0.1:'));
await mkdir(output, {recursive:true});
const reservation = tcpServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const tunnelPort = host==='local' ? remotePort : reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const tunnel = host==='local' ? null : spawn('ssh', [...sshOptions, '-x', '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${tunnelPort}:127.0.0.1:${remotePort}`, host], {stdio:'ignore'});
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
let electronChild;
let electronDirectory;
let browserVersion;
let frame;
const errors = [];
const protocolErrors = [];
const sockets = new Set();
const source = path.join(repository, 'internal/codeapp/appserver/host_application_viewer');
const asset = name => readFile(path.join(source, name), 'utf8');
const catalogSource = await asset('catalog.generated.js');
const catalog = JSON.parse(catalogSource.slice(catalogSource.indexOf(' = ') + 3).trim().slice(0, -1));
const css = (await Promise.all(['appearance.generated.css', 'remote-input.generated.css', 'remote-pointer.generated.css', 'viewer.css'].map(asset))).join('\n');
const js = (await Promise.all(['catalog.generated.js', 'viewport.generated.js', 'remote-input.generated.js', 'remote-pointer.generated.js', 'appearance.js', 'connection.js', 'toolbar.js','canvas.js', metadata.backend==='wayland' ? 'linux.js' : metadata.backend==='macos' ? 'macos.js' : 'viewer.js'].map(asset))).join('\n');
// Use a real PNG fixture so loading also exercises exclusive icon presentation.
const icon = metadata.kind?.startsWith('stream-') ? 'data:image/png;base64,' + (await readFile(path.join(repository,'assets/brand/redeven/png/app-icon-128.png'))).toString('base64') : '';
const html = (await asset('viewer.html')).replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Theme}}', 'porcelain-light')
  .replaceAll('{{.Name}}', 'Client input acceptance').replaceAll('{{.Nonce}}', 'fixture')
  .replace('<script nonce=', (metadata.backend==='wayland' ? '<script src="/fixture/cursor.js"></script>' : '') + '<script nonce=').replace('{{.Style}}', css).replace('{{.Config}}', JSON.stringify({base:'/fixture',backend:metadata.backend,icon,copy:catalog.locales['en-US']})).replace('{{.Script}}', js);
const server = createServer((req, res) => {
  if (req.url === '/popup') {
    res.setHeader('Content-Type', 'text/html');res.end('<button onclick="window.open(\'/fixture/_redeven_host_app/\')">Open fixture</button>');return;
  }
  if (req.url === '/fixture/_redeven_host_app/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  const upstream = request({hostname:'127.0.0.1',port:tunnelPort,path:req.url.replace(/^\/fixture/, ''),method:req.method,headers:{...req.headers,host:`127.0.0.1:${tunnelPort}`}}, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => {res.writeHead(502); res.end();}); req.pipe(upstream);
});
server.on('connection', socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
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
  if (browserName === 'electron') {
    const desktop = path.join(repository, 'desktop');
    execFileSync(path.join(repository, 'scripts/check_desktop_electron_test_runtime.sh'), [desktop], {stdio:'inherit'});
    const desktopRequire = createRequire(path.join(desktop, 'package.json'));
    electronDirectory = await mkdtemp(path.join(tmpdir(), 'redeven-input-electron-'));
    const entry = path.join(electronDirectory, 'fixture.cjs');
    const reservation = tcpServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const cdp = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>{const w=new BrowserWindow({width:900,height:640,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());process.on('SIGTERM',()=>app.quit());`);
    const marker = randomUUID();
    electronChild = spawn(desktopRequire('electron'), [entry, `--user-data-dir=${electronDirectory}/profile`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdp}`, `--redeven-input-run=${marker}`], {
      cwd:electronDirectory, detached:process.platform !== 'win32', stdio:'ignore', env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},
    });
    await writeFile(path.join(output,'electron-process.json'), JSON.stringify({pid:electronChild.pid,state:electronDirectory,marker,cdp}));
    await waitFor(async()=>{
      if(electronChild.exitCode !== null || electronChild.signalCode !== null) throw new Error(`Owned Electron exited: ${electronChild.exitCode ?? electronChild.signalCode}`);
      return fetch(`http://127.0.0.1:${cdp}/json/version`).then(r=>r.ok).catch(()=>false);
    },'Electron CDP did not start');
    browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
    await waitFor(()=>browser.contexts()[0]?.pages().length,'Electron window did not open');
    page = browser.contexts()[0].pages()[0];
    browserVersion = desktopRequire('electron/package.json').version;
  } else {
    browser = await browserType.launch({headless:true, executablePath:process.env.REDEVEN_INPUT_BROWSER_EXECUTABLE || undefined,
      ...(browserName==='chromium'?{chromiumSandbox:true}:{})});
    page = await browser.newPage({viewport:{width:900,height:640},deviceScaleFactor:2,hasTouch:pointerMode});
    if(browserName==='chromium')await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    browserVersion = browser.version();
  }
  if(metadata.kind?.startsWith('stream-'))await installStreamMetrics(page);
  if(pointerMode)await page.addInitScript(()=>{
    window.pointerPackets=[];window.nativeStates=[];
    const Socket=window.WebSocket;
    window.WebSocket=class extends Socket {
      constructor(...args){
        super(...args);
        this.addEventListener('message',event=>{
          if(typeof event.data==='string'){
            const value=JSON.parse(event.data);
            if(['window','windows','error','operation_error','waiting'].includes(value.type))window.nativeStates.push(value);
            if(['attached','state','capture_unavailable'].includes(value.event))window.nativeStates.push(value);
          }
        });
      }
      send(data){
        if(typeof data==='string'){
          const value=JSON.parse(data);
          if(value.action==='input'&&['move','down','up','scroll'].includes(value.kind))window.pointerPackets.push(value);
          if(value.method==='input'&&['move','button','scroll'].includes(value.operation?.kind))window.pointerPackets.push(value);
        }
        super.send(data);
      }
    };
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureClipboardErrors=[];window.fixtureClipboardWrites=0;window.fixturePastedText=null;
    document.addEventListener('paste',event=>{window.fixturePastedText=event.clipboardData?.getData('text/plain');},true);
    if (navigator.clipboard?.writeText) {
      const write=navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText=text=>write(text).then(()=>{window.fixtureClipboardWrites++;}).catch(error=>{window.fixtureClipboardErrors.push(error.name);throw error;});
    }
    if (navigator.clipboard?.write) {
      const write=navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write=items=>write(items).then(()=>{window.fixtureClipboardWrites++;}).catch(error=>{window.fixtureClipboardErrors.push(error.name);throw error;});
    }
  });
  page.on('websocket', socket => socket.on('framereceived', ({payload}) => {
    if (typeof payload !== 'string') return;
    try { const event=JSON.parse(payload); if (event.error) protocolErrors.push({id:event.id,error:event.error}); } catch {}
  }));
  const lifecycleEvents=[];
  if(metadata.kind==='window-lifecycle') {
    assert.notEqual(browserName,'electron','this receipt checks browser popup closure');
    await page.context().exposeBinding('recordLifecycle',(_source,event)=>lifecycleEvents.push(event));
    await page.context().addInitScript(()=>{
      if(window.close.lifecycleInstrumented)return;
      const close=window.close.bind(window);
      window.close=()=>{void window.recordLifecycle({type:'close_call',stack:new Error().stack});close();};
      window.close.lifecycleInstrumented=true;
    });
    await page.goto(`http://127.0.0.1:${port}/popup`);
    [page]=await Promise.all([page.context().waitForEvent('page'),page.locator('button').click()]);
    page.on('close',()=>lifecycleEvents.push({type:'page_closed'}));
    page.on('pageerror',error=>errors.push(error.message));
    page.on('websocket',socket=>socket.on('framereceived',({payload})=>{
      if(typeof payload!=='string')return;
      const event=JSON.parse(payload);
      if(['attached','state'].includes(event.event))lifecycleEvents.push(event);
    }));
  }else await page.goto(`http://127.0.0.1:${port}/fixture/_redeven_host_app/`);
  await page.waitForFunction(() => document.body.dataset.state === 'active', undefined, {timeout:30000});
  frame = page.frames().find(item => item.url().includes('/fixture/index.html'));
  if(metadata.backend!=='macos'&&metadata.backend!=='wayland')assert(frame, 'prepared Xpra frame is missing');
  const receipt = () => JSON.parse(remote(`cat ${quote(metadata.receipt || remoteRoot + '/receipt.json')}`));
  if(metadata.kind==='window-lifecycle') {
    await page.screenshot({path:path.join(output,'before-close.png')});
    await Promise.all([page.waitForEvent('close'),page.locator('.mac-app-close').click()]);
    const receipt=JSON.parse(remote(`cat ${quote(remoteRoot+'/window-closed.json')}`));
    await writeFile(path.join(output,'lifecycle-events.json'),JSON.stringify(lifecycleEvents,null,2));
    assert.equal(receipt.closed,true);remote(`kill -0 ${Number(receipt.pid)}`);
    assert.equal(lifecycleEvents.filter(event=>event.type==='close_call').length,1);
    assert(lifecycleEvents.some(event=>event.type==='close_call'&&event.stack.includes('dismissEnded')));
    assert.deepEqual(errors,[]);
    const identity={...metadata};delete identity.password;
    await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,...identity,browserName,browser:browserVersion,receipt,events:lifecycleEvents},null,2));
    remote(`printf %s '{"passed":true}' > ${quote(remoteRoot+'/done.json')}`);
    console.log('PASS: actual final window destruction closes browser popup and retains native application');
  } else if(metadata.kind?.startsWith('stream-')) {
    const result=await checkNativeDesktopStream({page,output,transport:host==='local'?'Host loopback HTTP':'LAN over the task SSH tunnel'});
    assert.deepEqual(protocolErrors,[],'native protocol rejected stream acceptance');assert.deepEqual(errors,[]);
    const identity={...metadata};delete identity.password;
    await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,...identity,browserName,browser:browserVersion,...result},null,2));
    remote(`printf %s '{"passed":true}' > ${quote(remoteRoot+'/done.json')}`);
    console.log('PASS: production native viewer picture modes, presentation latency and stream budgets');
  } else if(metadata.backend==='wayland'&&!pointerMode) {
    const result=await checkNativeDesktopInput({page,read:receipt,waitFor,output,metadata,remote,quote,remoteRoot});
    await writeFile(path.join(output,'protocol-errors.json'),JSON.stringify(protocolErrors,null,2));
    await writeFile(path.join(output,'clipboard-errors.json'),JSON.stringify(await page.evaluate(()=>window.fixtureClipboardErrors),null,2));
    assert.deepEqual(protocolErrors,[],'native protocol rejected a browser operation');
    assert(await page.locator('.mac-app-feedback').isHidden(),'native viewer displayed an unexpected error');
    assert.deepEqual(errors,[]);
    const identity={...metadata};delete identity.password;
    await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,...identity,browserName,browser:browserVersion,...result,systemIME:false},null,2));
    remote(`printf %s ${quote(JSON.stringify(result.received))} > ${quote(remoteRoot + '/done.json')}`);
    console.log('PASS: production native viewer and transport -> actual application input receipts');
  } else if(metadata.retained){
    assert.deepEqual(receipt(),metadata.retained,'Runtime upgrade lost unsaved text before viewer attach');
    const capabilities=await frame.evaluate(()=>floeXpraViewer.capabilities(floeXpraViewer.getClient()));
    assert.deepEqual(capabilities,{display:'logical',input:'ready',pointer:'ready'});
    await page.mouse.click(300,170);
    await page.keyboard.press('End');
    const suffix=' upgraded 中文🙂';
    await frame.locator('.floe-remote-input').evaluate((element,text)=>{
      element.dispatchEvent(new CompositionEvent('compositionstart'));element.value=text;
      element.dispatchEvent(new InputEvent('input',{inputType:'insertCompositionText',data:text,isComposing:true}));
      element.dispatchEvent(new CompositionEvent('compositionend',{data:text}));
      element.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:text}));
    },suffix);
    const expected=[metadata.retained[0]+suffix,metadata.retained[1]];
    await waitFor(()=>JSON.stringify(receipt())===JSON.stringify(expected),'Retained application input failed after Runtime upgrade');
    await page.screenshot({path:path.join(output,'retained-application.png')});
    assert.deepEqual(errors,[]);
    const identity={...metadata};delete identity.password;
    await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,...identity,capabilities,received:expected},null,2));
    remote(`printf %s ${quote(JSON.stringify(expected))} > ${quote(remoteRoot + '/done.json')}`);
    console.log('PASS: previous Runtime → current viewer → same backend and unsaved application contents');
  } else if(pointerMode){
    if(frame)await frame.evaluate(()=>{
      const client=window.floeXpraViewer.getClient(),send=client.send;
      client.send=function(packet){
        if(['pointer-position','button-action','wheel-motion'].includes(packet[0]))parent.pointerPackets.push(packet);
        return send.call(this,packet);
      };
    });
    const checks=await checkPointer({page,frame,read:receipt,output,waitFor,backend:metadata.backend});
    assert.deepEqual(errors,[]);
    remote(`printf %s ${quote(JSON.stringify({passed:true}))} > ${quote(remoteRoot + '/done.json')}`);
    const identity={...metadata};delete identity.password;
    await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,...identity,browser:browser.version(),checks,physicalMobile:false},null,2));
    console.log('PASS: production viewer → published pointer → actual application receipts');
  } else {
  const editorMode = metadata.kind === 'gnome';
  const gtk4Mode = metadata.kind?.startsWith('gtk4');
  const shortcut = process.platform === 'darwin' ? 'Meta' : 'Control';
  const readDocument = () => remote(`cat ${quote(remoteRoot + '/document.txt')}`);
  const saveDocument = async expected => {
    await page.keyboard.press(`${shortcut}+s`);
    await waitFor(() => readDocument() === expected, 'Editor did not save the exact UTF-8 bytes');
  };
  await frame.evaluate(() => {
    const adapter = window.floeXpraViewer.getClient().floeInput;
    const previous = adapter.onError;
    adapter.onError = code => { window.parent.fixtureInputError = code; previous?.(code); };
  });
  // Exercise the production quality controls against the actual toolkit before
  // validating input coordinates and contents on the final logical surface.
  await frame.evaluate(() => {
    const client=window.floeXpraViewer.getClient(),send=client.send;
    window.layoutCommands=[];
    client.send=function(packet){
      if(['configure-display','configure-window','quality','speed'].includes(packet[0]))window.layoutCommands.push(packet);
      return send.call(this,packet);
    };
  });
  const layouts=[];
  const settle=async()=>{
    let previous='',unchanged=0,record;
    await waitFor(async()=>{
      await page.waitForTimeout(100);
      record=await frame.evaluate(()=>{
        const c=window.floeXpraViewer.getClient();
        return {commands:window.layoutCommands.length,scale:c.scale,viewport:[c.desktop_width,c.desktop_height],
          windows:Object.values(c.id_to_window).map(w=>[w.wid,w.x,w.y,w.w,w.h])};
      });
      const key=JSON.stringify(record);unchanged=key===previous?unchanged+1:0;previous=key;
      return unchanged>=8;
    },'Quality change did not settle');
    return record;
  };
  await page.locator('.mac-app-controls-toggle').click();
  for(const mode of ['auto','clarity','smooth','data','clarity','auto']){
    await page.locator(`[data-picture-mode="${mode}"]`).click();
    const accepted=await settle();
    await page.locator(`[data-picture-mode="${mode}"]`).click();
    assert.deepEqual(await settle(),accepted,'Repeated quality selection changed layout or sent commands');
    layouts.push({mode,...accepted});
  }
  await page.evaluate(()=>{for(const mode of ['clarity','smooth','data','clarity','auto'])document.querySelector(`[data-picture-mode="${mode}"]`).click()});
  layouts.push({mode:'rapid-final-auto',...await settle()});
  await page.locator('.mac-app-controls-toggle').click();
  await page.screenshot({path:path.join(output,'after-quality.png')});
  await writeFile(path.join(output,'quality-layouts.json'),JSON.stringify(layouts,null,2));
  await page.mouse.click(300, 170);
  await page.keyboard.type('abc');
  if (editorMode) await saveDocument('abc\n');
  else await waitFor(() => receipt()[0] === 'abc', 'Click followed by physical typing did not reach the application');
  let cursor = null;
  if (!editorMode && !gtk4Mode) {
  // Native text controls may hide their cursor while typing. Restore hover
  // before checking its shape; the preceding click-to-key test stays intact.
  await page.mouse.move(301, 170);
  await frame.waitForFunction(() => {
    const cursor = window.floeXpraViewer.getClient().floeCursor;
    return cursor?.source?.width === 48 && cursor.current?.width === 24;
  });
  cursor = await frame.evaluate(async () => {
    const client = window.floeXpraViewer.getClient(), owner = client.floeCursor;
    const {width,height,xhot,yhot,url,css} = owner.current;
    const image = new Image(); image.src=url; await image.decode();
    return {source:[owner.source.width,owner.source.height,owner.source.xhot,owner.source.yhot],
      logical:[width,height,xhot,yhot], backing:[image.naturalWidth,image.naturalHeight],
      dpr:devicePixelRatio, css, sent:(()=>{const rect=window.frameElement.getBoundingClientRect();const mouse=client.getMouse({clientX:300-rect.left,clientY:170-rect.top});return [Math.round(mouse.x),Math.round(mouse.y)];})()};
  });
  assert.deepEqual(cursor.source, [48,48,22,24]);
  assert.deepEqual(cursor.logical, [24,24,11,12]);
    const pointer = () => JSON.parse(remote(`cat ${quote(remoteRoot + '/pointer.json')}`));
    await waitFor(() => JSON.stringify(pointer()) === JSON.stringify(cursor.sent), 'Application click coordinates differ from the cursor hotspot');
    cursor.received = pointer();
  }
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
  const unicode = '中文日本語한글🙂👩🏽‍💻e\u0301𠮷';
  await compose(unicode); await compose(unicode);
  if (editorMode) await saveDocument('abc' + unicode + unicode + '\n');
  else await waitFor(() => receipt()[0] === 'abc' + unicode + unicode, 'Repeated Unicode commit was not received exactly');
  await page.keyboard.type('abc');
  await page.keyboard.press('Backspace');
  if (editorMode) {
    await saveDocument('abc' + unicode + unicode + 'ab\n');
    await page.keyboard.press(`${shortcut}+a`);
    await compose(unicode + '\nsecond line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('last');
    const expected = unicode + '\nsecond line\nlast\n';
    await saveDocument(expected);
    await page.locator('.mac-app-controls-toggle').click();
    await page.keyboard.press('ArrowRight');
    assert.equal(readDocument(), expected);
    await page.screenshot({path:path.join(output,'viewer.png')});
    assert.deepEqual(errors, []);
    remote(`printf %s ${quote(JSON.stringify({document:expected}))} > ${quote(remoteRoot + '/done.json')}`);
    const identity = {...metadata}; delete identity.password;
    await writeFile(path.join(output,'result.json'), JSON.stringify({passed:true,...identity,port,browserName,browser:browserVersion,expected,
      checks:['click then physical typing','exact repeated Unicode','Backspace','selection replacement','multiline commit then Enter','native application save','exact saved UTF-8 bytes','toolbar isolation'],systemIME:false},null,2));
  } else {
  await waitFor(() => receipt()[0] === 'abc' + unicode + unicode + 'ab', 'Physical typing or deletion failed');
  await page.mouse.click(300, 480);
  await compose('第二个输入框');
  await waitFor(() => receipt()[1] === '第二个输入框', 'Pointer focus did not bind the second field');
  await page.locator('.mac-app-controls-toggle').click();
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(receipt(), ['abc' + unicode + unicode + 'ab', '第二个输入框']);
  await page.mouse.click(300, 480);
  await page.screenshot({path:path.join(output,'viewer.png')});
  const expected = receipt();
  assert.deepEqual(errors, []);
  remote(`printf %s ${quote(JSON.stringify(expected))} > ${quote(remoteRoot + '/done.json')}`);
  const identity = {...metadata}; delete identity.password;
  await writeFile(path.join(output,'result.json'), JSON.stringify({passed:true,...identity,port,browserName,browser:browserVersion,expected,cursor,checks:[...(!gtk4Mode?['actual remote PNG normalization','application click coordinates']:[]),'click then physical typing','exact repeated Unicode','Backspace','pointer field switch','toolbar isolation'],actualOSCursor:false,systemIME:false},null,2));
  }
  console.log('PASS: published controller → prepared Xpra → actual application text receipt');
  }
} catch (error) {
  await page?.screenshot({path:path.join(output,'failure.png')}).catch(() => {});
  let received=null;
  try { received=['gnome','package-editor'].includes(metadata.kind) ? remote(`cat ${quote(metadata.document || remoteRoot + '/document.txt')}`) : JSON.parse(remote(`cat ${quote(metadata.receipt || remoteRoot + '/receipt.json')}`)); } catch { /* Startup may fail before the application writes a receipt. */ }
  await writeFile(path.join(output,'failure.json'), JSON.stringify({message:error.message,errors,protocolErrors,
    client:await frame?.evaluate(()=>{const c=window.floeXpraViewer?.getClient();return c?{capabilities:floeXpraViewer.capabilities(c),focused:c.focused_wid,active:document.activeElement?.tagName,inputTarget:c.floeInput.target,windows:Object.values(c.id_to_window).map(w=>({wid:w.wid,geometry:[w.x,w.y,w.w,w.h],pointerReady:!!c.floePointer.targetForWindow(w)}))}:null}).catch(()=>undefined),
    inputError:await page?.evaluate(() => window.fixtureInputError).catch(()=>undefined),clipboardErrors:await page?.evaluate(()=>window.fixtureClipboardErrors).catch(()=>undefined),pointerPackets:await page?.evaluate(()=>window.pointerPackets).catch(()=>undefined),nativeStates:await page?.evaluate(()=>window.nativeStates).catch(()=>undefined),received},null,2));
  // An invalid completion receipt fails the host fixture and runs its cleanup.
  remote(`printf %s ${quote(JSON.stringify({error:error.message}))} > ${quote(remoteRoot + '/done.json')}`);
  throw error;
} finally {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  tunnel?.kill('SIGTERM');
  if (electronChild && electronChild.exitCode === null && electronChild.signalCode === null) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID',String(electronChild.pid),'/T','/F']);
    else process.kill(-electronChild.pid, 'SIGTERM');
    await waitFor(()=>electronChild.exitCode !== null || electronChild.signalCode !== null, 'Owned Electron did not exit');
  }
  if (electronDirectory) await rm(electronDirectory, {recursive:true,force:true});
}
