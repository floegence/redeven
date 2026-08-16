import { PluginBridgeClient } from '@floegence/redevplugin-ui/plugin';

const params = new URLSearchParams(location.search);
const bridge = new PluginBridgeClient({ timeoutMs: 180_000 });
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const server = {
  http: Number(params.get('http') || __IO_SMOKE_HTTP_PORT__),
  ws: Number(params.get('ws') || __IO_SMOKE_WS_PORT__),
  tcp: Number(params.get('tcp') || __IO_SMOKE_TCP_PORT__),
  udp: Number(params.get('udp') || __IO_SMOKE_UDP_PORT__),
};

async function run(method) {
  await bridge.ready();
  status.textContent = method;
  try {
    const response = await bridge.call(method, { server });
    result.textContent = JSON.stringify(response.data ?? response, null, 2);
    status.textContent = 'ready';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

window.__ioSmokeHold = () => run('smoke.hold');

void run('smoke.run');
