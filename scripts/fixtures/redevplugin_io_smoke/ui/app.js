import { PluginBridgeClient } from '@floegence/redevplugin-ui/plugin';

const bridge = new PluginBridgeClient({ timeoutMs: 180_000 });
const server = {
  http: __IO_SMOKE_HTTP_PORT__,
  ws: __IO_SMOKE_WS_PORT__,
  tcp: __IO_SMOKE_TCP_PORT__,
  udp: __IO_SMOKE_UDP_PORT__,
};
let disposed = false;
let status = 'Connecting';
let result = '';

const text = (key, value) => ({ type: 'text', key, text: value });

async function render() {
  if (disposed) return;
  await bridge.render({
    type: 'element',
    key: 'io-smoke-root',
    tag: 'main',
    attributes: { class: 'io-smoke' },
    children: [
      {
        type: 'element',
        key: 'io-smoke-title',
        tag: 'h1',
        children: [text('io-smoke-title-text', 'I/O smoke')],
      },
      {
        type: 'element',
        key: 'io-smoke-status',
        tag: 'p',
        attributes: { role: 'status' },
        children: [text('io-smoke-status-text', status)],
      },
      {
        type: 'element',
        key: 'io-smoke-hold',
        tag: 'button',
        attributes: { type: 'button', 'data-redevplugin-action': 'hold-smoke' },
        children: [text('io-smoke-hold-text', 'Hold resources')],
      },
      {
        type: 'element',
        key: 'io-smoke-result',
        tag: 'pre',
        children: [text('io-smoke-result-text', result)],
      },
    ],
  });
}

async function run(method) {
  await bridge.ready();
  status = method;
  await render();
  try {
    const response = await bridge.call(method, { server });
    result = JSON.stringify(response.data ?? response, null, 2);
    status = 'ready';
  } catch (error) {
    status = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await render();
  }
}

bridge.onAction('hold-smoke', () => void run('smoke.hold').catch(() => undefined));
bridge.onLifecycle((event) => {
  if (event.type === 'dispose') disposed = true;
});

void run('smoke.run').catch(() => undefined);
