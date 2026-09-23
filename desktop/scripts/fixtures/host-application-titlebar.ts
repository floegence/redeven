import { app, BrowserWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildDesktopWindowChromeOptions } from '../../src/main/windowChrome';
import { attachHostApplicationWindow } from '../../src/main/hostApplicationWindow';
import { DesktopThemeState } from '../../src/main/desktopThemeState';
import { desktopRendererThemeSnapshot } from '../../src/shared/desktopThemeIPC';
import { REDEVEN_SUPPORTED_LOCALES, type RedevenLocale } from '../../src/shared/i18n/localeMeta';
import { enUS } from '../../../internal/envapp/ui_src/src/ui/i18n/locales/en-US';

// Real native window, preload and production viewer; only Xpra transport is a
// fixture. It never sends input to a user-owned application.
const source = path.join(process.env.REDEVEN_TITLEBAR_REPOSITORY!, 'internal/codeapp/appserver/host_application_viewer');
const copy: Record<string, string> = {};
for (const [key, value] of Object.entries(enUS.hostApplications)) {
  if (typeof value === 'string') {
    copy[key.startsWith('mac') ? key[3].toLowerCase() + key.slice(4) : key] = value;
  }
}
copy.quitDescription = enUS.hostApplications.sessionQuitDescription;
copy.pictureHint = enUS.hostApplications.sessionPictureHint;
const clientScript = `
window.operations=[];
window.contentInput=[];
const pointerTargets=new Map();const painted=new Set();
function remoteWindow(wid,title){
const div=document.createElement('article');div.innerHTML='<small>HOST APPLICATION</small><h1></h1><p>Window content stays below the native titlebar.</p>';
div.querySelector('h1').textContent=title;document.body.append(div);
const target={wid,window:{wid,div}};pointerTargets.set(wid,target);
for(const type of ['pointerdown','pointerup','click'])div.addEventListener(type,event=>{window.contentInput.push([type,event.defaultPrevented]);event.stopPropagation()});
return {wid,div,metadata:{title},windowtype:['NORMAL'],override_redirect:false,tray:false,
has_windowtype:types=>types.includes('NORMAL'),screen_resized(){},set_maximized(){},set_minimized(){},initiate_moveresize(){},move_resize(){},update_metadata(value){Object.assign(this.metadata,value)},destroy(){div.remove()}};
}
const floePointer={version:1,targetForWindow:win=>painted.has(win.wid)?pointerTargets.get(win.wid):null,resolveTarget:event=>[...pointerTargets.values()].find(target=>target.window.div.contains(event.target)),isTargetValid:target=>Boolean(target&&painted.has(target.wid)&&pointerTargets.get(target.wid)===target),sendPointer(command,target){window.operations.push(['pointer',target.wid,command]);return true},release(target){window.operations.push(['pointer-release',target?.wid])}};
const client={floeInput:{version:1,target:null,bindTarget(wid){if(this.target?.wid!==wid)this.target=wid?{wid}:null;return this.target},commitText(text,target){window.operations.push(['text',target.wid,text])},sendKey(key,target){window.operations.push(['key',target.wid,key])},release(){},clipboard(){return false},paste(){}},connected:true,focused_wid:1,id_to_window:{1:remoteWindow(1,'Research notes'),2:remoteWindow(2,'Project brief')},
_new_window(){},do_send_damage_sequence(_sequence,wid){painted.add(wid)},send_configure_window(){},send_control_refresh(){},on_last_window(){},callback_close(){},
set_focus(win){this.focused_wid=win.wid;Object.values(this.id_to_window).forEach(w=>w.div.hidden=w!==win)},
send(packet){window.operations.push(packet)},send_close_window(win){window.operations.push(['close-window',win.wid])},close(){}};
client.floePointer=floePointer;window.floeXpraInput={version:1,getClient:()=>client};
client.set_focus(client.id_to_window[1]);
addEventListener('load',()=>setTimeout(()=>client.do_send_damage_sequence(1,1,800,600,1,''),80));`;
const catalogSource = readFileSync(path.join(source, 'catalog.generated.js'), 'utf8');
const catalog = JSON.parse(catalogSource.slice(catalogSource.indexOf(' = ') + 3).trim().slice(0, -1));
const html = readFileSync(path.join(source, 'viewer.html'), 'utf8').replaceAll('{{.Name}}', 'Text Editor').replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Nonce}}', 'fixture')
  .replace('{{.Style}}', ['appearance.generated.css', 'remote-input.generated.css', 'remote-pointer.generated.css', 'viewer.css'].map(file => readFileSync(path.join(source, file), 'utf8')).join('\n')).replace('{{.Config}}', JSON.stringify({ base: '/fixture', copy, icon: '' }))
  .replace('{{.Script}}', ['catalog.generated.js', 'remote-input.generated.js', 'remote-pointer.generated.js', 'appearance.js', 'connection.js', 'toolbar.js', 'viewer.js'].map(file => readFileSync(path.join(source, file), 'utf8')).join('\n'));
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url?.endsWith('/state')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ state: 'running', password: 'fixture' }));
  } else if (request.url === '/fixture/index.html')
    response.end(`<!doctype html><html><head><style>body{margin:0;background:#fafbfc;color:#27303a;font:14px -apple-system,BlinkMacSystemFont,sans-serif}article{padding:70px 80px;min-height:100vh;box-sizing:border-box;background:#fafbfc}small{font-size:10px;letter-spacing:.14em;color:#939ba6}h1{font-size:32px;letter-spacing:-.03em;font-weight:600;margin:16px 0}p{color:#89919c}</style></head><body><script>${clientScript}</script></body></html>`);
  else {
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data: blob:; connect-src 'self'; frame-src 'self'; script-src 'nonce-fixture'; style-src 'nonce-fixture'; base-uri 'none'; frame-ancestors 'none'");
    response.end(html);
  }
});
async function run() {
  await app.whenReady();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/fixture/_redeven_host_app/`;
  console.log('Titlebar fixture port:', address.port);
  const win = new BrowserWindow({ width: 1120, height: 760, show: true, ...buildDesktopWindowChromeOptions(), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const view = new WebContentsView({ webPreferences: { preload: process.env.REDEVEN_TITLEBAR_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(view);
  const theme = new DesktopThemeState({getRendererItem:()=>null, setRendererItem:()=>{}}, {shouldUseDarkColors:false, themeSource:'system', on:()=>{}, off:()=>{}});
  let locale: RedevenLocale = 'en-US';
  const publishAppearance = attachHostApplicationWindow(win, view.webContents, url, () => ({theme:desktopRendererThemeSnapshot(theme.getSnapshot()), locale}));
  const layout = () => {
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  win.on('resize', layout);
  layout();
  const evaluate = (expression: string) => view.webContents.executeJavaScript(expression).catch(error => {
    throw new Error(`Viewer evaluation failed: ${expression}: ${String(error)}`);
  });
  const wait = async (expression: string) => {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out: ' + expression);
  };
  const click = async (selector: string, content = false) => {
    const position = await evaluate(`(()=>{const frame=document.querySelector('#application');const element=${content ? 'frame.contentDocument' : 'document'}.querySelector(${JSON.stringify(selector)});const rect=element.getBoundingClientRect();const offset=${content ? 'frame.getBoundingClientRect()' : '{left:0,top:0}'};return {x:Math.round(offset.left+rect.left+rect.width/2),y:Math.round(offset.top+rect.top+Math.min(rect.height/2,100))};})()`);
    view.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
    view.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
  };
  try {
    await view.webContents.loadURL(url);
    await wait(`document.body.dataset.state==='active'`);
    const geometry = await evaluate(`(()=>{const frame=document.querySelector('#application');return {toolbar:document.querySelector('.mac-app-controls').getBoundingClientRect().height,left:document.querySelector('.host-app-identity').getBoundingClientRect().left,content:frame.getBoundingClientRect().top,bridge:Object.keys(window.redevenHostApplicationWindow),childBridge:typeof frame.contentWindow.redevenHostApplicationWindow};})()`);
    assert.equal(geometry.toolbar, 40);
    assert.equal(geometry.content, 40);
    assert(geometry.left >= (process.platform === 'darwin' ? 84 : 16));
    assert.deepEqual(geometry.bridge.sort(), ['request', 'subscribe']);
    assert.equal(geometry.childBridge, 'undefined');
    const dragRegion = () => evaluate(`getComputedStyle(document.querySelector('.mac-app-toolbar')).getPropertyValue('app-region')`);
    assert.equal(await dragRegion(), 'drag');
    for (const toggle of ['.mac-app-controls-toggle', '.mac-app-windows-toggle', '.mac-app-quit']) {
      for (const outside of ['.mac-app-toolbar-spacer', '.mac-app-toolbar-separator', '.host-app-identity']) {
        await click(toggle);
        await wait(`!document.querySelector('.mac-app-popover').hidden`);
        assert.equal(await dragRegion(), 'no-drag');
        await click(outside);
        await wait(`document.querySelector('.mac-app-popover').hidden`);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'false');
        assert.equal(await dragRegion(), 'drag');
      }
    }
    assert.equal(await evaluate(`document.querySelector('#application').contentWindow.operations.length`), 0);
    await click('.mac-app-controls-toggle');
    await wait(`!document.querySelector('.mac-app-popover').hidden`);
    await click('.mac-app-windows-toggle');
    await wait(`!document.querySelector('.mac-app-popover').hidden && document.querySelector('.mac-app-popover').dataset.section==='windows'`);
    await click('.mac-app-windows-toggle');
    await wait(`document.querySelector('.mac-app-popover').hidden`);
    assert.equal(await dragRegion(), 'drag');
    console.log('Titlebar header acceptance passed: outside click, trigger switching and restored native drag region');
    // Native input must cross the iframe boundary, dismiss the toolbar, and
    // still reach the application exactly once, including after reconnection.
    for (const reconnect of [false, true]) {
      if (reconnect) {
        await evaluate(`document.querySelector('#application').contentWindow.floeXpraInput.getClient().callback_close()`);
        await wait(`document.body.dataset.state==='disconnected'`);
        await click('#retry');
        await wait(`document.body.dataset.state==='active'`);
      }
      for (const selector of ['.mac-app-controls-toggle', '.mac-app-windows-toggle', '.mac-app-quit']) {
        await click(selector);
        await wait(`!document.querySelector('.mac-app-popover').hidden`);
        if (selector === '.mac-app-controls-toggle') {
          await click('[data-picture-mode="clarity"]');
          await wait(`document.querySelector('#application').contentWindow.operations.some(v=>v[0]==='quality'&&v[1]===95)`);
          assert.equal(await evaluate(`document.querySelector('.mac-app-popover').hidden`), false);
          await click(selector);
          await wait(`document.querySelector('.mac-app-popover').hidden`);
          await click(selector);
          await wait(`!document.querySelector('.mac-app-popover').hidden`);
        }
        await evaluate(`document.querySelector('#application').contentWindow.contentInput=[]`);
        await click('article:not([hidden]) p', true);
        await wait(`document.querySelector('#application').contentWindow.contentInput.length===3`);
        assert.equal(await evaluate(`document.querySelector('.mac-app-popover').hidden`), true);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')`), 'false');
        assert.deepEqual(await evaluate(`document.querySelector('#application').contentWindow.contentInput`), [['pointerdown', false], ['pointerup', false], ['click', false]]);
      }
    }
    console.log('Titlebar outside-input acceptance passed: three popovers, preserved clicks, internal controls and reconnect');
    await evaluate(`document.querySelector('.mac-app-windows-toggle').click();document.querySelectorAll('.mac-app-window-list button')[1].click()`);
    assert.equal(await evaluate(`document.querySelector('#application').contentWindow.floeXpraInput.getClient().focused_wid`), 2);
    await evaluate(`document.querySelector('.mac-app-controls-toggle').click();document.querySelector('[data-picture-mode="clarity"]').click()`);
    const operations = await evaluate(`document.querySelector('#application').contentWindow.operations`);
    assert(operations.some((v: unknown[]) => v[0] === 'quality' && v[1] === 95));
    await evaluate(`document.querySelector('.mac-app-controls-toggle').focus();if(document.querySelector('.mac-app-popover').hidden)document.querySelector('.mac-app-controls-toggle').click();Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished))`);
    await evaluate(`window.savedFrame=document.querySelector('#application');window.savedClient=savedFrame.contentWindow.floeXpraInput.getClient();window.savedToggle=document.querySelector('.mac-app-controls-toggle');`);
    const operationCount = operations.length;
    for (const nextLocale of REDEVEN_SUPPORTED_LOCALES) {
      locale = nextLocale; publishAppearance();
      await wait(`document.querySelector('.mac-app-controls-toggle').title===${JSON.stringify(catalog.locales[locale].picture)}`);
      assert.equal(await evaluate(`document.querySelector('.mac-app-picture p').textContent`), catalog.locales[locale].sessionPictureHint);
      assert.equal(await evaluate(`document.activeElement===savedToggle && document.querySelector('#application')===savedFrame && savedFrame.contentWindow.floeXpraInput.getClient()===savedClient && savedClient.focused_wid===2`), true);
      assert.equal(await evaluate(`savedFrame.contentWindow.operations.length`), operationCount);
      assert.equal(await evaluate(`document.querySelector('[data-picture-mode="clarity"]').getAttribute('aria-pressed')`), 'true');
    }
    const output = process.env.REDEVEN_TITLEBAR_EVIDENCE;
    if (output) mkdirSync(output, { recursive: true });
    locale = 'zh-CN';
    for (const [mode, preset] of [['light', 'porcelain-light'], ['dark', 'forest'], ['dark', 'dracula']] as const) {
      theme.setShellTheme(mode, preset); theme.setSource(mode); publishAppearance();
      await wait(`document.documentElement.dataset.floeShellTheme===${JSON.stringify(preset)} && document.documentElement.lang==='zh-CN' && document.documentElement.classList.contains(${JSON.stringify(mode)})`);
      await evaluate(`Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished))`);
      const colors = await evaluate(`(()=>{const ref=document.createElement('div');ref.style.background='var(--background)';document.body.append(ref);const expected=getComputedStyle(ref).backgroundColor;ref.remove();return {expected,actual:getComputedStyle(document.querySelector('.mac-app-controls')).backgroundColor}})()`);
      assert.equal(colors.actual, colors.expected);
      assert.equal(await evaluate(`savedFrame.contentWindow.operations.length`), operationCount);
      if (output) {
        const image = await view.webContents.capturePage();
        assert(!image.isEmpty());
        writeFileSync(path.join(output, 'desktop-titlebar-' + preset + '-zh-CN.png'), image.toPNG());
      }
    }
    await evaluate(`document.querySelector('.mac-app-controls-toggle').click();document.querySelector('.mac-app-quit').click()`);
    assert.equal(await evaluate(`document.querySelector('#application').contentWindow.operations.filter(v=>v[0]==='close-window').length`), 0);
    await evaluate(`document.querySelector('.mac-app-confirm-quit').click()`);
    assert.equal(await evaluate(`document.querySelector('#application').contentWindow.operations.filter(v=>v[0]==='close-window').length`), 2);
    assert.equal(win.isDestroyed(), false);
    if (process.platform === 'darwin') {
      win.setFullScreen(true);
      await wait(`getComputedStyle(document.documentElement).getPropertyValue('--redeven-desktop-titlebar-start-inset').trim()==='16px'`);
      win.setFullScreen(false);
      await wait(`getComputedStyle(document.documentElement).getPropertyValue('--redeven-desktop-titlebar-start-inset').trim()==='84px'`);
    }
    console.log('Titlebar native acceptance passed:', JSON.stringify(geometry));
  } finally {
    view.webContents.close();
    win.destroy();
    server.close();
    app.quit();
  }
}
run().catch(error => { console.error(error); app.exit(1); });
