import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog, Input, SegmentedControl, Switch } from '@floegence/floe-webapp-core/ui';
import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';
import { DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS, type DesktopSSHBootstrapStrategy } from '../shared/desktopSSH';
import type { DesktopI18n } from '../shared/i18n';
import { SSHDestinationCombobox } from './SSHDestinationCombobox';
import { DesktopActionPopover } from './DesktopActionPopover';
import {
  sshEnvironmentRootIsDefault,
  sshEnvironmentSettingsDirty,
  type SSHConnectionDialogState,
} from './sshEnvironmentSettingsState';

export type SSHEnvironmentSettingsDialogProps = Readonly<{
  i18n: DesktopI18n;
  state: SSHConnectionDialogState;
  sshConfigHosts: readonly DesktopSSHConfigHost[];
  sshConfigHostsLoading: boolean;
  sshConfigHostsLoadError: boolean;
  fieldErrors: Partial<Record<string, string>>;
  error: string;
  saving: boolean;
  updateField: (
    name:
      | 'label'
      | 'ssh_destination'
      | 'ssh_port'
      | 'auth_mode'
      | 'ssh_password'
      | 'runtime_root'
      | 'release_base_url'
      | 'connect_timeout_seconds',
    value: string,
  ) => void;
  toggleAutoRuntimeProbe: (enabled: boolean) => void;
  switchBootstrapStrategy: (strategy: DesktopSSHBootstrapStrategy) => void;
  removeSSHPassword: () => void;
  refreshSSHConfigHosts: () => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}>;

export function SSHEnvironmentSettingsDialog(props: SSHEnvironmentSettingsDialogProps) {
  const [baseline, setBaseline] = createSignal(props.state);
  const [advanced, setAdvanced] = createSignal(false);
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [discardOpen, setDiscardOpen] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  let form: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;
  let focusFrame = 0;
  const busy = () => submitting() || props.saving;
  const dirty = createMemo(() => sshEnvironmentSettingsDirty(baseline(), props.state));
  const t = (key: Parameters<DesktopI18n['t']>[0], params?: Parameters<DesktopI18n['t']>[1]) =>
    props.i18n.t(key, params);
  const strategyLabel = () => {
    switch (props.state.bootstrap_strategy) {
      case 'desktop_upload':
        return t('connectionDialog.desktopUpload');
      case 'remote_install':
        return t('connectionDialog.remoteDownloadInstall');
      default:
        return t('connectionDialog.automatic');
    }
  };
  const summary = () =>
    [
      strategyLabel(),
      t(
        sshEnvironmentRootIsDefault(props.state.runtime_root)
          ? 'sshSettings.defaultDirectory'
          : 'sshSettings.customDirectory',
      ),
      props.state.release_base_url.trim() ? t('connectionDialog.customMirror') : 'GitHub Releases',
      t('sshSettings.secondsValue', {
        seconds: props.state.connect_timeout_seconds.trim() || DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
      }),
    ].join(' · ');

  const identity = createMemo(() => props.state.environment_id);
  createEffect(
    on(identity, () => {
      setBaseline(props.state);
      setAdvanced(false);
      setHelpOpen(false);
      setDiscardOpen(false);
    }),
  );

  function focusAfterLayout(callback: () => void) {
    cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(callback);
  }
  onCleanup(() => cancelAnimationFrame(focusFrame));

  function revealErrors() {
    const fields = Object.keys(props.fieldErrors).filter((key) => !!props.fieldErrors[key]);
    if (!fields.length) return;
    if (fields.some((key) => ['runtime_root', 'release_base_url', 'connect_timeout_seconds'].includes(key)))
      setAdvanced(true);
    focusAfterLayout(() => {
      const first = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      first?.scrollIntoView({ block: 'nearest' });
    });
  }

  function continueEditing() {
    setDiscardOpen(false);
    focusAfterLayout(() => {
      if (previousFocus?.isConnected) previousFocus.focus();
      else form?.querySelector<HTMLInputElement>('#ssh-settings-label')?.focus();
    });
  }
  function requestClose() {
    if (busy()) return;
    if (discardOpen()) {
      continueEditing();
      return;
    }
    if (!dirty()) {
      props.onClose();
      return;
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHelpOpen(false);
    setDiscardOpen(true);
    focusAfterLayout(() => document.getElementById('ssh-settings-keep-editing')?.focus());
  }
  async function save() {
    if (busy() || !dirty() || discardOpen()) return;
    setSubmitting(true);
    try {
      await props.onSave();
      revealErrors();
    } finally {
      setSubmitting(false);
    }
  }
  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey))
      return;
    if (
      event.target instanceof Element &&
      (event.target.closest('select') || event.target.getAttribute('aria-expanded') === 'true')
    )
      return;
    event.preventDefault();
    void save();
  }

  function Field(field: { name: string; label: string; children: JSX.Element; help?: string }) {
    return (
      <div class="ssh-settings-field" classList={{ 'ssh-settings-field--invalid': !!props.fieldErrors[field.name] }}>
        <label for={`ssh-settings-${field.name}`}>{field.label}</label>
        {field.children}
        <Show when={field.help}>
          <p id={`ssh-settings-${field.name}-help`} class="ssh-settings-help">
            {field.help}
          </p>
        </Show>
        <Show when={props.fieldErrors[field.name]}>
          <p id={`ssh-settings-${field.name}-error`} class="ssh-settings-error" role="alert">
            {props.fieldErrors[field.name]}
          </p>
        </Show>
      </div>
    );
  }
  const inputA11y = (name: string, hasHelp = false) => ({
    'aria-invalid': props.fieldErrors[name] ? (true as const) : undefined,
    'aria-describedby':
      [hasHelp ? `ssh-settings-${name}-help` : '', props.fieldErrors[name] ? `ssh-settings-${name}-error` : '']
        .filter(Boolean)
        .join(' ') || undefined,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      title={discardOpen() ? t('sshSettings.discardTitle') : t('sshSettings.title')}
      description={discardOpen() ? undefined : `${baseline().label} · ${t('connectionDialog.sshHost')}`}
      closeLabel={t('common.close')}
      closeOnBackdropClick={false}
      escapeKeyPhase="bubble"
      onKeyDown={handleKeyDown}
      class="redeven-ssh-settings-dialog"
      footer={
        <Show
          when={!discardOpen()}
          fallback={
            <>
              <Button id="ssh-settings-keep-editing" variant="ghost" onClick={continueEditing}>
                {t('sshSettings.keepEditing')}
              </Button>
              <Button onClick={props.onClose}>{t('sshSettings.discardChanges')}</Button>
            </>
          }
        >
          <Button variant="ghost" disabled={busy()} onClick={requestClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!dirty() || busy()} loading={busy()} onClick={() => void save()}>
            {t('sshSettings.saveChanges')}
          </Button>
        </Show>
      }
    >
      <Show when={discardOpen()}>
        <p class="ssh-settings-discard-copy">{t('sshSettings.discardDescription')}</p>
      </Show>
      <div ref={form} class="ssh-settings-form" hidden={discardOpen()} inert={discardOpen() || busy()}>
        <Field name="label" label={t('connectionDialog.name')}>
          <Input
            id="ssh-settings-label"
            data-floe-autofocus
            value={props.state.label}
            {...inputA11y('label')}
            onInput={(event) => props.updateField('label', event.currentTarget.value)}
          />
        </Field>

        <section class="ssh-settings-section" aria-labelledby="ssh-settings-connection-heading">
          <div class="ssh-settings-section-heading">
            <h3 id="ssh-settings-connection-heading">{t('sshSettings.connection')}</h3>
            <DesktopActionPopover
              open={helpOpen()}
              onOpenChange={setHelpOpen}
              popoverAriaLabel={t('sshSettings.connectionHelp')}
              class="ssh-settings-help-popover"
              content={<p>{t('connectionDialog.sshEnvironmentNotice')}</p>}
            >
              <button
                class="ssh-settings-help-link"
                type="button"
                aria-expanded={helpOpen()}
                onClick={() => setHelpOpen(!helpOpen())}
              >
                {t('sshSettings.connectionHelp')}
              </button>
            </DesktopActionPopover>
          </div>
          <div class="ssh-settings-endpoint">
            <Field name="ssh_destination" label={t('connectionDialog.sshDestination')}>
              <SSHDestinationCombobox
                i18n={props.i18n}
                inputID="ssh-settings-ssh_destination"
                value={props.state.ssh_destination}
                hosts={props.sshConfigHosts}
                loading={props.sshConfigHostsLoading}
                loadError={props.sshConfigHostsLoadError}
                autofocus={false}
                {...inputA11y('ssh_destination')}
                onInput={(value) => props.updateField('ssh_destination', value)}
                onSelectHost={(host) => {
                  props.updateField('ssh_destination', host.alias);
                  props.updateField('ssh_port', host.port == null ? '' : String(host.port));
                }}
                onRetry={props.refreshSSHConfigHosts}
              />
            </Field>
            <Field name="ssh_port" label={t('settings.portLabel')}>
              <Input
                id="ssh-settings-ssh_port"
                value={props.state.ssh_port}
                placeholder="22"
                inputMode="numeric"
                {...inputA11y('ssh_port')}
                onInput={(event) => props.updateField('ssh_port', event.currentTarget.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
          <div class="ssh-settings-field">
            <span id="ssh-settings-auth-label">{t('connectionDialog.authentication')}</span>
            <SegmentedControl
              value={props.state.auth_mode}
              onChange={(value) => props.updateField('auth_mode', value)}
              aria-label={t('connectionDialog.authentication')}
              role="radiogroup"
              options={[
                { value: 'key_agent', label: t('connectionDialog.keyAgent') },
                { value: 'password', label: t('sshSettings.password') },
              ]}
            />
            <Show when={props.state.auth_mode === 'key_agent'}>
              <p class="ssh-settings-help">{t('sshSettings.keyHelp')}</p>
            </Show>
          </div>
          <Show when={props.state.auth_mode === 'password'}>
            <Field
              name="ssh_password"
              label={t('connectionDialog.localSshPassword')}
              help={t('connectionDialog.localSshPasswordHelp')}
            >
              <Input
                id="ssh-settings-ssh_password"
                type="password"
                autocomplete="new-password"
                value={props.state.ssh_password}
                placeholder={
                  props.state.ssh_password_configured
                    ? t('connectionDialog.replaceStoredPasswordPlaceholder')
                    : t('connectionDialog.optionalSavedPasswordPlaceholder')
                }
                {...inputA11y('ssh_password', true)}
                onInput={(event) => props.updateField('ssh_password', event.currentTarget.value)}
              />
              <Show when={props.state.ssh_password_configured && props.state.ssh_password_mode === 'keep'}>
                <p class="ssh-settings-help">{t('sshSettings.passwordSaved')}</p>
              </Show>
              <Show when={props.state.ssh_password_configured && props.state.ssh_password_mode !== 'clear'}>
                <button type="button" class="ssh-settings-help-link" onClick={props.removeSSHPassword}>
                  {t('settings.removeStoredPassword')}
                </button>
              </Show>
              <Show when={props.state.ssh_password_mode === 'clear'}>
                <p class="ssh-settings-help" role="status">
                  {t('connectionDialog.storedSshPasswordWillBeRemoved')}
                </p>
              </Show>
            </Field>
          </Show>
        </section>

        <div class="ssh-settings-probe">
          <div>
            <label for="ssh-settings-probe">{t('connectionDialog.autoStatusDetection')}</label>
            <p id="ssh-settings-probe-help" class="ssh-settings-help">
              {t('sshSettings.probeHelp')}
            </p>
          </div>
          <Switch
            id="ssh-settings-probe"
            checked={props.state.auto_runtime_probe_enabled}
            onChange={props.toggleAutoRuntimeProbe}
            aria-label={t('connectionDialog.autoStatusDetection')}
            aria-describedby="ssh-settings-probe-help"
          />
        </div>

        <section class="ssh-settings-advanced">
          <button
            type="button"
            class="ssh-settings-disclosure"
            aria-expanded={advanced()}
            aria-controls="ssh-settings-advanced-fields"
            onClick={() => setAdvanced(!advanced())}
          >
            <ChevronRight class="ssh-settings-chevron" classList={{ 'ssh-settings-chevron--open': advanced() }} />
            <span>
              <span class="ssh-settings-disclosure-title">{t('connectionDialog.advanced')}</span>
              <span class="ssh-settings-help ssh-settings-summary">{summary()}</span>
            </span>
          </button>
          <Show when={advanced()}>
            <div id="ssh-settings-advanced-fields" class="ssh-settings-advanced-fields">
              <Field
                name="bootstrap_strategy"
                label={t('connectionDialog.bootstrapDelivery')}
                help={t(
                  props.state.bootstrap_strategy === 'desktop_upload'
                    ? 'sshSettings.uploadHelp'
                    : props.state.bootstrap_strategy === 'remote_install'
                      ? 'sshSettings.remoteHelp'
                      : 'connectionDialog.bootstrapHelp',
                )}
              >
                <select
                  id="ssh-settings-bootstrap_strategy"
                  value={props.state.bootstrap_strategy}
                  onChange={(event) =>
                    props.switchBootstrapStrategy(event.currentTarget.value as DesktopSSHBootstrapStrategy)
                  }
                >
                  <For each={['auto', 'desktop_upload', 'remote_install'] as const}>
                    {(strategy) => (
                      <option value={strategy}>
                        {t(
                          strategy === 'auto'
                            ? 'connectionDialog.automatic'
                            : strategy === 'desktop_upload'
                              ? 'connectionDialog.desktopUpload'
                              : 'connectionDialog.remoteDownloadInstall',
                        )}
                      </option>
                    )}
                  </For>
                </select>
              </Field>
              <Field name="runtime_root" label={t('connectionDialog.runtimeRoot')} help={t('sshSettings.rootHelp')}>
                <Input
                  id="ssh-settings-runtime_root"
                  value={props.state.runtime_root}
                  placeholder="$HOME/.redeven"
                  spellcheck={false}
                  {...inputA11y('runtime_root', true)}
                  onInput={(event) => props.updateField('runtime_root', event.currentTarget.value)}
                />
              </Field>
              <Field
                name="release_base_url"
                label={t('connectionDialog.releaseBaseUrl')}
                help={t('sshSettings.releaseHelp')}
              >
                <Input
                  id="ssh-settings-release_base_url"
                  value={props.state.release_base_url}
                  placeholder="https://github.com/floegence/redeven/releases"
                  spellcheck={false}
                  {...inputA11y('release_base_url', true)}
                  onInput={(event) => props.updateField('release_base_url', event.currentTarget.value)}
                />
              </Field>
              <Field name="connect_timeout_seconds" label={t('connectionDialog.connectTimeoutShort')}>
                <div class="ssh-settings-timeout">
                  <Input
                    id="ssh-settings-connect_timeout_seconds"
                    value={props.state.connect_timeout_seconds}
                    placeholder={String(DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS)}
                    inputMode="decimal"
                    {...inputA11y('connect_timeout_seconds')}
                    onInput={(event) => props.updateField('connect_timeout_seconds', event.currentTarget.value)}
                  />
                  <span class="ssh-settings-help">{t('sshSettings.secondsUnit')}</span>
                </div>
              </Field>
            </div>
          </Show>
        </section>
        <Show when={props.error}>
          <p class="ssh-settings-error" role="alert">
            {props.error}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
