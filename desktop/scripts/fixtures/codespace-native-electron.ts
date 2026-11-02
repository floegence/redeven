import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import assert from 'node:assert/strict';
import { createNativeFixtureWindow } from './codespace-native-window';
import { createFixtureBridgeSession } from './codespace-bridge-session';

app.on('window-all-closed', () => {});

void app
  .whenReady()
  .then(async () => {
    let authenticated = 0;
    const token = 'A'.repeat(43);
    const prefix = '/api/local/codespaces/native-smoke/fixed-generation-12345678';
    const upstream = http.createServer((req, res) => {
      if (req.headers['x-redeven-desktop-bridge-token'] !== token) { res.writeHead(401).end(); return; }
      if (req.url === '/api/local/codespaces/native-smoke') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, data: { instance_id: 'fixed-generation-12345678', access_cookie_name: 'redeven_local_access_http_23998' } }));
        return;
      }
      req.url = req.url?.replace(prefix, '');
      if (req.url === '/') { res.writeHead(302, { Location: '/editor' }); res.end(); return; }
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
    const upstreamSockets = new Set<Socket>();
    upstream.on('connection', (socket) => { upstreamSockets.add(socket); socket.once('close', () => upstreamSockets.delete(socket)); });
    upstream.on('upgrade', (request, socket) => {
      assert.equal(request.headers['x-redeven-desktop-bridge-token'], token);
      const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.once('data', () => {
        const text = Buffer.from('native-websocket-ok');
        socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
      });
      socket.on('error', () => socket.destroy());
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const port = (upstream.address() as AddressInfo).port;
    const baseURL = `http://127.0.0.1:${port}/`;
    const bridge = await createFixtureBridgeSession(baseURL, token);
    const fixture = createNativeFixtureWindow({
      identity: 'a'.repeat(64), profileFile: path.join(app.getPath('userData'), 'codespace-profiles.json'),
      route: bridge.route,
    });
    const { window, owner } = fixture;
    try {
      const descriptor = baseURL + 'api/local/codespaces/native-smoke';
      assert.equal((await bridge.webSession.fetch(descriptor)).status, 401);
      assert.equal((await bridge.webSession.fetch(descriptor, { headers: { 'X-Redeven-Desktop-Bridge-Token': 'forged' } })).status, 401);
      const loading = owner.showLoading({});
      const opening = owner.open();
      await Promise.all([loading, opening]);
      assert.equal(fixture.ready, true);
      assert.equal(window.webContents.getURL(), fixture.gateway.origin + '/editor');
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
      assert.equal(await window.webContents.executeJavaScript(
        `new Promise((resolve,reject)=>{const socket=new WebSocket(location.origin.replace('http:', 'ws:')+'/socket');socket.onopen=()=>socket.send('hello');socket.onmessage=e=>{resolve(e.data);socket.close()};socket.onerror=reject})`,
      ), 'native-websocket-ok');
      const response = await fetch(fixture.gateway.origin + '/echo');
      assert.equal(response.status, 401);
      assert.equal(authenticated, 4);
      assert(bridge.observations.some(item => item.type === 'other' && !item.source && item.authorized));
      const placement = await createFixtureBridgeSession(baseURL, token, 'placement_bridge');
      try { await (await placement.route(new AbortController().signal)).close(); }
      finally { placement.dispose(); }
      const foreign = new BrowserWindow({ show: false, webPreferences: { session: bridge.webSession, sandbox: true, contextIsolation: true } });
      try {
        await foreign.loadURL('data:text/html,<title>Untrusted origin</title>');
        const count = bridge.observations.length;
        await foreign.webContents.executeJavaScript(`fetch(${JSON.stringify(descriptor)}, { mode: 'no-cors' }).catch(() => null)`);
        assert(bridge.observations.length > count);
        assert(bridge.observations.slice(count).every(item => !item.authorized));
      } finally { foreign.destroy(); }
      console.log(
        'Native Electron: authenticated descriptor, local/placement route, loading handoff, redirect, document, fetch, Worker, Service Worker, WebSocket, and unauthenticated/foreign-origin rejection passed',
      );
    } finally {
      await owner.close();
      bridge.dispose();
      for (const socket of upstreamSockets) socket.destroy();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
