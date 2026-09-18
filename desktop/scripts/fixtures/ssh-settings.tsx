import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { createDesktopI18n, type RedevenLocale } from '../../src/shared/i18n';
import { SSHEnvironmentSettingsForm } from '../../src/welcome/SSHEnvironmentSettingsForm';
import { EnvironmentSettingsDialog, EnvironmentSettingsPanel } from '../../src/welcome/EnvironmentSettingsDialog';
import type { DesktopEnvironmentEntry } from '../../src/shared/desktopLauncherIPC';
import type { EnvironmentSettingsTab } from '../../src/welcome/environmentSettingsSession';
import {
  validateSSHEnvironmentSettings,
  type SSHConnectionDialogState,
} from '../../src/welcome/sshEnvironmentSettingsState';
import '../../src/welcome/index.css';

document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
const query = new URLSearchParams(location.search);
const locale = (query.get('locale') || 'en-US') as RedevenLocale;
const initial: SSHConnectionDialogState = {
  mode: 'edit',
  connection_kind: 'ssh_environment',
  environment_id: 'acceptance-ssh',
  label: 'gzcom',
  ssh_destination: 'gzcom',
  ssh_port: '',
  auth_mode: 'key_agent',
  ssh_password: '',
  ssh_password_mode: 'keep',
  ssh_password_configured: true,
  baseline_ssh_destination: 'gzcom',
  baseline_ssh_port: '',
  baseline_auth_mode: 'key_agent',
  runtime_root: '',
  bootstrap_strategy: 'auto',
  release_base_url: '',
  connect_timeout_seconds: '10',
  auto_runtime_probe_enabled: true,
};
function Fixture() {
  const theme = useTheme();
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal(initial);
  const [baseline, setBaseline] = createSignal(initial);
  const [tab, setTab] = createSignal<EnvironmentSettingsTab>('connection');
  const environment = { id: initial.environment_id, label: initial.label, registration_ref: { kind: 'runtime_target', id: initial.environment_id } } as DesktopEnvironmentEntry;
  const [errors, setErrors] = createSignal<Partial<Record<string, string>>>({});
  const [error, setError] = createSignal('');
  const [saved, setSaved] = createSignal('');
  const i18n = createDesktopI18n(locale);
  return (
    <>
      <button
        id="fixture-open"
        onClick={() => {
          const preset = builtInShellThemePresets.find((preset) => preset.name === query.get('preset'));
          theme.selectShellTheme(
            preset?.mode ?? (query.get('theme') === 'light' ? 'light' : 'dark'),
            preset?.name ?? (query.get('theme') === 'light' ? 'classic-light' : 'ocean'),
          );
          setState({ ...initial });
          setBaseline(initial);
          setTab('connection');
          setErrors({});
          setError('');
          setOpen(true);
        }}
      >
        Edit environment
      </button>
      <output id="fixture-saved">{saved()}</output>
      <EnvironmentSettingsDialog open={open()} environment={environment} i18n={i18n} tab={tab()} onTabChange={setTab} onClose={() => setOpen(false)}
        access={<EnvironmentSettingsPanel footer={<button onClick={() => setOpen(false)}>{i18n.t('common.close')}</button>}><label for="fixture-access-draft">{i18n.t('settings.portLabel')}</label><input id="fixture-access-draft" value="23998" /></EnvironmentSettingsPanel>}
        connection={<SSHEnvironmentSettingsForm
        open={open()}
        i18n={i18n}
        state={state()}
        baseline={baseline()}
        fieldErrors={errors()}
        error={error()}
        saving={false}
        sshConfigHosts={[
          { alias: 'gzcom', host_name: 'gzcom.example.com', user: 'dev', port: 22, source_path: '~/.ssh/config' },
          {
            alias: 'production',
            host_name: 'prod.example.com',
            user: 'dev',
            port: 2222,
            source_path: '~/.ssh/config',
          },
        ]}
        sshConfigHostsLoading={false}
        sshConfigHostsLoadError={false}
        refreshSSHConfigHosts={() => undefined}
        updateField={(name, value) => {
          setState((current) => ({
            ...current,
            [name]: value,
            ...(name === 'ssh_password' ? ({ ssh_password_mode: value ? 'replace' : 'keep' } as const) : {}),
          }));
          setErrors((current) => {
            const next = { ...current };
            delete next[name];
            return next;
          });
        }}
        switchBootstrapStrategy={(value) => setState((current) => ({ ...current, bootstrap_strategy: value }))}
        toggleAutoRuntimeProbe={(value) => setState((current) => ({ ...current, auto_runtime_probe_enabled: value }))}
        removeSSHPassword={() =>
          setState((current) => ({ ...current, ssh_password: '', ssh_password_mode: 'clear' }))
        }
        onClose={() => setOpen(false)}
        onSave={async () => {
          const validation = validateSSHEnvironmentSettings(state(), i18n);
          setErrors(validation);
          if (Object.keys(validation).length) return;
          if (query.has('fail-save')) {
            setError('The fixture could not save this environment.');
            return;
          }
          setSaved(JSON.stringify(state()));
          setBaseline({ ...state() });
        }}
      />} />
    </>
  );
}
render(
  () => (
    <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}>
      <Fixture />
    </FloeProvider>
  ),
  document.getElementById('root')!,
);
