import { app, BrowserWindow, ipcMain } from 'electron';
import { startRuntimePlacementBridgeSession } from '../../src/main/runtimePlacementBridgeSession';
import { manageRuntimeGateway } from '../../src/main/runtimeControlClient';
import { normalizeDesktopLauncherActionRequest } from '../../src/shared/desktopLauncherIPC';

async function run() {
  await app.whenReady();
  const container = process.env.REDEVEN_GATEWAY_JOIN_CONTAINER!;
  const bridge = await startRuntimePlacementBridgeSession({
    host_access: { kind: 'local_host' },
    placement: {
      kind: 'container_process', container_engine: 'docker', container_id: container,
      container_ref: container, container_label: 'Gateway qualification',
      runtime_root: '/root/.redeven', runtime_state_root: process.env.REDEVEN_GATEWAY_JOIN_STATE_ROOT!,
      bridge_strategy: 'exec_stream',
    },
    runtime_binary_path: '/usr/local/bin/redeven',
  });
  if (!bridge.runtime_control) throw new Error('Trusted Runtime bridge is unavailable');
  const window = new BrowserWindow({ width: 440, height: 860, show: false, webPreferences: {
    preload: process.env.REDEVEN_GATEWAY_JOIN_PRELOAD, sandbox: true, contextIsolation: true,
    nodeIntegration: false, backgroundThrottling: false,
  } });
  ipcMain.handle('gateway-qualification:action', async (event, request) => {
    if (event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
      request?.kind !== 'manage_runtime_gateway' || request.runtime_target_id !== 'ssh:qualification') {
      return { ok: false, code: 'UNTRUSTED_TARGET' };
    }
    const action = normalizeDesktopLauncherActionRequest(request);
    if (action?.kind !== 'manage_runtime_gateway') return { ok: false, code: 'INVALID_MEMBERSHIP_ACTION' };
    try {
      const result = await manageRuntimeGateway(bridge.runtime_control!, action.operation, action.invitation, action.environment_choice);
      return { ok: true, gateway_membership: result };
    } catch { return { ok: false, code: 'GATEWAY_JOIN_FAILED' }; }
  });
  app.on('before-quit', () => { void bridge.disconnect(); });
  await window.loadURL(process.env.REDEVEN_GATEWAY_JOIN_RENDERER!);
  window.showInactive();
  console.log('Gateway qualification Electron ready');
}
run().catch(() => { console.error('Gateway qualification trusted bridge startup failed'); app.exit(1); });
