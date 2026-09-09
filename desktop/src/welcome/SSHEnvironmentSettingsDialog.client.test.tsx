import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createDesktopI18n } from '../shared/i18n';
import { SSHEnvironmentSettingsDialog } from './SSHEnvironmentSettingsDialog';
import { validateSSHEnvironmentSettings, type SSHConnectionDialogState } from './sshEnvironmentSettingsState';

const initial: SSHConnectionDialogState = {
  mode: 'edit',
  connection_kind: 'ssh_environment',
  environment_id: 'ssh-fixture',
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
const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  if (!element) throw new Error(`Button missing: ${label}`);
  return element;
}
function input(name: string, value: string) {
  const el = document.getElementById(`ssh-settings-${name}`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el;
}
async function mount(overrides: Partial<SSHConnectionDialogState> = {}, saveAction?: () => Promise<void>) {
  document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const host = document.createElement('div');
  document.body.append(host);
  const [state, setState] = createSignal<SSHConnectionDialogState>({ ...initial, ...overrides });
  const [open, setOpen] = createSignal(true);
  const [errors, setErrors] = createSignal<Partial<Record<string, string>>>({});
  const [error, setError] = createSignal('');
  const i18n = createDesktopI18n('en-US');
  const save = vi.fn(async () => {
    const result = validateSSHEnvironmentSettings(state(), i18n);
    setErrors(result);
    if (Object.keys(result).length) return;
    if (saveAction) await saveAction();
    else setError('Fixture save failed');
  });
  disposers.push(
    render(
      () => (
        <Show when={open()}>
          <SSHEnvironmentSettingsDialog
            i18n={i18n}
            state={state()}
            fieldErrors={errors()}
            error={error()}
            saving={false}
            sshConfigHosts={[
              { alias: 'production', host_name: 'example.com', user: 'dev', port: 2222, source_path: '~/.ssh/config' },
            ]}
            sshConfigHostsLoading={false}
            sshConfigHostsLoadError={false}
            refreshSSHConfigHosts={() => undefined}
            updateField={(name, value) => {
              setState((current) => ({ ...current, [name]: value }));
              setErrors((current) => {
                const next = { ...current };
                delete next[name];
                return next;
              });
            }}
            toggleAutoRuntimeProbe={(enabled) =>
              setState((current) => ({ ...current, auto_runtime_probe_enabled: enabled }))
            }
            switchBootstrapStrategy={(strategy) =>
              setState((current) => ({ ...current, bootstrap_strategy: strategy }))
            }
            removeSSHPassword={() =>
              setState((current) => ({ ...current, ssh_password: '', ssh_password_mode: 'clear' }))
            }
            onSave={save}
            onClose={() => setOpen(false)}
          />
        </Show>
      ),
      host,
    ),
  );
  await settle();
  return { state, setState, errors, save, open };
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SSH environment settings interactions', () => {
  it('keeps custom advanced values discoverable and the opening identity stable while editing', async () => {
    const harness = await mount({
      runtime_root: '/srv/redeven',
      release_base_url: 'https://mirror.example.com/releases',
      bootstrap_strategy: 'remote_install',
      connect_timeout_seconds: '30',
    });
    expect(document.querySelector('.ssh-settings-summary')?.textContent).toBe(
      'Remote Download & Install · Custom directory · Custom mirror · 30 s',
    );
    expect(document.getElementById('ssh-settings-runtime_root')).toBeNull();
    expect(button('Save changes').disabled).toBe(true);
    input('label', 'Renamed');
    expect(document.querySelector('[aria-describedby]')?.textContent).toContain('gzcom');
    expect(button('Save changes').disabled).toBe(false);
    button('AdvancedRemote Download & Install · Custom directory · Custom mirror · 30 s').click();
    await settle();
    expect((document.getElementById('ssh-settings-runtime_root') as HTMLInputElement).value).toBe('/srv/redeven');
    harness.setState((state) => ({ ...state, ssh_password_configured: false }));
    expect(document.getElementById('ssh-settings-runtime_root')).not.toBeNull();
  });

  it('protects a dirty draft from closing and leaves backdrop clicks inert', async () => {
    const harness = await mount();
    document.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!.click();
    expect(harness.open()).toBe(true);
    input('label', 'Production');
    button('Cancel').click();
    await settle();
    expect(document.getElementById('ssh-settings-keep-editing')).toBe(document.activeElement);
    button('Keep editing').click();
    expect((document.getElementById('ssh-settings-label') as HTMLInputElement).value).toBe('Production');
    button('Close').click();
    button('Discard changes').click();
    expect(harness.open()).toBe(false);
  });

  it('lets the SSH picker own Escape and Enter before dialog dismissal or save', async () => {
    const harness = await mount();
    const destination = input('ssh_destination', 'prod');
    destination.focus();
    await settle();
    expect(destination.getAttribute('aria-expanded')).toBe('true');
    destination.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(destination.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('ssh-settings-keep-editing')).toBeNull();
    destination.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    destination.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(harness.state().ssh_destination).toBe('production');
    expect(harness.state().ssh_port).toBe('2222');
    expect(harness.save).not.toHaveBeenCalled();
  });

  it('expands invalid advanced fields on save and preserves other field errors and the failed draft', async () => {
    const harness = await mount({ runtime_root: 'relative/path', connect_timeout_seconds: '0' });
    input('label', 'Changed');
    button('Save changes').click();
    await settle();
    expect(document.activeElement?.id).toBe('ssh-settings-runtime_root');
    const root = input('runtime_root', '/srv/redeven');
    expect(harness.errors().runtime_root).toBeUndefined();
    expect(harness.errors().connect_timeout_seconds).toBeTruthy();
    expect(document.activeElement).toBe(root);
    input('connect_timeout_seconds', '12');
    button('Save changes').click();
    await settle();
    expect(document.body.textContent).toContain('Fixture save failed');
    expect(harness.state().runtime_root).toBe('/srv/redeven');
    expect(button('Save changes').disabled).toBe(false);
  });

  it('handles password removal and automatic detection as unsaved edits', async () => {
    const harness = await mount();
    button('Password').click();
    expect(document.body.textContent).toContain('A password is saved on this device.');
    button('Remove stored password').click();
    expect(harness.state().ssh_password_mode).toBe('clear');
    expect(document.body.textContent).toContain('The stored SSH password will be removed on save.');
    document.querySelector<HTMLInputElement>('#ssh-settings-probe')!.click();
    expect(harness.state().auto_runtime_probe_enabled).toBe(false);
    expect(button('Save changes').disabled).toBe(false);
  });

  it('ignores composition and duplicate submissions while supporting the save shortcut', async () => {
    let finish: () => void = () => undefined;
    const harness = await mount(
      {},
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const name = input('label', 'Changed');
    name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }),
    );
    expect(harness.save).not.toHaveBeenCalled();
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(button('Cancel').disabled).toBe(true);
    button('Close').click();
    expect(harness.open()).toBe(true);
    finish();
    await settle();
    expect(button('Save changes').disabled).toBe(false);
  });
});
