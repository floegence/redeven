import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { build } from 'esbuild';

const desktop = fileURLToPath(new URL('../', import.meta.url));
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const parsed = new URL(input.url);
assert.equal(parsed.hostname, '127.0.0.1');
assert.equal(parsed.protocol, 'http:');
const directory = await mkdtemp(path.join(tmpdir(), 'redeven-managed-opening-electron-'));
const marker = randomUUID();
try {
  execFileSync(path.join(desktop, '../scripts/check_desktop_electron_test_runtime.sh'), [desktop], { stdio: 'inherit' });
  const script = path.join(directory, 'main.cjs');
  await writeFile(path.join(directory,'entrance.json'),raw,{mode:0o600});
  await build({ stdin: { resolveDir: desktop, contents: `
    import { app, BrowserWindow } from 'electron';
    import { readFileSync } from 'node:fs';
    import assert from 'node:assert/strict';
    import { ManagedWebEntranceNavigation } from './src/main/managedWebEntranceNavigation';
    app.on('window-all-closed',()=>{});
    app.whenReady().then(async () => {
      const {url,rootURL}=JSON.parse(readFileSync('entrance.json','utf8'));
      const root=rootURL || new URL('/',url).href;
      let navigation = new ManagedWebEntranceNavigation({service_id:'qualification',launch_generation:'verified-launch'});
      let authFailures=0;
      const create=()=>new BrowserWindow({width:1000,height:760,show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,partition:'managed-'+${JSON.stringify(marker)}+'-'+Math.random()}});
      let win=create();
      win.webContents.session.webRequest.onHeadersReceived((details,done)=>{
        if(details.webContentsId===win.webContents.id && navigation.observe(details.resourceType,details.statusCode))authFailures++;
        done({});
      });
      await win.loadURL(root);
      assert.equal(authFailures,1,'root navigation must prove authentication failure');
      navigation.begin(navigation.context);
      await win.loadURL(url);
      assert.equal(authFailures,1,'current entrance must authenticate');
      assert.ok(await win.webContents.executeJavaScript('document.body.innerText.trim().length>0 && document.documentElement.tagName==="HTML"'),'authenticated page must paint content');
      const cookies=await win.webContents.session.cookies.get({url});
      assert.ok(cookies.length>0,'authentication must establish browser cookies');
      await win.webContents.reload();
      await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
      assert.equal(authFailures,1,'later normal application navigation is not bootstrap authentication');
      await win.webContents.session.clearStorageData();
      win.destroy();win=create();
      await win.loadURL(url);
      assert.ok((await win.webContents.session.cookies.get({url})).length>0,'a fresh reopened partition must authenticate again');
      assert.ok(await win.webContents.executeJavaScript('document.body.innerText.trim().length>0'),'closing and reopening must restore the authenticated page');
      if(process.env.REDEVEN_MANAGED_OPENING_SCREENSHOT) {
        const {writeFileSync}=await import('node:fs');writeFileSync(process.env.REDEVEN_MANAGED_OPENING_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
      }
      win.destroy();console.log('PASS managed entrance: real Electron 401, authenticated redirect, Cookie, painted page, refresh and window reopen');app.quit();
    }).catch(()=>{console.error('Managed entrance Electron qualification failed.');app.exit(1);});
  ` }, outfile: script, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const child = spawn(electron, [script, `--user-data-dir=${directory}/profile`, `--redeven-managed-opening-run=${marker}`], { cwd: directory, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  console.log(JSON.stringify({pid:child.pid,state:directory,marker,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:desktop,encoding:'utf8'}).trim()}));
  let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;});
  const timer=setTimeout(()=>{
    if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
    if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F']);else process.kill(-child.pid,'SIGTERM');
  },60000);
  try {
    const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    assert.equal(result.code,0,`Owned Electron failed: ${JSON.stringify(result)}\n${output}`);
    assert.equal(result.signal,null);
    assert.ok(output.includes('PASS managed entrance'));console.log(output.trim());
  } finally {clearTimeout(timer);}
} finally {await rm(directory,{recursive:true,force:true});}
