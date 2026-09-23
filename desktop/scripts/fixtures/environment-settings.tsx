import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from '../../src/welcome/App';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionRequest, DesktopLauncherActionResult } from '../../src/shared/desktopLauncherIPC';
import type { DesktopSettingsResult } from '../../src/shared/settingsIPC';
import { buildDesktopSettingsSurfaceSnapshot } from '../../src/main/settingsPageContent';
import { runtimeLifecycleProgress } from '../../src/shared/desktopRuntimeLifecycleProgress';
import '../../src/welcome/index.css';

declare global {
  interface Window {
    settingsFixtureSnapshot: DesktopWelcomeSnapshot;
    settingsFixture: { requests: DesktopLauncherActionRequest[]; loads: number; resolveOld: () => void; publish: (value: DesktopWelcomeSnapshot) => void; beforeAction?: () => Promise<void>; saves?: number; progress?: (status: 'running' | 'succeeded' | 'failed' | 'canceled') => void; failAdmission?: () => void };
  }
}
document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
let snapshot = window.settingsFixtureSnapshot;
const restartHandoff = new URLSearchParams(location.search).has('restart-handoff');
const savedDrafts = new Map<string, import('../../src/shared/settingsIPC').DesktopSettingsDraft>();
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
      ...savedDrafts.get(environment_id),
    }, { environment_id, environment_label: environment.label, environment_kind: 'runtime_target',
      runtime_connection: { host_access: environment.managed_runtime_host_access!, placement: environment.managed_runtime_placement! },
      current_runtime_running: true, current_runtime_urls: ['http://localhost:23998/'], current_runtime_url: 'http://localhost:23998/' }) };
    const attempt = ++window.settingsFixture.loads;
    if (restartHandoff) return result;
    if (denyAccess) return attempt === 1 ? {
      ok: false, status_code: 401, code: 'RUNTIME_CONTROL_HTTP_ERROR',
      error: 'Runtime control returned HTTP 401: Desktop-only Local UI bridge; open this Environment from Desktop',
    } : result;
    if (attempt === 2) return { ok: false, error: 'SSH connection refused: orange:22', code: 'SSH_CONNECTION_REFUSED' };
    if (attempt === 3) return new Promise(resolve => { resolveOld = () => resolve(result); });
    return result;
  },
  async save(request) {
    window.settingsFixture.saves = (window.settingsFixture.saves ?? 0) + 1;
    savedDrafts.set(request.environment_id, request.draft);
    return settings.load(request);
  }, cancel() {},
  async requestRuntimeFlower() { return { ok: false, error: { message: 'Fixture has no Flower runtime.' } }; },
};
render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
  getSnapshot: async () => snapshot, subscribeSnapshot: listener => { receiveSnapshot = listener; return () => { receiveSnapshot = undefined; }; }, getSSHConfigHosts: async () => [],
  performAction: async request => {
    window.settingsFixture.requests.push(request);
    await window.settingsFixture.beforeAction?.();
    if (restartHandoff && request.kind === 'restart_environment_runtime') {
      return new Promise<DesktopLauncherActionResult>(resolve => {
        const environment = snapshot.environments.find(entry => entry.id === request.environment_id)!;
        const location = environment.registration_ref?.kind === 'local_environment' ? 'local_host'
          : environment.kind === 'wsl_environment' ? 'wsl_host'
          : environment.managed_runtime_placement?.kind === 'container_process' ? 'local_container' : 'ssh_host';
        window.settingsFixture.progress = status => {
          const phase = status === 'succeeded' ? 'runtime_ready' : 'stopping_runtime_process';
          window.settingsFixture.publish({ ...snapshot, action_progress: [{
            action: request.kind, environment_id: environment.id, environment_label: environment.label,
            operation_key: request.operation_key, started_at_unix_ms: request.operation_started_at_unix_ms,
            status, phase, title: 'Restart Runtime', detail: status === 'failed' ? 'Fixture restart rejected' : '',
            active_progress_surface: 'runtime_lifecycle', cancelable: status === 'running',
            lifecycle_progress: runtimeLifecycleProgress({ location, operation: 'restart', phase,
              targetID: environment.id, targetLabel: environment.label,
              stepStates: [
                { id: 'stopping_runtime_process', status: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : 'running' },
                { id: 'starting_runtime_process', status: status === 'succeeded' ? 'succeeded' : 'pending' },
                { id: 'checking_runtime_service', status: status === 'succeeded' ? 'succeeded' : 'pending' },
                { id: 'runtime_ready', status: status === 'succeeded' ? 'succeeded' : 'pending' },
              ],
            }),
          }] });
          if (status !== 'running') resolve(status === 'succeeded'
            ? { ok: true, outcome: 'restarted_environment_runtime' }
            : { ok: false, code: 'action_invalid', scope: 'environment', message: 'Fixture restart rejected' });
        };
        window.settingsFixture.failAdmission = () => resolve({ ok: false, code: 'action_invalid', scope: 'environment', message: 'Fixture admission refused' });
      });
    }
    if (restartHandoff && request.kind === 'cancel_launcher_operation') {
      window.settingsFixture.progress?.('canceled');
      return { ok: true, outcome: 'canceled_launcher_operation' };
    }
    return { ok: true, outcome: 'saved_environment' };
  },
} }} />, document.getElementById('root')!);
