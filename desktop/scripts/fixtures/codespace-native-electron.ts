import { app, BrowserWindow, session } from 'electron';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createNativeCodeSpaceGateway } from '../../src/main/codespaceNativeGateway';
import { installNativeCodeSpaceSession } from '../../src/main/codespaceNativeSession';

app.on('window-all-closed', () => {});

void app
  .whenReady()
  .then(async () => {
    let authenticated = 0;
    const upstream = http.createServer((req, res) => {
      if (req.url === '/worker.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(
          `fetch('/echo').then(r=>r.text()).then(text=>postMessage(text))`,
        );
        return;
      }
      if (req.url === '/sw.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(
          `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{fetch('/echo').then(r=>r.text()).then(text=>e.source.postMessage(text))});`,
        );
        return;
      }
      if (req.url === '/echo') {
        authenticated++;
        res.end('native-ok');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><title>Native editor fixture</title><body>CodeSpace</body>',
      );
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const port = (upstream.address() as AddressInfo).port;
    const gateway = await createNativeCodeSpaceGateway({
      pathPrefix: '',
      authority: `127.0.0.1:${port}`,
      headers: {},
      openConnection: async () => net.connect(port, '127.0.0.1'),
      close: async () => {},
    });
    const partition = 'persist:native-electron-smoke';
    const webSession = session.fromPartition(partition);
    await webSession.setProxy({ mode: 'direct' });
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        partition,
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
    try {
      await window.loadURL(gateway.origin + '/');
      assert.equal(
        await window.webContents.executeJavaScript(
          `fetch('/echo').then(r=>r.text())`,
        ),
        'native-ok',
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `new Promise((resolve,reject)=>{const w=new Worker('/worker.js');w.onmessage=e=>{w.terminate();resolve(e.data)};w.onerror=reject})`,
        ),
        'native-ok',
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;await new Promise(r=>{if(navigator.serviceWorker.controller)r();else navigator.serviceWorker.addEventListener('controllerchange',r,{once:true})});return await new Promise(r=>{navigator.serviceWorker.addEventListener('message',e=>r(e.data),{once:true});navigator.serviceWorker.controller.postMessage('go')})})()`,
        ),
        'native-ok',
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `new Promise((resolve,reject)=>{const frame=document.createElement('iframe');frame.onload=()=>frame.contentWindow.fetch('/echo').then(r=>r.text()).then(resolve,reject);frame.src='/iframe';document.body.append(frame)})`,
        ),
        'native-ok',
      );
      const response = await fetch(gateway.origin + '/echo');
      assert.equal(response.status, 401);
      assert.equal(authenticated, 4);
      console.log(
        'Native Electron: document, fetch, Worker, Service Worker, and unauthenticated loopback rejection passed',
      );
    } finally {
      dispose();
      window.destroy();
      await gateway.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
