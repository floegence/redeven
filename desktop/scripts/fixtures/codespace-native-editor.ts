import { app, BrowserWindow, session } from 'electron';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createNativeCodeSpaceGateway } from '../../src/main/codespaceNativeGateway';
import { installNativeCodeSpaceSession } from '../../src/main/codespaceNativeSession';
app.on('window-all-closed', () => {});
void app
  .whenReady()
  .then(async () => {
    const fixture = spawn(process.env.REDEVEN_NATIVE_EDITOR_FIXTURE!, [], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    process.once('SIGTERM', () => {
      fixture.kill('SIGTERM');
      app.exit(1);
    });
    app.once('before-quit', () => fixture.kill('SIGTERM'));
    let line = '';
    const ready = await new Promise<{ port: number; workspace: string }>(
      (resolve, reject) => {
        fixture.stdout.on('data', (chunk) => {
          line += chunk.toString();
          for (const text of line.split('\n'))
            if (text.startsWith('NATIVE_EDITOR_READY '))
              resolve(JSON.parse(text.slice(20)));
        });
        fixture.once('exit', () =>
          reject(new Error('editor fixture exited before ready')),
        );
      },
    );
    const gateway = await createNativeCodeSpaceGateway({
      pathPrefix: '',
      authority: '',
      headers: {},
      openConnection: async () => net.connect(ready.port, '127.0.0.1'),
      close: async () => {},
    });
    const partition = 'persist:native-real-editor';
    const webSession = session.fromPartition(partition);
    await webSession.setProxy({ mode: 'direct' });
    const window = new BrowserWindow({
      show: true,
      width: 1440,
      height: 1000,
      webPreferences: {
        partition,
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const dispose = installNativeCodeSpaceSession(
      webSession,
      gateway,
      window.webContents.id,
    );
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error('renderer:', event.message);
    });
    try {
      console.log(
        'Native real editor origin:',
        gateway.origin,
        'workspace:',
        ready.workspace,
        'fixture PID:',
        fixture.pid,
      );
      await window.loadURL(
        gateway.origin + '/?folder=' + encodeURIComponent(ready.workspace),
      );
      await window.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('workbench timed out: '+document.body.innerText.slice(0,1000))),25000);const check=()=>{if(document.querySelector('.monaco-workbench')){clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`,
      );
      await window.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('workspace file not available: '+document.body.innerText.slice(0,1500))),20000);const check=()=>{for(const button of document.querySelectorAll('button'))if(button.innerText.includes('Yes, I trust'))button.click();if(document.body.innerText.includes('native-smoke.txt')){clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`,
      );
      console.log('Native editor workspace tree loaded');
      window.focus();
      window.webContents.focus();
      const point = await window.webContents.executeJavaScript(
        `(()=>{const label=Array.from(document.querySelectorAll('.label-name')).find(e=>e.textContent==='native-smoke.txt');if(!label)throw new Error('missing file label');const r=label.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        clickCount: 2,
        ...point,
      });
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        clickCount: 2,
        ...point,
      });
      await window.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('editor text not opened')),10000);const check=()=>{if(document.querySelector('.monaco-editor .view-lines')?.textContent.replaceAll(String.fromCharCode(160),' ').includes('native editor smoke')){clearTimeout(timeout);resolve(true)}else setTimeout(check,100)};check()})`,
      );
      await window.webContents.insertText('saved through native forwarding ');
      window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 's',
        modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
      });
      window.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 's',
        modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
      });
      const deadline = Date.now() + 5000;
      for (;;) {
        if (
          (
            await fs.readFile(
              path.join(ready.workspace, 'native-smoke.txt'),
              'utf8',
            )
          ).includes('saved through native forwarding')
        )
          break;
        if (Date.now() > deadline)
          throw new Error('native editor save did not reach runtime');
        await new Promise((r) => setTimeout(r, 100));
      }
      window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: '`',
        modifiers: ['control'],
      });
      window.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: '`',
        modifiers: ['control'],
      });
      await window.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('terminal not opened')),10000);const check=()=>{for(const b of document.querySelectorAll('button,[role=button]'))if(b.textContent.includes('Trust Folder & Continue'))b.click();const input=document.querySelector('.xterm-helper-textarea');if(input && !document.body.innerText.includes('Trust Folder & Continue')){input.focus();clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`,
      );
      await window.webContents.executeJavaScript(
        `new Promise(r=>setTimeout(r,1000))`,
      );
      await window.webContents.insertText(
        'printf native-terminal-ok > native-terminal.txt\r',
      );
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      const terminalDeadline = Date.now() + 5000;
      for (;;) {
        try {
          if (
            (await fs.readFile(
              path.join(ready.workspace, 'native-terminal.txt'),
              'utf8',
            )) === 'native-terminal-ok'
          )
            break;
        } catch {}
        if (Date.now() > terminalDeadline)
          throw new Error('native terminal input did not reach runtime');
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log(
        'Native real editor: workspace opened, remote file read, Monaco edited, file saved to disk, and terminal input executed',
      );
      await fs.writeFile(
        path.join(process.env.REDEVEN_NATIVE_EDITOR_SMOKE_STATE!, 'editor.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
    } catch (error) {
      console.error(
        error,
        await window.webContents.executeJavaScript(
          'document.body.innerText.slice(0,2500)',
        ),
      );
      await fs.writeFile(
        path.join(
          process.env.REDEVEN_NATIVE_EDITOR_SMOKE_STATE!,
          'editor-failure.png',
        ),
        (await window.webContents.capturePage()).toPNG(),
      );
      throw error;
    } finally {
      dispose();
      window.destroy();
      await gateway.close();
      fixture.kill('SIGTERM');
      await once(fixture, 'exit');
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
