import process from 'node:process';
import http from 'node:http';
import path from 'node:path';
import { chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { MediaSender, NativeMediaBridge, PROTOCOL_VERSION } from '@floegence/floebrowser';
import { MAX_MESSAGE_BYTES, MAX_PENDING_COMMANDS, clientMessageSchema } from '@floegence/floebrowser/protocol';
import { MEDIA_WIRE_VERSION } from '@floegence/floebrowser/media';
import { ExtensionTransport } from './computerExtensionTransport.mjs';
import { createComputerBrowserHost } from './computerBrowserHost.mjs';

// This is private Runtime IPC in a 0700 task-owned directory. No CDP endpoint,
// browser website, file or media port is exposed to a renderer. Public clients
// reach only the Go Runtime's authenticated Flowersec session adapters.
const socketPath = process.argv[2];
if (!path.isAbsolute(socketPath || '')) throw new Error('BROWSER_HOST_SOCKET_REQUIRED');
const directoryRequests = new Map();
const streams = new Map();
const extensions = new Map();
const bridge = new NativeMediaBridge();
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let closing;
// At most one unsent metadata snapshot per admitted source or view. Slow
// Runtime storage must not turn repeated website events into an unbounded pipe.
const snapshots = new Map();
let snapshotsScheduled = false, snapshotsBlocked = false;
function flushSnapshots() {
  snapshotsScheduled = false;
  if (snapshotsBlocked || closing) return;
  for (const [key, value] of snapshots) {
    snapshots.delete(key);
    if (!emit(value)) {
      snapshotsBlocked = true;
      process.stdout.once('drain', () => { snapshotsBlocked = false; flushSnapshots(); });
      break;
    }
  }
}
function snapshot(key, value) {
  snapshots.set(key, value);
  if (!snapshotsScheduled && !snapshotsBlocked) { snapshotsScheduled = true; queueMicrotask(flushSnapshots); }
}
const host = await createComputerBrowserHost({
  mediaBridge: bridge,
  extensionTransport: id => extensions.get(id),
  // Each browser document has its own Runtime-issued view path. Query-relative
  // resources preserve that path for images, stylesheets and nested CSS URLs.
  resourceURL: (id, target) => `?browser_target=${encodeURIComponent(target)}&browser_resource=${encodeURIComponent(id)}`,
  onSourceClosed: target => { snapshots.delete(`source:${target}`); emit({ type: 'source_closed', target }); },
  onSourceFault: target => emit({ type: 'source_fault', target }),
  onSourcePopup: (target, tab_id, foreground) => emit({ type: 'source_popup', target, tab_id, foreground }),
  onSourceChanged: (target, tab) => {
    if (Buffer.byteLength(tab.url) <= 8192) snapshot(`source:${target}`, { type: 'source_changed', target, tab });
  },
  onSelection: (view, target) => snapshot(`view:${view}`, { type: 'view_selected', view, target }),
  directoryCommand(view, action) {
    if (closing || directoryRequests.size >= 64) return Promise.reject(new Error('BROWSER_DIRECTORY_BUSY'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      // Beforeunload is a user decision, not a slow RPC. Its lifetime follows
      // the view, and the same global bound applies while the decision is open.
      const timer = action.kind === 'close' ? undefined : setTimeout(() => {
        directoryRequests.delete(id);
        reject(new Error('BROWSER_DIRECTORY_OUTCOME_UNKNOWN'));
      }, 30000);
      directoryRequests.set(id, { view, resolve, reject, timer });
      emit({ type: 'directory_request', id, view, action });
    });
  },
});

async function bodyJSON(request, limit = 256 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('BROWSER_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function sendJSON(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
function errorCode(error) {
  // CDP/Playwright exceptions can include page text, endpoints or credentials.
  return /^BROWSER_[A-Z_]+$/u.test(error?.message ?? '') ? error.message : 'BROWSER_HOST_COMMAND_FAILED';
}
async function writeChunk(response, data) {
  if (response.destroyed) throw new Error('BROWSER_STREAM_CLOSED');
  if (!response.write(data)) await new Promise((resolve, reject) => {
    const cleanup = () => { response.off('drain', drained); response.off('close', failed); response.off('error', failed); };
    const drained = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('BROWSER_STREAM_CLOSED')); };
    response.once('drain', drained); response.once('close', failed); response.once('error', failed);
    if (response.destroyed) failed();
  });
}
function mediaSender(stream) {
  return new MediaSender(chunk => {
    if (!stream.media) throw new Error('BROWSER_MEDIA_CLOSED');
    return writeChunk(stream.media, chunk);
  }, scope => host.views.requestKeyframe(scope));
}
async function closeStream(id) {
  const stream = streams.get(id);
  if (!stream) return;
  streams.delete(id);
  snapshots.delete(`view:${id}`);
  for (const [requestID, request] of directoryRequests) if (request.view === id) {
    directoryRequests.delete(requestID); clearTimeout(request.timer);
    request.reject(new Error('BROWSER_VIEW_CLOSED'));
  }
  stream.sender.close();
  stream.dom.destroy();
  const media = stream.media;
  stream.media = undefined;
  media?.destroy();
  await host.views.closeView(id);
}
function admitInput(params) {
  const stream = streams.get(params.view);
  if (!stream) throw new Error('BROWSER_INPUT_UNAVAILABLE');
  const message = clientMessageSchema.parse(params.message);
  const input = message.type === 'command';
  const ack = code => writeDOM(stream, { type: 'ack', id: message.id, ok: false, code });
  // The Runtime admits input without waiting for its effect. Congestion rejects
  // only this new command; it neither revokes the lease nor closes observation.
  if (input && stream.pending >= MAX_PENDING_COMMANDS) { ack('busy'); return; }
  if (input) stream.pending++;
  // Resync and keyframe requests have no source input effect. The published SDK
  // coalesces them independently, including while the input queue is occupied.
  // An admitted stop/dialog reply can release an earlier awaited operation.
  void host.receive(params.view, params.token, message).catch(error => {
    if (streams.get(params.view) !== stream) return;
    if (error?.message === 'BROWSER_CONTROL_REVOKED' && input) { ack('not_allowed'); return; }
    failStream(params.view, 'input_failed');
  }).finally(() => { if (input) stream.pending--; });
}
function failStream(id, reason) {
  if (!streams.has(id)) return;
  emit({ type: 'view_fault', view: id, reason });
  void closeStream(id).catch(() => {});
}
function writeDOM(stream, message) {
  if (stream.dom.destroyed) return;
  const line = JSON.stringify(message) + '\n';
  const bytes = Buffer.byteLength(line);
  if (bytes > MAX_MESSAGE_BYTES || stream.dom.writableLength + bytes > MAX_MESSAGE_BYTES * 2) {
    failStream(stream.id, bytes > MAX_MESSAGE_BYTES ? 'dom_message_limit' : 'dom_backpressure');
    return;
  }
  stream.dom.write(line);
}

async function command(method, params) {
  if (method?.startsWith('view.') && method !== 'view.close') await streams.get(params.view)?.ready;
  switch (method) {
    case 'source.admit': return host.admit(params);
    case 'source.ready': return host.ready(params.target);
    case 'source.remove': return host.remove(params.target);
    case 'source.order': return host.order(params.targets, params.pinned);
    case 'source.inventory': return host.publicInventory(params.endpoint, params.tabs);
    case 'source.describe': return host.describe(params.targets);
    case 'source.close': return host.closePage(params.target);
    case 'source.restore': return host.restore(params.target, params.url);
    case 'source.cancel': return host.cancel(params.target);
    case 'source.tool': return host.tool(params.target, params.request);
    case 'view.grants': return host.views.grants(params.view, params.targets);
    case 'view.select': return host.views.select(params.view, params.target);
    case 'view.state': return host.views.state(params.view);
    case 'view.privacy': return host.views.privacy(params.target, params.view);
    case 'view.acquire': return host.views.acquire(params.view, params.target, params.token);
    case 'view.release': return host.views.release(params.view, params.token);
    case 'view.directory_decision': return host.views.directoryDecision(params.view, params.message);
    case 'view.receive': return admitInput(params);
    case 'view.audio': return host.views.audio(params.view, params.enabled);
    case 'view.visible': return host.views.visible(params.view, params.visible);
    case 'view.close': return closeStream(params.view);
    case 'media.ack': {
      const stream = streams.get(params.view);
      if (!stream?.media || !stream.sender.acknowledge(params.consumedBytes)) throw new Error('BROWSER_MEDIA_ACK_INVALID');
      return;
    }
    default: throw new Error('BROWSER_COMMAND_INVALID');
  }
}

const server = http.createServer((request, response) => {
  const operation = async () => {
    const url = new URL(request.url, 'http://runtime.invalid');
    const viewID = url.searchParams.get('view');
    if (closing) throw new Error('BROWSER_HOST_CLOSED');
    if (request.method === 'POST' && url.pathname === '/command') {
      const { id, method, params } = await bodyJSON(request);
      if (typeof id !== 'string' || !id || id.length > 128) throw new Error('BROWSER_REQUEST_INVALID');
      try { sendJSON(response, { id, result: await command(method, params) }); }
      catch (error) { sendJSON(response, { id, error: errorCode(error) }); }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/observe') {
      const spec = await bodyJSON(request, 32768);
      if (typeof spec.id !== 'string' || !spec.id || spec.id.length > 128 || !Array.isArray(spec.targets) || spec.targets.length > 128 || spec.targets.some(target => typeof target !== 'string')) throw new Error('BROWSER_REQUEST_INVALID');
      if (streams.has(spec.id)) throw new Error('BROWSER_VIEW_UNAVAILABLE');
      response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      response.flushHeaders();
      const stream = { id: spec.id, dom: response, media: undefined, sender: undefined, ready: undefined, pending: 0 };
      stream.sender = mediaSender(stream);
      streams.set(spec.id, stream);
      response.once('close', () => { void closeStream(spec.id).catch(() => emit({ type: 'view_fault', view: spec.id })); });
      try {
        stream.ready = host.views.open(spec.id, spec.targets, message => writeDOM(stream, message), {
          initialTab: spec.initialTab, editable: spec.editable === true, restoreClosedTabs: spec.restoreClosedTabs === true, media: false, audio: spec.audio === true, visible: spec.visible !== false,
          onMediaFrame: frame => stream.sender.push(frame),
          onMediaRetired: scope => stream.sender.retire(scope.target, scope.view, scope.stream),
        });
        await stream.ready;
      } catch (error) {
        await closeStream(spec.id);
        throw error;
      }
      return;
    }
    const stream = streams.get(viewID);
    if (!stream) throw new Error('BROWSER_VIEW_UNAVAILABLE');
    await stream.ready;
    if (streams.get(viewID) !== stream) throw new Error('BROWSER_VIEW_UNAVAILABLE');
    if (request.method === 'GET' && url.pathname === '/media') {
      if (stream.media) throw new Error('BROWSER_MEDIA_IN_USE');
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      response.flushHeaders();
      stream.sender.close();
      stream.media = response;
      stream.sender = mediaSender(stream);
      response.once('close', () => {
        if (stream.media !== response) return;
        stream.media = undefined;
        stream.sender.close();
        void Promise.resolve().then(() => host.views.media(viewID, false)).catch(() => {});
      });
      await host.views.media(viewID, true);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/resource') {
      const resource = await host.views.resource(viewID, url.searchParams.get('target'), url.searchParams.get('id'));
      if (!resource) throw new Error('BROWSER_RESOURCE_UNAVAILABLE');
      response.writeHead(200, { 'content-type': resource.type, 'content-length': resource.body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(resource.body);
      return;
    }
    const cancel = new AbortController();
    response.once('close', () => cancel.abort());
    if (request.method === 'POST' && url.pathname === '/upload') {
      const file = { name: url.searchParams.get('name'), size: Number(url.searchParams.get('size')), ...(url.searchParams.has('relativePath') ? { relativePath: url.searchParams.get('relativePath') } : {}) };
      const id = await host.views.upload(viewID, url.searchParams.get('token'), url.searchParams.get('chooser'), file, request, cancel.signal);
      sendJSON(response, { id });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/download') {
      const file = await host.views.download(viewID, url.searchParams.get('target'), url.searchParams.get('id'), cancel.signal);
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-browser-filename': encodeURIComponent(file.filename), ...(file.size === undefined ? {} : { 'content-length': file.size }) });
      for await (const chunk of file.body) await writeChunk(response, chunk);
      response.end();
      return;
    }
    throw new Error('BROWSER_ROUTE_INVALID');
  };
  void operation().catch(error => {
    if (!response.headersSent) sendJSON(response, { error: errorCode(error) }, 400);
    else response.destroy();
  });
});
server.on('connect', (request, socket, head) => {
  const id = request.headers['x-browser-source'];
  const tab = request.headers['x-browser-tab'];
  if (closing || request.url !== '/extension' || head.length || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(id) || typeof tab !== 'string' || !/^\d{1,10}$/u.test(tab) || extensions.has(id) || extensions.size >= 128) {
    socket.destroy(); return;
  }
  const transport = new ExtensionTransport(socket, tab);
  extensions.set(id, transport);
  transport.once('close', () => { if (extensions.get(id) === transport) extensions.delete(id); });
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
});
server.requestTimeout = 0;
server.headersTimeout = 10000;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
await chmod(socketPath, 0o600);
emit({ type: 'ready', protocol_version: 1, browser_protocol_version: PROTOCOL_VERSION, media_wire_version: MEDIA_WIRE_VERSION });
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
async function close() {
  if (closing) return closing;
  closing = (async () => {
    snapshots.clear();
    for (const transport of extensions.values()) transport.close();
    extensions.clear();
    for (const request of directoryRequests.values()) { clearTimeout(request.timer); request.reject(new Error('BROWSER_HOST_CLOSED')); }
    directoryRequests.clear();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    try { await host.close(); }
    finally { await bridge.close(); }
  })();
  return closing;
}
try {
  for await (const line of input) {
    if (line.length > 4096) break;
    const message = JSON.parse(line);
    const request = directoryRequests.get(message.id);
    if (message.type !== 'directory_reply' || typeof message.id !== 'string' || message.id.length > 128) break;
    // A closed view or expired operation can receive its one late result.
    if (!request) continue;
    directoryRequests.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error('BROWSER_DIRECTORY_FAILED'));
    else request.resolve(message.target);
  }
} finally { await close(); }
