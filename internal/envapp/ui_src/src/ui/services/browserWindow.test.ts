// @vitest-environment jsdom
import { MessageChannel } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserMessages } from '@floegence/floebrowser/viewer';
import type { Session } from '@floegence/flowersec-core';
import type { ProjectionConnection, ServerMessage } from '@floegence/floebrowser/protocol';
import type { BrowserCarrierOptions } from './browserTransport';

const state = vi.hoisted(() => ({
  api: vi.fn(),
  carrierOptions: undefined as BrowserCarrierOptions | undefined,
  receive: undefined as ((message: ServerMessage) => void | Promise<void>) | undefined,
  connection: undefined as ProjectionConnection | undefined,
}));
vi.mock('./sessionHTTP', () => ({ fetchSessionJSON: state.api }));
vi.mock('./browserTransport', () => ({
  createBrowserUpload: () => vi.fn(),
  createBrowserCarrier: (options: BrowserCarrierOptions) => {
    state.carrierOptions = options;
    return {
      subscribe: (listener: (message: ServerMessage) => void | Promise<void>) => { state.receive = listener; return () => undefined; },
      close: () => options.onClose(),
    };
  },
}));
vi.mock('@floegence/floebrowser/viewer', () => ({
  serveProjectionPorts: (_ports: unknown, connect: () => ProjectionConnection) => {
    state.connection = connect();
    return { close: () => state.connection?.close() };
  },
}));
import { createBrowserWindow } from './browserWindow';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });

async function fixture() {
  vi.stubGlobal('MessageChannel', MessageChannel);
  state.api.mockImplementation(() => Promise.resolve(undefined));
  const frame = document.createElement('iframe'); document.body.append(frame);
  const child = frame.contentWindow!;
  const delivered = vi.spyOn(child, 'postMessage').mockImplementation(() => undefined);
  const host = createBrowserWindow({
    session: {} as Session,
    view: { id: 'browser-view-test', initial_target: 'first', protocol_version: 22, media_wire_version: 1 },
    child: () => child,
    configuration: { type: 'redeven-browser-ports', nonce: 'nonce', title: 'Browser', locale: 'en-US', messages: {} as BrowserMessages, theme: {} },
    onReconnect: vi.fn(),
  });
  window.dispatchEvent(new MessageEvent('message', { source: child, origin: location.origin, data: { type: 'redeven-browser-ready', nonce: 'nonce' } }));
  const ports = (delivered.mock.calls[0] as unknown as [unknown, string, MessagePort[]])[2];
  const product = ports[2]!;
  cleanup = () => { host.close(); for (const port of ports) port.close(); };
  const received: ServerMessage[] = [];
  state.connection!.subscribe(message => { received.push(message); });
  await state.receive!({ type: 'hello', version: 22, mediaWireVersion: 1 });
  received.length = 0;
  let id = 0;
  const acquire = async (target = 'first') => {
    let resolve!: (value: { token: string }) => void;
    const promise = new Promise<{ token: string }>(done => { resolve = done; });
    const result = { promise, resolve };
    state.api.mockImplementationOnce(() => result.promise);
    const calls = state.api.mock.calls.length;
    const response = new Promise(resolve => { product.onmessage = event => resolve(event.data); });
    product.postMessage({ type: 'request', id: ++id, operation: { method: 'control', target, takeover: false, private: false } });
    await vi.waitFor(() => expect(state.api).toHaveBeenCalledTimes(calls + 1));
    return { ...result, response };
  };
  const token = (target = 'first') => state.carrierOptions!.controlToken({ type: 'command', id: 1, tab: target, epoch: 'epoch', action: { kind: 'reload' } });
  return { acquire, received, token };
}

it('admits source control only after its private token arrives, regardless of lane order', async () => {
  const { acquire, received, token } = await fixture();
  const first = await acquire();
  await state.receive!({ type: 'control', target: 'first', active: true });
  expect(received).toEqual([]);
  expect(token()).toBe('');
  first.resolve({ token: 'first-token' });
  await vi.waitFor(() => expect(received).toEqual([{ type: 'control', target: 'first', active: true }]));
  expect(token()).toBe('first-token');
  await state.receive!({ type: 'control', target: 'first', active: false });
  expect(token()).toBe('');
  received.length = 0;
  const next = await acquire();
  next.resolve({ token: 'next-token' });
  await vi.waitFor(() => expect(token()).toBe('next-token'));
  expect(received).toEqual([]);
  await state.receive!({ type: 'control', target: 'first', active: true });
  expect(received).toEqual([{ type: 'control', target: 'first', active: true }]);
});

it('forwards revocation while token delivery is pending and never revives its stale grant', async () => {
  const { acquire, received, token } = await fixture();
  const pending = await acquire();
  await state.receive!({ type: 'control', target: 'first', active: true });
  await state.receive!({ type: 'control', target: 'first', active: false });
  expect(received).toEqual([{ type: 'control', target: 'first', active: false }]);
  pending.resolve({ token: 'late-token' });
  await pending.response;
  expect(token()).toBe('');
  expect(received).toEqual([{ type: 'control', target: 'first', active: false }]);
});

it('discards a held grant and delayed credentials when the selected target changes', async () => {
  const { acquire, received, token } = await fixture();
  const pending = await acquire();
  await state.receive!({ type: 'control', target: 'first', active: true });
  await state.receive!({ type: 'tabs', state: { active: 'second', tabs: [] } });
  pending.resolve({ token: 'stale-token' });
  await pending.response;
  expect(token()).toBe('');
  expect(received.some(message => message.type === 'control' && message.active)).toBe(false);
});
