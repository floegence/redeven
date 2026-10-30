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

const statusElement = document.querySelector('#status');
const resultElement = document.querySelector('#result');
async function render() {
  if (disposed) return;
  statusElement.textContent = status;
  resultElement.textContent = result;
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

document.querySelector('[data-redevplugin-action=hold-smoke]').addEventListener('click', () => void run('smoke.hold').catch(() => undefined));
bridge.onLifecycle((event) => {
  if (event.type === 'dispose') disposed = true;
});

void run('smoke.run').catch(() => undefined);
