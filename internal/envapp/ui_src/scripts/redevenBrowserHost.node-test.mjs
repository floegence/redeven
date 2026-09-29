import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('the shared browser helper negotiates private IPC, scopes views and closes cleanly with its Runtime parent', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rdb-'));
  const socketPath = path.join(directory, 'host.sock');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./redevenBrowserHost.mjs', import.meta.url)), socketPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let errors = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  });
  const output = readline.createInterface({ input: child.stdout });
  const [line] = await once(output, 'line', { signal: t.signal });
  assert.deepEqual(JSON.parse(line), { type: 'ready', protocol_version: 1, browser_protocol_version: 25, media_wire_version: 1 });
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const open = (route, body, method = 'POST') => new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: route, method, headers: { 'content-type': 'application/json' } }, resolve);
    request.once('error', error => reject(new Error(`${method} ${route} (${body?.method ?? 'stream'}): ${error.message}; helper: ${errors}`, { cause: error })));
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const call = async (method, params = {}) => {
    const response = await open('/command', { id: 'request', method, params });
    let body = '';
    for await (const chunk of response) body += chunk;
    return JSON.parse(body);
  };
  assert.deepEqual(await call('source.tool', { target: 'ungranted', request: {} }), { id: 'request', error: 'BROWSER_SOURCE_UNAVAILABLE' });
  assert.deepEqual(await call('invented.operation'), { id: 'request', error: 'BROWSER_COMMAND_INVALID' });
  const observation = await open('/observe', { id: 'view', targets: [], editable: true });
  assert.equal(observation.statusCode, 200);
  let messages = '';
  observation.on('data', data => { messages += data; });
  assert.deepEqual(await call('view.acquire', { view: 'view', target: 'ungranted', token: 'fake' }), { id: 'request', result: false });
  assert.match(messages, /"type":"tabs"/u);
  const media = await open('/media?view=view', undefined, 'GET');
  assert.equal(media.statusCode, 200);
  media.resume();
  assert.deepEqual(await call('view.close', { view: 'view' }), { id: 'request' });
  assert.deepEqual(await call('view.acquire', { view: 'view', target: 'ungranted', token: 'stale' }), { id: 'request', error: 'BROWSER_VIEW_UNAVAILABLE' });
  child.stdin.end();
  const [code, signal] = await exited;
  assert.equal(code, 0, errors);
  assert.equal(signal, null);
});
