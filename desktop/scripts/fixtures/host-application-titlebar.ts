import { app, BrowserWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildDesktopWindowChromeOptions } from '../../src/main/windowChrome';
import { attachHostApplicationWindow } from '../../src/main/hostApplicationWindow';
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
function remoteWindow(wid,title){
const div=document.createElement('article');div.innerHTML='<small>HOST APPLICATION</small><h1></h1><p>Window content stays below the native titlebar.</p>';
div.querySelector('h1').textContent=title;document.body.append(div);
return {wid,div,metadata:{title},windowtype:['NORMAL'],override_redirect:false,tray:false,
has_windowtype:types=>types.includes('NORMAL'),screen_resized(){},set_maximized(){},set_minimized(){},initiate_moveresize(){},move_resize(){},update_metadata(value){Object.assign(this.metadata,value)},destroy(){div.remove()}};
}
const client={connected:true,focused_wid:1,id_to_window:{1:remoteWindow(1,'Research notes'),2:remoteWindow(2,'Project brief')},
_new_window(){},do_send_damage_sequence(){},send_configure_window(){},send_control_refresh(){},on_last_window(){},callback_close(){},
set_focus(win){this.focused_wid=win.wid;Object.values(this.id_to_window).forEach(w=>w.div.hidden=w!==win)},
send(packet){window.operations.push(packet)},send_close_window(win){window.operations.push(['close-window',win.wid])},close(){}};
client.set_focus(client.id_to_window[1]);
addEventListener('load',()=>setTimeout(()=>client.do_send_damage_sequence(1,1,800,600,1,''),80));`;
const html = readFileSync(path.join(source, 'viewer.html'), 'utf8').replaceAll('{{.Name}}', 'Text Editor').replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Nonce}}', 'fixture')
  .replace('{{.Style}}', readFileSync(path.join(source, 'viewer.css'), 'utf8')).replace('{{.Config}}', JSON.stringify({ base: '/fixture', copy, icon: '' }))
  .replace('{{.Script}}', ['connection.js', 'toolbar.js', 'viewer.js'].map(file => readFileSync(path.join(source, file), 'utf8')).join('\n'));
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url?.endsWith('/state')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ state: 'running', password: 'fixture' }));
  } else if (request.url === '/fixture/index.html')
    response.end(`<!doctype html><html><head><style>body{margin:0;background:#fafbfc;color:#27303a;font:14px -apple-system,BlinkMacSystemFont,sans-serif}article{padding:70px 80px}small{font-size:10px;letter-spacing:.14em;color:#939ba6}h1{font-size:32px;letter-spacing:-.03em;font-weight:600;margin:16px 0}p{color:#89919c}</style></head><body><script>${clientScript}</script></body></html>`);
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
  attachHostApplicationWindow(win, view.webContents, url);
  const layout = () => {
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  win.on('resize', layout);
  layout();
  const evaluate = (expression: string) => view.webContents.executeJavaScript(expression);
  const wait = async (expression: string) => {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out: ' + expression);
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
    await evaluate(`document.querySelector('.mac-app-windows-toggle').click();document.querySelectorAll('.mac-app-window-list button')[1].click()`);
    assert.equal(await evaluate(`document.querySelector('#application').contentWindow.redevenXpraClient().focused_wid`), 2);
    await evaluate(`document.querySelector('.mac-app-controls-toggle').click();document.querySelector('[data-picture-mode="clarity"]').click()`);
    const operations = await evaluate(`document.querySelector('#application').contentWindow.operations`);
    assert(operations.some((v: unknown[]) => v[0] === 'quality' && v[1] === 95));
    await evaluate(`document.querySelector('.mac-app-controls-toggle').focus();if(document.querySelector('.mac-app-popover').hidden)document.querySelector('.mac-app-controls-toggle').click();Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished))`);
    const output = process.env.REDEVEN_TITLEBAR_EVIDENCE;
    if (output) {
      mkdirSync(output, { recursive: true });
      const image = await view.webContents.capturePage();
      assert(!image.isEmpty());
      writeFileSync(path.join(output, 'desktop-titlebar.png'), image.toPNG());
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
