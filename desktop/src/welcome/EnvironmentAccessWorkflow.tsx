import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type ComponentProps, type JSX } from 'solid-js';
import { Button, Checkbox, Input, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Clock, FileText, Globe, Key, Lock, Refresh, Shield } from '@floegence/floe-webapp-core/icons';
import { runtimeConnectionIsOnThisDevice } from '../shared/desktopEnvironmentConnection';
import type { DesktopTranslationKey } from '../shared/i18n';
import { desktopSettingsDraftRequiresRuntimeRestart, deriveDesktopAccessDraftModel, validateDesktopAccessDraft } from '../shared/desktopAccessModel';
import { desktopCertificateIdentity, type DesktopCertificateReport } from '../shared/desktopCertificate';
import { busyStateMatchesAction } from './launcherBusyState';
import { EnvironmentSettingsPanel } from './EnvironmentSettingsDialog';
import { LocalCertificateSettings } from './LocalCertificateSettings';
import { createTwoFactorSettings, TwoFactorSettings } from './TwoFactorSettings';
import { DesktopTooltip } from './DesktopTooltip';
import type { EnvironmentAccessSettingsForm } from './App';
import './EnvironmentAccessWorkflow.css';

type Page = 'overview' | 'access' | 'security' | 'password' | 'guard' | 'factor' | 'prepare' | 'certificate' | 'review';
type Task = 'access' | 'password' | 'remove' | 'enroll';
type Props = ComponentProps<typeof EnvironmentAccessSettingsForm> & { connection: JSX.Element };

/** Navigation is local to this opening. The settings session remains the only access-draft owner. */
export function EnvironmentAccessWorkflow(props: Props) {
  const t = (key: DesktopTranslationKey) => props.i18n.t(key);
  const [page, setPage] = createSignal<Page>('overview');
  const [task, setTask] = createSignal<Task>('access');
  const [continuation, setContinuation] = createSignal<'http' | 'password' | 'remove'>();
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const [confirmation, setConfirmation] = createSignal('');
  const [localError, setLocalError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [certificateReady, setCertificateReady] = createSignal(false);
  const [certificateReport, setCertificateReport] = createSignal<DesktopCertificateReport>();
  let root: HTMLDivElement | undefined;
  let alive = true;
  onCleanup(() => { alive = false; });
  const security = createTwoFactorSettings({
    get environmentID() { return props.snapshot.environment_id; },
    get runtimeStartedAt() { return props.snapshot.runtime_started_at_unix_ms; },
    get open() { return props.open && Boolean(props.security); },
    get i18n() { return props.i18n; },
    manage: request => props.security!(request),
    configureHTTPS: () => {
      setTask('enroll'); props.updateDraftField('local_ui_protocol', 'https'); go('prepare');
    },
    onCompleted: action => {
      if (action === 'disable') {
        setNotice(t('accessFlow.securityDisabled'));
        const next = continuation(); setContinuation(undefined);
        if (next === 'http') { continueAccess(); return; }
        if (next === 'password') { go('password'); return; }
        if (next === 'remove') { removePassword(); return; }
      } else { setContinuation(undefined); setNotice(t('security.done')); }
      go('security');
    },
  });
  const options = createMemo(() => ({
    local_ui_password_configured: props.baselineSnapshot.local_ui_password_configured,
    runtime_password_required: props.baselineSnapshot.runtime_password_required,
    security: security.status(),
  }));
  const access = createMemo(() => deriveDesktopAccessDraftModel(props.draft, options()));
  const baseline = createMemo(() => deriveDesktopAccessDraftModel(props.baselineSnapshot.draft, options()));
  const validation = createMemo(() => validateDesktopAccessDraft(props.draft, options()));
  const pending = () => desktopSettingsDraftRequiresRuntimeRestart(props.baselineSnapshot.draft, props.draft);
  const savedPending = () => props.snapshot.runtime_configuration_pending;
  const saving = createMemo(() => busyStateMatchesAction(props.busyState, 'save_settings'));
  const protectedAccess = () => security.status()?.enabled || security.status()?.recovery_pending;
  const remote = () => Boolean(props.snapshot.runtime_connection && !runtimeConnectionIsOnThisDevice(props.snapshot.runtime_connection));
  const scope = (network: boolean) => t(network ? 'settings.sharedLocalNetworkLabel' : remote() ? 'settings.environmentOnlyLabel' : 'settings.localOnlyLabel');
  const securitySummary = () => !props.security ? t('security.unavailable') : !security.status() ? t(security.busy() ? 'environmentStatus.checking' : 'security.unavailable')
    : security.status()!.recovery_pending ? t('security.locked') : security.status()!.enabled ? t('accessFlow.passwordAndFactor')
      : t(security.status()!.password_configured ? 'settings.passwordSet' : 'settings.noPassword');
  const certificateSummary = () => t(desktopCertificateIdentity(certificateReport()) === 'ready' ? 'settings.certificateReady'
    : desktopCertificateIdentity(certificateReport()) === 'missing' ? 'settings.certificateMissing' : 'settings.certificateUnknown');
  function go(next: Page) {
    setLocalError(''); setPage(next);
    queueMicrotask(() => {
      const viewport = root?.querySelector<HTMLElement>('.environment-settings-panel:not([hidden]) > .environment-settings-scroll');
      if (viewport) viewport.scrollTop = 0;
      root?.querySelector<HTMLElement>('[data-flow-heading]')?.focus({ preventScroll: true });
    });
  }
  function back() { security.close(); setContinuation(undefined); go('overview'); }
  function fail(key: DesktopTranslationKey, id?: string) {
    setLocalError(t(key));
    queueMicrotask(() => {
      const field = id ? root?.querySelector<HTMLElement>(`#${id}`) : root?.querySelector<HTMLElement>('[data-flow-error]');
      field?.focus({ preventScroll: true });
      const viewport = field?.closest<HTMLElement>('.environment-settings-scroll');
      if (field && viewport) viewport.scrollTop += Math.min(0, field.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12)
        + Math.max(0, field.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom + 24);
    });
  }
  function beginFactor(action: 'setup' | 'replace' | 'rotate' | 'disable') {
    go('factor'); security.begin(action);
  }
  function continueAccess() {
    const result = validation();
    if (result.address_error_key) { go('access'); fail(result.address_error_key, 'local-ui-port'); return; }
    if (result.protocol_error_key === 'settings.protocolRequired') { fail(result.protocol_error_key); return; }
    if (props.draft.local_ui_protocol === 'http' && protectedAccess()) {
      setContinuation('http'); go('guard'); return;
    }
    if (result.password_error_key === 'settings.sharedPasswordRequired') { go('password'); return; }
    if (props.draft.local_ui_protocol === 'https' && !certificateReady()) { go('prepare'); return; }
    go('review');
  }
  function changePassword(remove = false) {
    setTask(remove ? 'remove' : 'password'); setConfirmation('');
    if (protectedAccess()) { setContinuation(remove ? 'remove' : 'password'); go('guard'); }
    else if (remove) removePassword(); else go('password');
  }
  function removePassword() {
    props.applyAccessMode('local_only'); props.clearStoredLocalUIPassword(); go('review');
  }
  function passwordNext() {
    if (!props.draft.local_ui_password.trim()) { fail('settings.sharedPasswordRequired', 'local-ui-password'); return; }
    if (new TextEncoder().encode(props.draft.local_ui_password).length > 72) { fail('settings.passwordTooLong', 'local-ui-password'); return; }
    if (props.draft.local_ui_password !== confirmation()) { fail('accessFlow.passwordMismatch', 'access-password-confirm'); return; }
    continueAccess();
  }
  const validationMessage = () => {
    const key = validation().address_error_key ?? validation().protocol_error_key ?? validation().password_error_key;
    return key ? t(key) : '';
  };
  const blocked = (restart: boolean) => validationMessage()
    || (restart && props.connectionDirty ? t('settings.resolveConnectionDraft') : '')
    || (restart && props.draft.local_ui_protocol === 'https' && !certificateReady() ? t('settings.certificateRestartBlocked') : '');
  const canSave = (restart: boolean) => !saving() && !blocked(restart)
    && (pending() || (restart && savedPending()));
  async function save(restart: boolean) {
    if (!canSave(restart)) return;
    await props.saveSettings(restart ? { restartRuntime: true, ...(task() === 'enroll' ? { continueTwoFactor: true } : {}) } : undefined);
    if (alive && props.open && !restart && !props.settingsError && !pending()) { setNotice(t('toast.settingsSaved')); go('overview'); }
  }
  function SaveAction(p: { restart: boolean }) {
    const active = () => saving() && (props.saveIntent === 'restart') === p.restart;
    const label = () => t(active() ? 'settings.savingSettings' : p.restart ? 'settings.saveAndRestart' : 'settings.saveForNextRestart');
    const Control = () => <Button size="sm" variant={p.restart || !props.runtimeRestartAvailable ? 'default' : 'outline'}
      disabled={!canSave(p.restart)} loading={active()} onClick={() => void save(p.restart)}>
      <Show when={p.restart}><Refresh class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /></Show>{label()}
    </Button>;
    return <Show when={blocked(p.restart)} fallback={<Control />}>
      <DesktopTooltip content={blocked(p.restart)} placement="top" delay={0} anchorClass="environment-access-blocked-action"
        anchorTabIndex={0} anchorRole="group" anchorAriaLabel={`${label()}: ${blocked(p.restart)}`}><Control /></DesktopTooltip>
    </Show>;
  }
  const identity = createMemo(() => `${props.open}:${props.snapshot.environment_id}`);
  createEffect(on(identity, () => { setPage(props.focusTwoFactor ? 'security' : 'overview'); setNotice(''); setLocalError(''); setConfirmation(''); }));
  let focusHandled = false;
  createEffect(() => {
    if (props.focusTwoFactor && security.status() && !focusHandled) {
      focusHandled = true; go('security');
      queueMicrotask(() => root?.querySelector<HTMLButtonElement>('.two-factor-setting button')?.focus({ preventScroll: true }));
    }
  });
  createEffect(() => {
    if (page() === 'security' && security.view() !== 'closed') go('factor');
    else if (page() === 'factor' && security.view() === 'closed' && !security.busy()) go('security');
  });
  const reviewing = () => page() === 'review' || page() === 'prepare';
  const heading = (title: DesktopTranslationKey, description?: DesktopTranslationKey) => <div class="access-flow-intro">
    <Button size="sm" variant="ghost" class="access-flow-back" disabled={saving()} onClick={back}><ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />{t('accessFlow.backOverview')}</Button>
    <h3 tabindex="-1" data-flow-heading>{t(title)}</h3><Show when={description}><p>{t(description!)}</p></Show>
  </div>;
  const steps = () => <ol class="access-flow-steps" aria-label={t('accessFlow.configurationSteps')}>
    <For each={['accessFlow.changeAccess', 'accessFlow.requirements', 'accessFlow.reviewTitle'] as const}>{(key, index) =>
      <li aria-current={(page() === 'access' ? 0 : page() === 'review' ? 2 : 1) === index() ? 'step' : undefined}><span aria-hidden="true">{index() + 1}</span>{t(key)}</li>
    }</For>
  </ol>;
  return <div ref={root} class="access-workflow">
    <Show when={page() === 'factor'}><TwoFactorSettings environmentID={props.snapshot.environment_id} i18n={props.i18n}
      manage={props.security!} configureHTTPS={() => {}} controller={security} onClose={() => { setContinuation(undefined); go('security'); }} /></Show>
    <div class="access-workflow-panel" hidden={page() === 'factor'} inert={page() === 'factor'}>
    <EnvironmentSettingsPanel footer={<>
      <Show when={props.settingsError || localError()}><div ref={props.settingsErrorRef} tabindex="-1" id="settings-error" role="alert" data-flow-error class="environment-access-save-error">
        <AlertCircle class="h-4 w-4 shrink-0" aria-hidden="true" /><span>{props.settingsError || localError()}</span>
      </div></Show>
      <Show when={reviewing() && props.connectionDirty}><div class="environment-settings-draft-notice" role="status"><span>{t('settings.resolveConnectionDraft')}</span><Button size="sm" variant="ghost" onClick={props.showConnectionSettings}>{t('settings.goToConnection')}</Button></div></Show>
      <div class="access-flow-footer-copy">{t(reviewing() ? (props.runtimeRestartAvailable ? 'accessFlow.restartHandoff' : 'settings.applyNextStartHelp') : 'accessFlow.overviewHelp')}</div>
      <div class="environment-access-actions">
        <Button size="sm" variant="ghost" class="environment-access-close" disabled={saving()} onClick={() => page() === 'overview' ? props.cancelSettings() : back()}>{t(page() === 'overview' ? 'common.close' : 'common.cancel')}</Button>
        <Show when={page() === 'access'}><Button size="sm" disabled={saving()} onClick={continueAccess}>{t(props.draft.local_ui_protocol === 'http' && protectedAccess() ? 'accessFlow.verifyContinue' : 'accessFlow.checkChanges')}<ChevronRight class="ml-1.5 h-3.5 w-3.5" aria-hidden="true" /></Button></Show>
        <Show when={page() === 'password'}><Button size="sm" type="submit" form="access-password-form">{t('security.continue')}</Button></Show>
        <Show when={page() === 'guard'}><Button size="sm" disabled={security.busy() || !security.status()} onClick={() => beginFactor(security.status()?.recovery_pending ? 'setup' : 'disable')}>{t(security.status()?.recovery_pending ? 'security.setup' : 'accessFlow.verifyContinue')}</Button></Show>
        <Show when={page() === 'prepare' && task() !== 'enroll'}><Button size="sm" disabled={!certificateReady()} onClick={() => go('review')}>{t('accessFlow.checkChanges')}</Button></Show>
        <Show when={page() === 'review' || (page() === 'prepare' && task() === 'enroll')}>
          <SaveAction restart={false} /><Show when={props.runtimeRestartAvailable}><SaveAction restart /></Show>
        </Show>
        <Show when={page() === 'certificate' && savedPending() && props.draft.local_ui_protocol === 'https'}><Button size="sm" onClick={() => go('review')}>{t('accessFlow.checkChanges')}</Button></Show>
        <Show when={page() === 'overview' && pending() && props.resetAccess}><Button size="sm" variant="ghost" onClick={() => { props.resetAccess?.(); setConfirmation(''); }}>{t('settings.discardChanges')}</Button></Show>
      </div>
    </>}>
      <div class="environment-access-form" inert={saving()}>
        <Show when={page() === 'overview'}>
          {props.connection}
          <Show when={pending() || savedPending()}><div class="access-flow-notice" role="status"><Clock class="h-4 w-4" aria-hidden="true" /><span>{t('settings.pendingChanges')}</span><Button size="sm" variant="outline" onClick={() => { setTask('access'); go('review'); }}>{t('accessFlow.checkChanges')}</Button></div></Show>
          <div class="access-flow-summary">
            <section><Globe class="access-flow-icon" aria-hidden="true" /><div><h3>{t('settings.visibilityTitle')}</h3><p>{scope(baseline().network_exposure)} · {props.baselineSnapshot.draft.local_ui_protocol?.toUpperCase() ?? 'HTTP'} · {baseline().bind_port_text}</p><Show when={savedPending()}><p>{t('settings.nextStartLabel')}</p></Show></div><Button size="sm" variant="outline" onClick={() => { setTask('access'); go('access'); }}>{t('accessFlow.changeAccess')}</Button></section>
            <section><Shield class="access-flow-icon" aria-hidden="true" /><div><h3>{t('accessFlow.loginProtection')}</h3><p>{securitySummary()}</p></div><Button size="sm" variant="outline" onClick={() => go('security')}>{t('accessFlow.manageProtection')}</Button></section>
            <Show when={props.certificate}><section><FileText class="access-flow-icon" aria-hidden="true" /><div><h3>{t('accessFlow.certificateTitle')}</h3><p>{certificateSummary()}</p></div><Button size="sm" variant="outline" onClick={() => go('certificate')}>{t('settings.certificateManage')}</Button></section></Show>
          </div>
        </Show>
        <Show when={notice()}><p class="access-flow-notice" role="status"><Check class="h-4 w-4" aria-hidden="true" />{notice()}</p></Show>
        <Show when={page() === 'access'}>
          {heading('accessFlow.changeAccess', 'settings.visibilityDescription')}{steps()}
          <section class="access-flow-block"><h4>{t('settings.visibilityTitle')}</h4>
            <div class="access-flow-options" role="group" aria-label={t('settings.visibilityTitle')}>
              <For each={['local_only', 'shared_local_network'] as const}>{mode => <button type="button" aria-label={scope(mode === 'shared_local_network')} aria-pressed={(mode === 'shared_local_network') === access().network_exposure}
                onClick={() => props.applyAccessMode(mode)}><span class="access-flow-radio" aria-hidden="true" /><span><strong>{scope(mode === 'shared_local_network')}</strong><span>{t(mode === 'shared_local_network' ? 'settings.sharedLocalNetworkDescription' : remote() ? 'settings.environmentOnlyDescription' : 'settings.localOnlyDescription')}</span></span></button>}</For>
            </div>
          </section>
          <section class="access-flow-block"><h4>{t('settings.connectionSecurity')}</h4>
            <SegmentedControl size="sm" aria-label={t('settings.connectionSecurity')} value={props.draft.local_ui_protocol ?? 'http'}
              options={[{value: 'http', label: t('settings.httpLabel')}, {value: 'https', label: t('settings.httpsLabel')}]}
              onChange={value => props.updateDraftField('local_ui_protocol', value)} />
            <p class="access-flow-help">{t(props.draft.local_ui_protocol === 'https' ? 'settings.httpsHelp' : 'settings.httpNotice')}</p>
            <Show when={props.draft.local_ui_protocol === 'http' && protectedAccess()}><p class="access-flow-notice" role="status"><Shield class="h-4 w-4" aria-hidden="true" />{t('accessFlow.disableFirstHelp')}</p></Show>
          </section>
          <details class="environment-access-advanced" onToggle={event => setAdvancedOpen(event.currentTarget.open)} open={advancedOpen() || access().access_mode === 'custom_exposure' || access().port_mode === 'auto' || Boolean(validation().address_error_key)}>
            <summary><ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />{t('settings.advancedNetwork')}</summary>
            <div class="environment-access-advanced-content access-flow-network">
              <label><span>{t('settings.bindAddressTitle')}</span><Input size="sm" id="local-ui-bind" value={props.draft.local_ui_bind} aria-invalid={Boolean(validation().address_error_key)} onInput={event => props.updateDraftField('local_ui_bind', event.currentTarget.value)} /></label>
              <label><span>{t('settings.portTitle')}</span><Input size="sm" id="local-ui-port" inputMode="numeric" value={access().bind_port_text} disabled={access().port_mode === 'auto'} aria-invalid={Boolean(validation().address_error_key)} aria-describedby="local-ui-bind-error" onInput={event => props.applyAccessFixedPort(event.currentTarget.value)} /></label>
              <Show when={!access().network_exposure}><Checkbox size="sm" checked={access().port_mode === 'auto'} onChange={props.toggleAutoPort} label={t('settings.autoSelectPort')} /></Show>
              <p class="access-flow-help">{t('settings.listenAddressHelp')}</p>
              <Show when={validation().address_error_key}><p id="local-ui-bind-error" class="access-flow-field-error" role="alert">{t(validation().address_error_key!)}</p></Show>
            </div>
          </details>
        </Show>
        <Show when={page() === 'security'}>
          {heading('accessFlow.loginProtection', 'accessFlow.securityHelp')}
          <div class="access-flow-summary"><section><Key class="access-flow-icon" aria-hidden="true" /><div><h3>{t('settings.passwordTitle')}</h3><p>{t(props.baselineSnapshot.local_ui_password_configured ? 'settings.passwordSet' : 'settings.noPassword')}</p></div><Button size="sm" variant="outline" onClick={() => changePassword()}>{t('accessFlow.changePassword')}</Button></section></div>
          <Show when={props.security}><TwoFactorSettings environmentID={props.snapshot.environment_id} i18n={props.i18n} manage={props.security!}
            configureHTTPS={() => {}} controller={security} />
          </Show>
          <Show when={props.baselineSnapshot.local_ui_password_configured}><details class="environment-access-advanced"><summary><ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />{t('settings.removeStoredPassword')}</summary><div class="environment-access-advanced-content"><p class="access-flow-help">{t('accessFlow.removePasswordHelp')}</p><Button size="sm" variant="outline" onClick={() => changePassword(true)}>{t('settings.removeStoredPassword')}</Button></div></details></Show>
        </Show>
        <Show when={page() === 'guard'}>
          {heading('accessFlow.disableFirst', 'accessFlow.disableFirstHelp')}{steps()}
          <div class="access-flow-card"><ol class="access-flow-plan"><li>{t('security.ownerHelp')}</li><li>{t('security.disable')}</li><li>{t(continuation() === 'http' ? 'accessFlow.changeAccess' : 'accessFlow.changePassword')}</li></ol></div>
          <p class="access-flow-notice"><AlertCircle class="h-4 w-4" aria-hidden="true" />{t(security.status()?.recovery_pending ? 'accessFlow.recoverFirst' : 'accessFlow.securityImmediate')}</p>
        </Show>
        <Show when={page() === 'password'}>
          {heading(task() === 'password' ? 'accessFlow.changePassword' : 'security.newPassword', 'accessFlow.passwordHelp')}{steps()}
          <form id="access-password-form" class="access-flow-password" onSubmit={event => { event.preventDefault(); passwordNext(); }}>
            <label><span>{t('security.newPassword')}</span><Input id="local-ui-password" type="password" autocomplete="new-password" value={props.draft.local_ui_password} aria-invalid={Boolean(localError())} aria-describedby={localError() ? 'settings-error' : undefined} onInput={event => { props.updateDraftField('local_ui_password', event.currentTarget.value); setLocalError(''); }} /></label>
            <label><span>{t('security.confirmPassword')}</span><Input id="access-password-confirm" type="password" autocomplete="new-password" value={confirmation()} aria-invalid={Boolean(localError())} aria-describedby={localError() ? 'settings-error' : undefined} onInput={event => { setConfirmation(event.currentTarget.value); setLocalError(''); }} /></label>
          </form>
        </Show>
        <Show when={page() === 'prepare' || page() === 'certificate'}>
          {heading(page() === 'certificate' ? 'accessFlow.certificateTitle' : 'security.httpsTitle', page() === 'certificate' ? 'settings.certificateImmediateHelp' : 'accessFlow.httpsHandoff')}
          <Show when={page() === 'prepare'}>{steps()}</Show>
        </Show>
        <div hidden={page() !== 'prepare' && page() !== 'certificate'} inert={page() !== 'prepare' && page() !== 'certificate'}>
          <Show when={props.open && props.certificate}><LocalCertificateSettings environmentID={props.snapshot.environment_id} i18n={props.i18n} manage={props.certificate!} remote={remote()} onReadiness={setCertificateReady} onReport={setCertificateReport} copyText={props.copyEnvironmentValue} /></Show>
        </div>
        <Show when={page() === 'prepare' && validation().password_error_key === 'settings.sharedPasswordRequired'}><div class="access-flow-notice"><span>{t('settings.sharedPasswordRequired')}</span><Button size="sm" onClick={() => go('password')}>{t('security.newPassword')}</Button></div></Show>
        <Show when={page() === 'prepare'}><p class="access-flow-notice"><Lock class="h-4 w-4" aria-hidden="true" />{t(props.runtimeRestartAvailable ? 'accessFlow.restartHandoff' : 'settings.applyNextStartHelp')}</p></Show>
        <Show when={page() === 'review'}>
          {heading('accessFlow.reviewTitle', 'accessFlow.reviewHelp')}{steps()}
          <dl class="access-flow-review">
            <div><dt>{t('settings.visibilityTitle')}</dt><dd>{scope(access().network_exposure)}</dd></div>
            <div><dt>{t('settings.connectionSecurity')}</dt><dd>{props.draft.local_ui_protocol?.toUpperCase() ?? 'HTTP'}</dd></div>
            <div><dt>{t('settings.bindAddressTitle')}</dt><dd><code>{props.draft.local_ui_bind}</code></dd></div>
            <div><dt>{t('settings.passwordTitle')}</dt><dd>{t(props.draft.local_ui_password_mode === 'clear' ? 'settings.clearOnSave' : props.draft.local_ui_password_mode === 'replace' ? 'settings.updateOnSave' : props.baselineSnapshot.local_ui_password_configured ? 'settings.passwordSet' : 'settings.noPassword')}</dd></div>
            <div><dt>{t('security.title')}</dt><dd>{securitySummary()}</dd></div>
          </dl>
          <Show when={task() === 'remove'}><p class="access-flow-notice">{t('accessFlow.removePasswordHelp')}</p></Show>
          <Show when={blocked(true)}><p class="access-flow-notice" role="status"><AlertCircle class="h-4 w-4" aria-hidden="true" /><span>{blocked(true)}</span><Show when={props.draft.local_ui_protocol === 'https' && !certificateReady()}><Button size="sm" variant="outline" onClick={() => go('prepare')}>{t('security.configureHTTPS')}</Button></Show></p></Show>
          <Button size="sm" variant="ghost" onClick={() => go(task() === 'password' ? 'password' : 'access')}>{t('accessFlow.editAgain')}</Button>
        </Show>
      </div>
    </EnvironmentSettingsPanel>
    </div>
  </div>;
}
