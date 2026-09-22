import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { ExtensionTransport } from './computerExtensionTransport.mjs';

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
async function* messages(socket) {
  let buffered = Buffer.alloc(0);
  for await (const chunk of socket) {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4 && buffered.length >= buffered.readUInt32LE() + 4) {
      const size = buffered.readUInt32LE();
      yield JSON.parse(buffered.subarray(4, size + 4).toString());
      buffered = buffered.subarray(size + 4);
    }
  }
}
async function fixture(t, options) {
  const server = net.createServer(options);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const connected = once(server, 'connection');
  const peer = net.connect(server.address().port, '127.0.0.1');
  const [socket] = await connected;
  const transport = new ExtensionTransport(socket, '42');
  t.after(() => { transport.close(); peer.destroy(); server.close(); });
  return { peer, transport, incoming: messages(peer) };
}

test('extension transport frames fragmented replies and credits events after delivery', async t => {
  const { peer, transport, incoming } = await fixture(t);
  const reply = transport.send('Page.getFrameTree');
  const { value: request } = await incoming.next();
  assert.equal(request.method, 'Page.getFrameTree');
  const value = frame({ id: request.id, result: { frameTree: { frame: { id: 'root' } } }, sequence: 1 });
  peer.write(value.subarray(0, 2)); peer.write(value.subarray(2, 7)); peer.write(value.subarray(7));
  assert.deepEqual(await reply, { frameTree: { frame: { id: 'root' } } });
  assert.deepEqual((await incoming.next()).value, { ack: 1 });
  const child = transport.child('child');
  const event = once(child, 'Page.frameNavigated');
  peer.write(frame({ type: 'cdp_event', session: 'child', method: 'Page.frameNavigated', params: { frame: { id: 'child-frame' } }, sequence: 2 }));
  assert.equal((await event)[0].frame.id, 'child-frame');
  assert.deepEqual((await incoming.next()).value, { ack: 2 });
  transport.removeChild('child');
  peer.write(frame({ type: 'cdp_event', session: 'child', method: 'Page.frameNavigated', params: {}, sequence: 3 }));
  assert.deepEqual((await incoming.next()).value, { ack: 3 });
  assert.equal(transport.children.size, 0, 'Late events cannot recreate an iframe transport');
});

test('loss and oversized native frames reject a pending command without replay', async t => {
  for (const kind of ['disconnect', 'oversized']) await t.test(kind, async t => {
    const { peer, transport, incoming } = await fixture(t);
    const request = transport.send('Input.dispatchMouseEvent', { type: 'mousePressed' });
    const rejected = assert.rejects(request, /BROWSER_SOURCE_UNAVAILABLE/);
    const sent = (await incoming.next()).value;
    assert.equal(sent.id, '1');
    if (kind === 'disconnect') peer.destroy();
    else { const header = Buffer.alloc(4); header.writeUInt32LE(24 * 1024 * 1024 + 1); peer.write(header); }
    await rejected;
    assert.equal(transport.closed, true);
    await assert.rejects(transport.send('Input.dispatchMouseEvent', {}), /BROWSER_SOURCE_UNAVAILABLE/);
  });
});

test('outgoing CDP commands respect the native-host one MiB boundary', async t => {
  const { transport } = await fixture(t);
  await assert.rejects(transport.send('Runtime.evaluate', { expression: 'x'.repeat(1024 * 1024) }), /BROWSER_SOURCE_UNAVAILABLE/);
  assert.equal(transport.closed, true);
});


test('Runtime EOF retires an upgraded half-open source socket immediately', async t => {
  const { peer, transport, incoming } = await fixture(t, { allowHalfOpen: true });
  const rejected = assert.rejects(transport.send('Page.close'), /BROWSER_SOURCE_UNAVAILABLE/);
  await incoming.next();
  const closed = once(transport, 'close', { signal: AbortSignal.timeout(1000) });
  peer.end();
  await closed;
  await rejected;
  assert.equal(transport.closed, true);
  assert.equal(transport.pending.size, 0);
});
