import { createSignal, onMount, Show } from 'solid-js';
import {
  FloeProvider,
  useTheme,
  builtInShellThemePresets,
} from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { TwoFactorSettings } from '../../src/welcome/TwoFactorSettings';
import { createDesktopI18n } from '../../src/shared/i18n';
import type {
  SecurityRequest,
  SecurityResult,
} from '../../src/shared/runtimeSecurity';
import { EnvironmentSettingsDialog } from '../../src/welcome/EnvironmentSettingsDialog';
import { EnvironmentAccessSettingsForm } from '../../src/welcome/App';
import { buildDesktopSettingsSurfaceSnapshot } from '../../src/main/settingsPageContent';
import { IDLE_LAUNCHER_BUSY_STATE } from '../../src/welcome/launcherBusyState';
import type { DesktopSettingsDraft } from '../../src/shared/settingsIPC';
import type { DesktopEnvironmentEntry } from '../../src/shared/desktopLauncherIPC';
import '../../src/welcome/index.css';
// Browser fixtures have no native Desktop titlebar.
document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '0px');
const query = new URLSearchParams(location.search);
const i18n = createDesktopI18n(query.get('locale') ?? 'en-US');
const requests: SecurityRequest[] = [];
Object.assign(window, { securityRequests: requests });
let status: SecurityResult = {
  https_ready: !query.has('http'),
  enabled: false,
  password_configured: !query.has('new-password'),
  recovery_pending: false,
  recovery_codes_remaining: 0,
  revision: 1,
};
async function manage(request: SecurityRequest): Promise<SecurityResult> {
  requests.push(request);
  if (request.action === 'setup')
    return {
      ...status,
      operation_id: 'acceptance',
      secret: 'JBSWY3DPEHPK3PXP',
      qr_image:
        'data:image/png;base64,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',
    };
  if (request.action === 'verify' && query.has('error')) throw new Error('ACCESS_FACTOR_INVALID');
  if (request.action === 'verify')
    return {
      ...status,
      operation_id: 'acceptance',
      recovery_codes: Array.from(
        { length: 8 },
        (_, index) => `0000000${index}-11111111-22222222-33333333`,
      ),
    };
  if (request.action === 'commit')
    status = {
      ...status,
      enabled: true,
      password_configured: true,
      recovery_codes_remaining: 8,
      revision: 2,
    };
  return status;
}
const draft: DesktopSettingsDraft = {
  local_ui_bind: 'localhost:23998',
  local_ui_protocol: query.has('http') ? 'http' : 'https',
  local_ui_password: '',
  local_ui_password_mode: 'keep',
  auto_runtime_probe_enabled: true,
};
const snapshot = buildDesktopSettingsSurfaceSnapshot(
  'environment_settings',
  draft,
  {
    environment_id: 'acceptance',
    environment_label: 'Studio',
    environment_kind: 'local',
    local_ui_password_configured: true,
    current_runtime_running: true,
    current_runtime_urls: ['https://localhost:23998/'],
    current_runtime_url: 'https://localhost:23998/',
    runtime_connection: {
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
    },
  },
);
function Fixture() {
  const [currentDraft, setCurrentDraft] = createSignal(draft);
  const [currentSnapshot, setCurrentSnapshot] = createSignal(snapshot);
  let certificateReady = false;
  const theme = useTheme();
  onMount(() =>
    queueMicrotask(() => {
      const dark = query.get('theme') === 'dark';
      theme.selectShellTheme(
        dark ? 'dark' : 'light',
        dark ? 'ocean' : 'classic-light',
      );
    }),
  );
  return (
    <Show
      when={query.has('full')}
      fallback={
        <main class="mx-auto max-w-2xl p-4">
          <TwoFactorSettings configureHTTPS={() => {}}
            environmentID="acceptance"
            i18n={i18n}
            manage={manage}
          />
        </main>
      }
    >
      <EnvironmentSettingsDialog
        open
        environment={
          {
            id: 'acceptance',
            label: 'Studio',
            registration_ref: { kind: 'local_environment', id: 'acceptance' },
          } as DesktopEnvironmentEntry
        }
        tab="access"
        i18n={i18n}
        onClose={() => {}}
        onTabChange={() => {}}
        connection={null}
        access={
          <EnvironmentAccessSettingsForm
            open
            snapshot={currentSnapshot()}
            baselineSnapshot={currentSnapshot()}
            draft={currentDraft()}
            i18n={i18n}
            busyState={IDLE_LAUNCHER_BUSY_STATE}
            settingsError=""
            settingsErrorRef={() => {}}
            updateDraftField={(name, value) => setCurrentDraft(previous => ({ ...previous, [name]: value }))}
            applyAccessMode={() => {}}
            applyAccessFixedPort={() => {}}
            toggleAutoPort={() => {}}
            saveSettings={async (options) => {
              if (options?.restartRuntime) status = { ...status, https_ready: true };
              setCurrentSnapshot(previous => ({ ...previous, draft: currentDraft(), runtime_started_at_unix_ms: options?.restartRuntime ? 2 : 1 }));
            }}
            certificate={async request => {
              if (request.operation === 'generate') certificateReady = true;
              return { status: 'ready', code: '', identity: certificateReady ? 'ready' : 'missing', certificate_kind: 'server', can_manage: true };
            }}
            runtimeRestartAvailable
            runtimeRunning
            runtimeStatusLabel="Running"
            runtimeStatusTone="neutral"
            dark={theme.resolvedTheme() === 'dark'}
            desktopOpenLabel="Open Env App"
            openInDesktop={() => {}}
            openInBrowser={async () => {}}
            copyEnvironmentValue={async () => {}}
            cancelSettings={() => {}}
            clearStoredLocalUIPassword={() => {}}
            security={manage}
          />
        }
      />
    </Show>
  );
}
render(
  () => (
    <FloeProvider
      config={{
        theme: {
          shellPresets: builtInShellThemePresets,
          defaultSurfaceStyle: 'soft-neumorphic',
        },
      }}
    >
      <Fixture />
    </FloeProvider>
  ),
  document.getElementById('root')!,
);
