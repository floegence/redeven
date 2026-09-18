import { For, createMemo, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { EndpointsPopover, EnvironmentAccessSettingsForm } from '../../src/welcome/App';
import { EnvironmentSettingsDialog } from '../../src/welcome/EnvironmentSettingsDialog';
import type { DesktopEnvironmentEntry } from '../../src/shared/desktopLauncherIPC';
import { buildRuntimeConnectionRows, type DesktopRuntimeConnectionContext } from '../../src/shared/desktopEnvironmentConnection';
import { createDesktopI18n, type RedevenLocale } from '../../src/shared/i18n';
import { buildDesktopSettingsSurfaceSnapshot } from '../../src/main/settingsPageContent';
import { applyDesktopAccessModeToDraft, applyDesktopAccessFixedPortToDraft, applyDesktopAccessAutoPortToDraft } from '../../src/shared/desktopAccessModel';
import type { DesktopSettingsDraft } from '../../src/shared/settingsIPC';
import { IDLE_LAUNCHER_BUSY_STATE } from '../../src/welcome/launcherBusyState';
import '../../src/welcome/index.css';

document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '0px');
const query = new URLSearchParams(location.search);
const names = ['Local Environment', 'gzcom', 'gzlight', 'Network'];
const context = (name: string): DesktopRuntimeConnectionContext => ({
  host_access: !name || name === 'Local Environment' ? { kind: 'local_host' } : {
    kind: 'ssh_host', ssh: { ssh_destination: name === 'Network' ? 'gzcom' : name, ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 },
  },
  placement: { kind: 'host_process', runtime_root: '~/.redeven' },
});
const address = (name: string) => name === 'Network' ? 'https://192.0.2.20:23998/' : 'http://localhost:23998/';
const initialDraft: DesktopSettingsDraft = { local_ui_bind: 'localhost:23998', local_ui_protocol: 'http', local_ui_password: '', local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true };

function Fixture() {
  // Chinese copy exercises the shipped localized connection surface.
  const i18n = createDesktopI18n((query.get('locale') || 'zh-CN') as RedevenLocale);
  const theme = useTheme();
  onMount(() => {
    const dark = query.get('theme') === 'dark';
    const preset = builtInShellThemePresets.find(entry => entry.name === query.get('preset'));
    const mode = preset?.mode === 'light' || preset?.mode === 'dark' ? preset.mode : dark ? 'dark' : 'light';
    theme.selectShellTheme(mode, preset?.name ?? (dark ? 'ocean' : 'classic-light'));
  });
  const [active, setActive] = createSignal('');
  const [selected, setSelected] = createSignal<{ host: string; id: string } | null>(null);
  const [settings, setSettings] = createSignal('');
  const [draft, setDraft] = createSignal(initialDraft);
  const [baseline, setBaseline] = createSignal(initialDraft);
  const [pending, setPending] = createSignal(false);
  const [saveError, setSaveError] = createSignal('');
  const [copied, setCopied] = createSignal('');
  const copy = async (value: string) => { setCopied(value); };
  const surface = createMemo(() => ({ ...buildDesktopSettingsSurfaceSnapshot('environment_settings', baseline(), {
    environment_id: settings(), environment_label: settings(), environment_kind: settings() === 'Local Environment' ? 'local' : 'runtime_target',
    runtime_connection: context(settings()),
    current_runtime_running: true, current_runtime_url: address(settings()), current_runtime_urls: [address(settings())],
  }), runtime_configuration_pending: pending() }));
  return <main style={{ padding: '32px', 'min-height': '100vh' }}>
    <h1 style={{ 'font-size': '20px', 'margin-bottom': '24px' }}>Environment connection acceptance</h1>
    <div style={{ display: 'grid', gap: '24px', 'grid-template-columns': 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      <For each={names}>{(name) => <article data-environment={name} class="redeven-environment-card rounded-lg border p-4">
        <h2 class="mb-4 font-semibold">{name}</h2>
        <div class="flex items-center justify-between gap-3">
          <span>{i18n.t('environmentFacts.runsOn')}</span>
          <EndpointsPopover environmentLabel={query.get('label') || name} i18n={i18n}
            endpoints={buildRuntimeConnectionRows({ context: context(name), urls: name === 'Network' && query.has('multiple')
              ? ['https://development.environment.example.invalid:23998/a-long-environment-path?workspace=shared', 'https://192.0.2.20:23998/', 'http://[::1]:23998/'] : [address(name)],
              health: { status: 'online', freshness: 'fresh', source: 'ssh_runtime_probe', checked_at_unix_ms: 1 } })}
            open={active() === name} onOpenChange={(open) => {
              setActive(open ? name : '');
              if (!open) setSelected(null);
            }}
            selectedEndpointID={selected()?.host === name ? selected()?.id : undefined}
            selectEndpointForQRCode={(id) => setSelected({ host: name, id })} openInBrowser={copy} copyEnvironmentValue={copy} />
        </div>
        <button class="mt-6 cursor-pointer" onClick={() => { setActive(''); setDraft(initialDraft); setBaseline(initialDraft); setPending(false); setSaveError(''); setSettings(name); }}>{i18n.t('settings.settingsWindowTitle')}</button>
      </article>}</For>
    </div>
    <output data-copy-result class="mt-6 block font-mono">{copied()}</output>
    <EnvironmentSettingsDialog open={Boolean(settings())} environment={{ id: settings(), label: settings(), registration_ref: { kind: 'local_environment', id: settings() } } as DesktopEnvironmentEntry}
      tab="access" i18n={i18n} onTabChange={() => {}} onClose={() => setSettings('')} connection={null} access={<EnvironmentAccessSettingsForm open={Boolean(settings())} snapshot={surface()} baselineSnapshot={surface()} draft={draft()}
      i18n={i18n} busyState={IDLE_LAUNCHER_BUSY_STATE} settingsError={saveError()} settingsErrorRef={() => {}}
      updateDraftField={(name, value) => setDraft(previous => ({ ...previous, [name]: value }))}
      applyAccessMode={mode => setDraft(previous => applyDesktopAccessModeToDraft(previous, mode))}
      applyAccessFixedPort={port => setDraft(previous => applyDesktopAccessFixedPortToDraft(previous, port))}
      toggleAutoPort={enabled => setDraft(previous => applyDesktopAccessAutoPortToDraft(previous, enabled))}
      resetAccess={() => { setDraft(baseline()); setSaveError(''); }}
      saveSettings={async options => {
        if (query.has('save-error')) { setSaveError('Fixture: unable to save access settings.'); return; }
        setBaseline(draft()); setPending(!options?.restartRuntime);
      }}
      certificate={async () => ({ status: 'ready', code: 'local_ui_device_ca_ready', identity: 'ready', trust: 'trusted',
        can_manage: true, certificate_path: '/fixture/certificates/device-ca.pem' })}
      runtimeRestartAvailable runtimeRunning runtimeStatusLabel={i18n.t('environmentStatus.open')} runtimeStatusTone="success" dark={theme.resolvedTheme() === 'dark'}
      desktopOpenLabel={i18n.t('environmentAction.open')} openInDesktop={() => {}} openInBrowser={copy} copyEnvironmentValue={copy}
      cancelSettings={() => setSettings('')} clearStoredLocalUIPassword={() => setDraft(previous => ({ ...previous, local_ui_password: '', local_ui_password_mode: 'clear' }))} />} />
  </main>;
}
render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Fixture /></FloeProvider>, document.getElementById('root')!);
