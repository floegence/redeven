import process from 'node:process';
import http from 'node:http';
import path from 'node:path';
import { chmod } from 'node:fs/promises';
import readline from 'node:readline';
import { ExtensionTransport } from './computerExtensionTransport.mjs';
import { createComputerBrowserHost } from './computerBrowserHost.mjs';

// The Runtime alone can reach this private Unix socket. Browser sources and
// extension transports never accept commands directly from a renderer.
const socketPath = process.argv[2];
if (!path.isAbsolute(socketPath || '')) throw new Error('BROWSER_HOST_SOCKET_REQUIRED');
const extensions = new Map();
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let closing;
const host = await createComputerBrowserHost({
  extensionTransport: id => extensions.get(id),
  onSourceClosed: (target, binding) => emit({ type: 'source_closed', target, binding }),
  onSourceFault: (target, binding) => emit({ type: 'source_fault', target, binding }),
  onSourcePopup: (target, tab_id) => emit({ type: 'source_popup', target, tab_id }),
});

async function bodyJSON(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new Error('BROWSER_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function sendJSON(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
function errorCode(error) {
  // Debugger exceptions can contain page text, endpoints, or credentials.
  return /^BROWSER_[A-Z_]+$/u.test(error?.message ?? '') ? error.message : 'BROWSER_HOST_COMMAND_FAILED';
}
async function command(method, params) {
  switch (method) {
    case 'source.admit': return host.admit(params);
    case 'source.ready': return host.ready(params.target);
    case 'source.remove': return host.remove(params.target);
    case 'source.inventory': return host.publicInventory(params.endpoint, params.tabs);
    case 'source.cancel': return host.cancel(params.target);
    case 'source.tool': return host.tool(params.target, params.request);
    case 'source.privacy': return host.privacy(params.target, params.private);
    default: throw new Error('BROWSER_COMMAND_INVALID');
  }
}

const server = http.createServer((request, response) => {
  void (async () => {
    if (closing || request.method !== 'POST' || request.url !== '/command') throw new Error('BROWSER_ROUTE_INVALID');
    const { id, method, params } = await bodyJSON(request);
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('BROWSER_REQUEST_INVALID');
    try { sendJSON(response, { id, result: await command(method, params) }); }
    catch (error) { sendJSON(response, { id, error: errorCode(error) }); }
  })().catch(error => sendJSON(response, { error: errorCode(error) }, 400));
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
emit({ type: 'ready', protocol_version: 1 });

async function close() {
  if (closing) return closing;
  closing = (async () => {
    for (const transport of extensions.values()) transport.close();
    extensions.clear();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await host.close();
  })();
  return closing;
}
try {
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (line.length > 4096) break;
  }
} finally { await close(); }
