import { EventEmitter } from 'node:events';

const maxFrame = 24 * 1024 * 1024;

// One private framed socket per admitted personal tab. A broken or overloaded
// carrier retires the tab adapter; it never reconnects or repeats a command.
export class ExtensionTransport extends EventEmitter {
  constructor(socket, tabId) {
    super();
    this.socket = socket;
    this.tabId = tabId;
    this.children = new Map();
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    let header = Buffer.alloc(4), body, offset = 0;
    socket.on('data', chunk => {
      try {
        while (chunk.length && !this.closed) {
          const target = body ?? header;
          const count = Math.min(target.length - offset, chunk.length);
          chunk.copy(target, offset, 0, count); offset += count; chunk = chunk.subarray(count);
          if (offset !== target.length) continue;
          offset = 0;
          if (!body) {
            const size = header.readUInt32LE();
            if (!size || size > maxFrame) throw new Error('BROWSER_EXTENSION_FRAME_INVALID');
            body = Buffer.allocUnsafe(size);
          } else {
            const message = JSON.parse(body.toString('utf8')); body = undefined;
            this.receive(message);
          }
        }
      } catch { this.close(); }
    });
    // CONNECT sockets can remain writable after Runtime ends its input. EOF
    // retires this source immediately; no further replies or events can arrive.
    socket.on('end', () => this.close());
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
  }
  write(message) {
    if (this.closed) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
    const body = Buffer.from(JSON.stringify(message));
    if (body.length > 1000000 || this.socket.writableLength + body.length > 4 * 1024 * 1024) {
      this.close(); throw new Error('BROWSER_EXTENSION_COMMAND_LIMIT');
    }
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    this.socket.write(Buffer.concat([header, body]));
  }
  send(method, params = {}, session = '') {
    if (this.closed || this.pending.size >= 32) return Promise.reject(new Error('BROWSER_SOURCE_UNAVAILABLE'));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params, session }); }
      catch { this.close(); }
    });
  }
  child(session) {
    if (!this.children.has(session)) {
      const transport = new EventEmitter();
      transport.send = (method, params) => this.send(method, params, session);
      this.children.set(session, transport);
    }
    return this.children.get(session);
  }
  removeChild(session) { this.children.delete(session); }
  receive(message) {
    if (message.type === 'cdp_event') {
      const transport = message.session ? this.children.get(message.session) : this;
      // Child events can arrive after an already observed detach. The child is
      // retired, never recreated from a late event.
      transport?.emit(message.method, message.params);
      this.write({ ack: message.sequence });
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) throw new Error('BROWSER_EXTENSION_REPLY_INVALID');
    this.pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error('BROWSER_EXTENSION_COMMAND_FAILED'));
    else request.resolve(message.result ?? {});
    if (message.sequence) this.write({ ack: message.sequence });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('BROWSER_SOURCE_UNAVAILABLE')); }
    this.pending.clear();
    for (const child of this.children.values()) { child.emit('close'); child.removeAllListeners(); }
    this.children.clear();
    this.emit('close');
    this.removeAllListeners();
  }
}
