import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from '../../src/welcome/App';
import type { DesktopWelcomeSnapshot } from '../../src/shared/desktopLauncherIPC';
import type { DesktopSettingsResult } from '../../src/shared/settingsIPC';
import { buildDesktopSettingsSurfaceSnapshot } from '../../src/main/settingsPageContent';
import '../../src/welcome/index.css';

declare global {
  interface Window {
    settingsFixtureSnapshot: DesktopWelcomeSnapshot;
    settingsFixture: { loads: number; resolveOld: () => void };
  }
}
document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
const snapshot = window.settingsFixtureSnapshot;
let resolveOld: () => void = () => {};
window.settingsFixture = { loads: 0, resolveOld: () => resolveOld() };
const settings: DesktopWelcomeRuntime['settings'] = {
  async load({ environment_id }) {
    const environment = snapshot.environments.find(entry => entry.id === environment_id)!;
    const result: DesktopSettingsResult = { ok: true, snapshot: buildDesktopSettingsSurfaceSnapshot('environment_settings', {
      local_ui_bind: 'localhost:23998', local_ui_protocol: 'http', local_ui_password: '', local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true,
    }, { environment_id, environment_label: environment.label, environment_kind: 'runtime_target',
      runtime_connection: { host_access: environment.managed_runtime_host_access!, placement: environment.managed_runtime_placement! },
      current_runtime_running: true, current_runtime_urls: ['http://localhost:23998/'], current_runtime_url: 'http://localhost:23998/' }) };
    const attempt = ++window.settingsFixture.loads;
    if (attempt === 2) return { ok: false, error: 'SSH connection refused: orange:22', code: 'SSH_CONNECTION_REFUSED' };
    if (attempt === 3) return new Promise(resolve => { resolveOld = () => resolve(result); });
    return result;
  },
  async save(request) { return settings.load(request); }, cancel() {},
  async requestRuntimeFlower() { return { ok: false, error: { message: 'Fixture has no Flower runtime.' } }; },
};
render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
  getSnapshot: async () => snapshot, subscribeSnapshot: () => () => {}, getSSHConfigHosts: async () => [],
  performAction: async () => ({ ok: true, outcome: 'saved_environment' }),
} }} />, document.getElementById('root')!);
