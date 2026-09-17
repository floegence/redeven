import { app } from 'electron';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createNativeFixtureWindow } from './codespace-native-window';
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
    const createWindow = () => createNativeFixtureWindow({
      identity: 'b'.repeat(64), profileFile: path.join(app.getPath('userData'), 'codespace-profiles.json'), show: true,
      route: async () => ({ pathPrefix: '', authority: '', headers: {}, openConnection: async () => net.connect(ready.port, '127.0.0.1'), close: async () => {} }),
    });
    const native = createWindow();
    const { window, owner } = native;
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error('renderer:', event.message);
    });
    try {
      await owner.showLoading({});
      await owner.open();
      assert.equal(native.ready, true);
      console.log('Owned editor fixture:', JSON.stringify({ ...ready, fixture_pid: fixture.pid }));
      console.log(
        'Native real editor origin:',
        native.gateway.origin,
        'workspace:',
        ready.workspace,
        'fixture PID:',
        fixture.pid,
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
      app.focus({ steal: true });
      window.focus();
      window.webContents.focus();
      const editorPoint = await window.webContents.executeJavaScript(
        `(()=>{const r=document.querySelector('.monaco-editor .view-lines').getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10)}})()`,
      );
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...editorPoint });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...editorPoint });
      assert.equal(await window.webContents.executeJavaScript(
        `Boolean(document.activeElement?.closest('.monaco-editor'))`,
      ), true);
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
        `new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('terminal prompt not ready')),10000);const check=()=>{for(const b of document.querySelectorAll('button,[role=button]'))if(b.textContent.includes('Trust Folder & Continue'))b.click();if(document.querySelector('.xterm-accessibility-tree')?.textContent.includes('redeven-smoke$')){clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`,
      );
      window.focus();
      window.webContents.focus();
      assert.equal(await window.webContents.executeJavaScript(
        `(()=>{const input=document.querySelector('.xterm-helper-textarea');input.focus();return document.activeElement===input})()`,
      ), true);
      for (const keyCode of 'printf native-terminal-ok > native-terminal.txt') {
        window.webContents.sendInputEvent({ type: 'char', keyCode });
      }
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
      const originalOrigin = native.gateway.origin;
      await owner.close();
      const reopened = createWindow();
      try {
        await reopened.owner.showLoading({});
        await reopened.owner.open();
        assert.equal(reopened.gateway.origin, originalOrigin);
        await reopened.window.webContents.executeJavaScript(
          `new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('reopened workbench timed out')),20000);const check=()=>{if(document.querySelector('.monaco-workbench') && document.body.innerText.includes('native-smoke.txt')){clearTimeout(timer);resolve(true)}else setTimeout(check,100)};check()})`,
        );
        console.log('Native real editor: closed and reopened through the same saved origin');
      } finally { await reopened.owner.close(); }
    } catch (error) {
      console.error(
        error,
        window.isDestroyed() ? 'original editor window closed' : await window.webContents.executeJavaScript(
          'document.body.innerText.slice(0,2500)',
        ),
      );
      if (!window.isDestroyed()) await fs.writeFile(
        path.join(
          process.env.REDEVEN_NATIVE_EDITOR_SMOKE_STATE!,
          'editor-failure.png',
        ),
        (await window.webContents.capturePage()).toPNG(),
      );
      throw error;
    } finally {
      await owner.close();
      fixture.kill('SIGTERM');
      await once(fixture, 'exit');
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
