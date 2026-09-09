import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { createDesktopI18n, type RedevenLocale } from '../../src/shared/i18n';
import { SSHEnvironmentSettingsDialog } from '../../src/welcome/SSHEnvironmentSettingsDialog';
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
  const [errors, setErrors] = createSignal<Partial<Record<string, string>>>({});
  const [error, setError] = createSignal('');
  const [saved, setSaved] = createSignal('');
  const i18n = createDesktopI18n(locale);
  return (
    <>
      <button
        id="fixture-open"
        onClick={() => {
          theme.selectShellTheme(
            query.get('theme') === 'light' ? 'light' : 'dark',
            query.get('theme') === 'light' ? 'classic-light' : 'ocean',
          );
          setState({ ...initial });
          setErrors({});
          setError('');
          setOpen(true);
        }}
      >
        Edit environment
      </button>
      <output id="fixture-saved">{saved()}</output>
      <SSHEnvironmentSettingsDialog
        open={open()}
        i18n={i18n}
        state={state()}
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
          setOpen(false);
        }}
      />
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
