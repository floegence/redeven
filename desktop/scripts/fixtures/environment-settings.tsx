import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from '../../src/welcome/App';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionRequest } from '../../src/shared/desktopLauncherIPC';
import type { DesktopSettingsResult } from '../../src/shared/settingsIPC';
import { buildDesktopSettingsSurfaceSnapshot } from '../../src/main/settingsPageContent';
import '../../src/welcome/index.css';

declare global {
  interface Window {
    settingsFixtureSnapshot: DesktopWelcomeSnapshot;
    settingsFixture: { requests: DesktopLauncherActionRequest[]; loads: number; resolveOld: () => void; publish: (value: DesktopWelcomeSnapshot) => void; beforeAction?: () => Promise<void> };
  }
}
document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
let snapshot = window.settingsFixtureSnapshot;
const denyAccess = new URLSearchParams(location.search).has('deny-access');
let receiveSnapshot: ((value: DesktopWelcomeSnapshot) => void) | undefined;
let resolveOld: () => void = () => {};
window.settingsFixture = { requests: [], loads: 0, resolveOld: () => resolveOld(), publish(value) {
  snapshot = value;
  receiveSnapshot?.(value);
} };
const settings: DesktopWelcomeRuntime['settings'] = {
  async load({ environment_id }) {
    const environment = snapshot.environments.find(entry => entry.id === environment_id)!;
    const result: DesktopSettingsResult = { ok: true, snapshot: buildDesktopSettingsSurfaceSnapshot('environment_settings', {
      local_ui_bind: 'localhost:23998', local_ui_protocol: 'http', local_ui_password: '', local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true,
    }, { environment_id, environment_label: environment.label, environment_kind: 'runtime_target',
      runtime_connection: { host_access: environment.managed_runtime_host_access!, placement: environment.managed_runtime_placement! },
      current_runtime_running: true, current_runtime_urls: ['http://localhost:23998/'], current_runtime_url: 'http://localhost:23998/' }) };
    const attempt = ++window.settingsFixture.loads;
    if (denyAccess) return attempt === 1 ? {
      ok: false, status_code: 401, code: 'RUNTIME_CONTROL_HTTP_ERROR',
      error: 'Runtime control returned HTTP 401: Desktop-only Local UI bridge; open this Environment from Desktop',
    } : result;
    if (attempt === 2) return { ok: false, error: 'SSH connection refused: orange:22', code: 'SSH_CONNECTION_REFUSED' };
    if (attempt === 3) return new Promise(resolve => { resolveOld = () => resolve(result); });
    return result;
  },
  async save(request) { return settings.load(request); }, cancel() {},
  async requestRuntimeFlower() { return { ok: false, error: { message: 'Fixture has no Flower runtime.' } }; },
};
render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
  getSnapshot: async () => snapshot, subscribeSnapshot: listener => { receiveSnapshot = listener; return () => { receiveSnapshot = undefined; }; }, getSSHConfigHosts: async () => [],
  performAction: async request => {
    window.settingsFixture.requests.push(request);
    await window.settingsFixture.beforeAction?.();
    return { ok: true, outcome: 'saved_environment' };
  },
} }} />, document.getElementById('root')!);
