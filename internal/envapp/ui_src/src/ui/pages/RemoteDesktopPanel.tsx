import { Button, StableText, Switch } from '@floegence/floe-webapp-core/ui';
import { MonitorPointer, Refresh, ChevronRight, ArrowRight, AlertCircle } from '@floegence/floe-webapp-core/icons';
import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { Dialog, ConfirmDialog } from '../primitives/EnvAppModal';
import { useI18n } from '../i18n';
import type { EnvAppTranslationKey } from '../i18n/locales/en-US';
import { useEnvContext } from './EnvContext';
import { cancelRemoteDesktopPreparation, forgetRemoteDesktopAuthorization, createRemoteDesktop, disconnectRemoteDesktop, getRemoteDesktopStatus, prepareRemoteDesktop, setRemoteDesktopUnattended, installRemoteDesktopLoginService, type RemoteDesktopStatus } from '../services/remoteDesktopApi';
import { desktopShellWebServiceWindowOpenAvailable } from '../services/desktopShellBridge';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { openWebServiceRoute, resolveWebServiceOpenRoute, WebServiceWindowOpenError } from '../services/webServiceWindows';
import { requestHostApplicationPermission } from '../services/hostApplicationsApi';
import { LocalApiError } from '../services/localApi';
import './remote-desktop.css';

type Failure = { title: EnvAppTranslationKey; hint: EnvAppTranslationKey; diagnostic?: string };
type Action = 'connect' | 'prepare' | 'settings' | 'permission' | 'cancel' | 'forget' | 'service-install';

function desktopFailure(title: EnvAppTranslationKey, failure: unknown, hint: EnvAppTranslationKey = 'remoteDesktop.connectionHint'): Failure {
  if (failure instanceof WebServiceWindowOpenError) {
    return { title, hint: 'remoteDesktop.windowFailed', diagnostic: failure.message };
  }
  if (failure instanceof LocalApiError) {
    if (failure.status === 403) hint = 'remoteDesktop.accessRequired';
    else if (failure.status === 401) hint = 'remoteDesktop.sessionExpired';
    else if (failure.code === 'DESKTOP_INVALID') hint = 'remoteDesktop.requestInvalid';
    else if (failure.code === 'DESKTOP_AUTHORIZATION_BUSY') hint = 'remoteDesktop.approvalBusy';
    else if (failure.code === 'DESKTOP_SETUP_BUSY') hint = 'remoteDesktop.setupBusy';
    else if (failure.code.startsWith('DESKTOP_SERVICE_')) hint = 'remoteDesktop.serviceInstallFailed';
    return { title, hint, diagnostic: `${failure.code} · HTTP ${failure.status}` };
  }
  return { title, hint };
}

export function RemoteDesktopLauncher() {
  const [open, setOpen] = createSignal(false);
  const i18n = useI18n();
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><MonitorPointer class="w-4 h-4" />{i18n.t('remoteDesktop.title')}</Button>
    <Dialog open={open()} onOpenChange={setOpen} title={i18n.t('remoteDesktop.title')} closeLabel={i18n.t('common.actions.close')}
      class="remote-desktop-dialog" contentClass="remote-desktop-dialog-content">
      <Show when={open()}><RemoteDesktopPanel onConnected={() => setOpen(false)} /></Show>
    </Dialog>
  </>;
}

export function RemoteDesktopPanel(props: { onConnected?: () => void } = {}) {
  const env = useEnvContext(), i18n = useI18n();
  const descriptionID = createUniqueId();
  const [status, setStatus] = createSignal<RemoteDesktopStatus>();
  const [loadError, setLoadError] = createSignal<Failure>();
  const [actionError, setActionError] = createSignal<Failure>();
  const [refreshing, setRefreshing] = createSignal(false);
  const [busy, setBusy] = createSignal<Action>();
  const [mode, setMode] = createSignal<'view' | 'control'>('control');
  const [display, setDisplay] = createSignal('');
  const [takeover, setTakeover] = createSignal(false);
  const [forgetApproval, setForgetApproval] = createSignal(false);
  const [opened, setOpened] = createSignal(false);
  const [pendingApproval, setPendingApproval] = createSignal<boolean>();
  const [serviceInstallConfirm, setServiceInstallConfirm] = createSignal(false);
  const [pendingServiceClaim, setPendingServiceClaim] = createSignal(false);
  let disposed = false, refreshTimer: ReturnType<typeof setTimeout> | undefined;

  // The Desktop connection label names SSH/gateway targets. A local Runtime's
  // generic environment name is not the identity of the machine running it.
  const hostName = createMemo(() => readDesktopSessionContextSnapshot()?.label?.trim()
    || (env.localRuntime() ? env.env()?.agent?.hostname?.trim() : env.env()?.name?.trim())
    || env.env()?.agent?.hostname?.trim() || env.env_id());
  const full = () => !!env.env()?.permissions?.can_read && !!env.env()?.permissions?.can_write && !!env.env()?.permissions?.can_execute;
  const capabilities = () => status()?.capabilities;
  const loginService = () => status()?.login_service;
  const displays = () => capabilities()?.displays ?? [];
  const preparing = () => ['checking', 'downloading', 'receiving', 'verifying', 'installing', 'validating'].includes(status()?.setup?.state ?? '');
  const authorization = () => capabilities()?.state === 'authorization_required' || capabilities()?.state === 'host_action_required';
  const macPermission = () => capabilities()?.state !== 'locked' && capabilities()?.backend === 'macos' && (!capabilities()?.screen || (mode() === 'control' && !capabilities()?.input));
  const lockedDesktopAvailable = () => capabilities()?.state === 'locked'
    && capabilities()?.unlock !== false
    && loginService()?.state !== 'unsupported';
  const loginDesktopAvailable = () => ['locked', 'session_unavailable'].includes(capabilities()?.state ?? '')
    && capabilities()?.unlock === true
    && loginService()?.state !== 'unsupported';
  const available = () => !loadError() && (!!capabilities()?.screen || loginDesktopAvailable()) && (mode() === 'view' || !!capabilities()?.input || loginDesktopAvailable())
    && (capabilities()?.state === 'ready' || loginDesktopAvailable() || authorization());
  const canConnect = () => full() && available() && !preparing() && !busy() && !refreshing();
  const failure = () => actionError() ?? loadError();

  const refresh = async () => {
    if (disposed || refreshing()) return;
    clearTimeout(refreshTimer); setRefreshing(true);
    try {
      const next = await getRemoteDesktopStatus();
      if (disposed) return;
      setLoadError(undefined); setStatus(next);
      if (!(next.capabilities.displays ?? []).some(item => item.id === display())) {
        setDisplay(displays().find(item => item.id === next.last_display_id)?.id ?? displays().find(item => item.primary)?.id ?? displays()[0]?.id ?? '');
      }
      if (preparing()) refreshTimer = setTimeout(() => void refresh(), 1500);
    } catch (error) {
      if (!disposed) setLoadError(desktopFailure('remoteDesktop.statusFailed', error));
    } finally { if (!disposed) setRefreshing(false); }
  };
  onMount(() => { void refresh(); window.addEventListener('focus', refresh); });
  onCleanup(() => { disposed = true; clearTimeout(refreshTimer); window.removeEventListener('focus', refresh); });

  const approvalCopy = (): EnvAppTranslationKey | undefined => {
    if (capabilities()?.backend !== 'wayland') return undefined;
    if (!capabilities()?.unattended) return 'remoteDesktop.approvalUnsupported';
    if (!status()?.unattended) return 'remoteDesktop.approvalSession';
    switch (capabilities()?.authorization) {
      case 'saved': return 'remoteDesktop.approvalSaved';
      case 'restoring': return 'remoteDesktop.approvalRestoring';
      case 'revoked': return 'remoteDesktop.approvalRevoked';
      case 'unknown': return 'remoteDesktop.approvalUnknown';
      default: return 'remoteDesktop.approvalNeeded';
    }
  };
  const stateCopy = () => {
    if (!status()) return i18n.t(loadError() ? 'remoteDesktop.unsupported' : 'remoteDesktop.checking');
    if (preparing()) return i18n.t('remoteDesktop.preparing');
    if (!full()) return i18n.t('remoteDesktop.accessTitle');
    if (capabilities()?.state === 'locked') return i18n.t('remoteDesktop.locked');
    if (capabilities()?.state === 'setup_required') return i18n.t('remoteDesktop.setupRequired');
    if (available() && approvalCopy()) return i18n.t(approvalCopy()!);
    if (macPermission() || authorization()) return i18n.t('remoteDesktop.permissionRequired');
    return i18n.t(available() ? 'remoteDesktop.ready' : 'remoteDesktop.unsupported');
  };
  const stateHint = (): EnvAppTranslationKey | undefined => {
    if (failure()) return undefined;
    if (!full()) return 'remoteDesktop.accessRequired';
    if (!status() || preparing() || capabilities()?.state === 'setup_required') return undefined;
    if (capabilities()?.state === 'locked') return lockedDesktopAvailable() ? 'remoteDesktop.lockedHint' : 'remoteDesktop.serviceUnsupported';
    if (macPermission()) return 'remoteDesktop.permissionHint';
    if (available() && capabilities()?.backend === 'wayland' && (!status()?.unattended || !capabilities()?.unattended || capabilities()?.authorization === 'needs_consent')) return 'remoteDesktop.authorizationHint';
    if (capabilities()?.state === 'session_unavailable') return loginDesktopAvailable() ? 'remoteDesktop.lockedHint' : 'remoteDesktop.sessionHint';
    if (capabilities()?.state === 'unsupported') return 'remoteDesktop.unsupportedHostHint';
    if (!available() && !loadError()) return 'remoteDesktop.connectionHint';
    return undefined;
  };
  // Login-screen support is part of connecting. Keep the administrator service
  // out of the normal desktop panel and ask only when the host actually needs it.
  const needsLoginService = () => loginDesktopAvailable()
    && loginService()?.state !== 'active'
    && loginService()?.state !== 'unsupported';

  const runAction = async (action: Action, title: EnvAppTranslationKey, run: () => Promise<unknown>) => {
    if (busy() || !full()) return;
    setBusy(action); setActionError(undefined);
    try { await run(); await refresh(); }
    catch (error) { if (!disposed) setActionError(desktopFailure(title, error)); }
    finally { if (!disposed) setBusy(undefined); }
  };
  const rememberApproval = (enabled: boolean) => {
    if (busy() || !full()) return;
    setPendingApproval(enabled);
    void runAction('settings', 'remoteDesktop.settingsFailed', async () => {
      await setRemoteDesktopUnattended(enabled);
      if (!disposed) setStatus(current => current ? { ...current, unattended: enabled } : current);
    }).finally(() => { if (!disposed) setPendingApproval(undefined); });
  };
  const open = async (claim: boolean, serviceConfirmed = false) => {
    if (!canConnect()) return;
    if (!serviceConfirmed && needsLoginService()) {
      setPendingServiceClaim(claim);
      setServiceInstallConfirm(true);
      return;
    }
    setBusy('connect'); setActionError(undefined); setTakeover(false); setOpened(false);
    const desktop = desktopShellWebServiceWindowOpenAvailable();
    let popup: Window | null = null, created: string | undefined;
    try {
      popup = desktop ? null : window.open('', '_blank');
      if (!desktop && !popup) {
        setActionError({ title: 'remoteDesktop.connectionFailed', hint: 'webServices.errors.popupBlocked' });
        return;
      }
      if (serviceConfirmed) {
        setBusy('service-install');
        try {
          await installRemoteDesktopLoginService();
          await refresh();
        } catch (error) {
          popup?.close();
          if (!disposed) setActionError(desktopFailure('remoteDesktop.serviceInstallFailed', error));
          return;
        } finally {
          if (!disposed) setBusy(undefined);
        }
        if (disposed || !available()) {
          popup?.close();
          return;
        }
        setBusy('connect');
      }
      const session = await createRemoteDesktop({ mode: mode(), display_id: display(), locale: i18n.locale(), theme: document.documentElement.dataset.floeShellTheme ?? '', host_name: hostName(), takeover: claim });
      created = session.id;
      if (disposed || popup?.closed) { popup?.close(); await disconnectRemoteDesktop(session.id).catch(() => {}); return; }
      const route = resolveWebServiceOpenRoute({ forwardID: session.forward_id, localRuntime: env.localRuntime(), desktopContext: readDesktopSessionContextSnapshot(), appPath: '/_redeven_desktop/', desktopWindowAvailable: desktop, presentation: 'desktop' });
      await openWebServiceRoute(route, session.forward_id, session.target_url, 'unified_proxy', '/_redeven_desktop/', desktop, () => {}, {
        missingEnvContext: i18n.t('webServices.errors.missingEnvContext'), opening: i18n.t('remoteDesktop.connecting'),
        openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'), requestingEntryTicket: i18n.t('webServices.status.requestingEntryTicket'),
        updating: i18n.t('webServices.status.updating'), desktopWindowFailed: i18n.t('webServices.errors.desktopWindowFailed'), popupBlocked: i18n.t('webServices.errors.popupBlocked'),
      }, popup, 'desktop');
      if (popup) {
        const viewer = popup;
        const files = (event: MessageEvent) => {
          if (event.source === viewer && event.data?.type === 'redeven:remote-desktop:files' && event.data.session_id === session.id) { env.openSurface('files'); window.focus(); }
        };
        window.addEventListener('message', files);
        // A launched viewer outlives its launcher dialog. Release this observer
        // when that specific viewer closes, not when the dialog unmounts.
        const closed = setInterval(() => { if (viewer.closed) { clearInterval(closed); window.removeEventListener('message', files); void disconnectRemoteDesktop(session.id).catch(() => {}); } }, 1000);
      }
      if (!disposed) { setOpened(true); props.onConnected?.(); }
    } catch (error) {
      popup?.close(); if (created) await disconnectRemoteDesktop(created).catch(() => {});
      if (!disposed) {
        if (error instanceof LocalApiError && error.code === 'DESKTOP_CONTROL_IN_USE') setTakeover(true);
        else setActionError(desktopFailure('remoteDesktop.connectionFailed', error, created ? 'remoteDesktop.windowFailed' : 'remoteDesktop.connectionHint'));
      }
    } finally { if (!disposed) { setBusy(undefined); void refresh(); } }
  };

  return <section class="remote-desktop-panel" aria-label={i18n.t('remoteDesktop.title')}>
    <div class="remote-desktop-host">
      <div class="remote-desktop-host-icon" aria-hidden="true"><MonitorPointer size={24} /></div>
      <div class="remote-desktop-identity">
        <h3 title={hostName()}>{hostName()}</h3>
        <p class="remote-desktop-state" role="status"><span class="remote-desktop-state-dot" data-ready={capabilities()?.state === 'ready' && available() && full() && !preparing() && (capabilities()?.backend !== 'wayland' || capabilities()?.authorization === 'saved' && status()?.unattended)} aria-hidden="true" />{stateCopy()}</p>
      </div>
      <Button size="icon" variant="ghost" disabled={refreshing() || !!busy()} aria-label={i18n.t('remoteDesktop.refresh')} title={i18n.t('remoteDesktop.refresh')} onClick={() => void refresh()}><Refresh size={16} class={refreshing() ? 'animate-spin motion-reduce:animate-none' : ''} /></Button>
    </div>
    <p class="remote-desktop-description">{i18n.t('remoteDesktop.description')}</p>
    <Show when={stateHint()}>{key => <p class="remote-desktop-guidance">{i18n.t(key())}</p>}</Show>
    <Show when={status()?.capabilities.state === 'setup_required' || preparing()}>
      <div class="remote-desktop-setup">
        <p>{i18n.t('remoteDesktop.setupHint')}</p>
        <Show when={preparing()}>
          {/* The indeterminate bar has no value binding: native numeric setters reject undefined. */}
          <Show when={status()?.setup?.expected_bytes} fallback={<progress aria-label={i18n.t('remoteDesktop.preparing')} />}>
            {total => <progress aria-label={i18n.t('remoteDesktop.preparing')} max={total()} value={status()?.setup?.received_bytes ?? 0} />}
          </Show>
        </Show>
        <Show when={status()?.setup?.error_code}><p role="alert">{i18n.t('remoteDesktop.prepareFailed')} <code>{status()?.setup?.error_code}</code></p></Show>
        <div class="remote-desktop-actions">
          <Button variant="outline" disabled={!full() || !!busy() || preparing()} onClick={() => void runAction('prepare', 'remoteDesktop.prepareFailed', prepareRemoteDesktop)}><StableText reserve={[i18n.t('remoteDesktop.preparing'), i18n.t('remoteDesktop.prepare')]}>{i18n.t(preparing() ? 'remoteDesktop.preparing' : 'remoteDesktop.prepare')}</StableText></Button>
          <Show when={status()?.setup?.can_cancel}><Button variant="ghost" disabled={!!busy()} onClick={() => { const id = status()?.setup?.operation_id; if (id) void runAction('cancel', 'remoteDesktop.prepareFailed', () => cancelRemoteDesktopPreparation(id)); }}>{i18n.t('remoteDesktop.cancel')}</Button></Show>
        </div>
      </div>
    </Show>
    <Show when={macPermission()}><div class="remote-desktop-actions">
      <Show when={!capabilities()?.screen}><Button variant="outline" disabled={!full() || !!busy()} onClick={() => void runAction('permission', 'remoteDesktop.permissionFailed', () => requestHostApplicationPermission('screen_recording'))}>{i18n.t('hostApplications.macAllowScreen')}</Button></Show>
      <Show when={mode() === 'control' && !capabilities()?.input}><Button variant="outline" disabled={!full() || !!busy()} onClick={() => void runAction('permission', 'remoteDesktop.permissionFailed', () => requestHostApplicationPermission('accessibility'))}>{i18n.t('hostApplications.macAllowAccessibility')}</Button></Show>
    </div></Show>
    <Show when={displays().length > 1}>
      <label class="remote-desktop-display"><span>{i18n.t('remoteDesktop.display')}</span><select disabled={!!busy()} value={display()} onChange={event => setDisplay(event.currentTarget.value)}>
        <For each={displays()}>{(item, index) => <option value={item.id}>{item.name || `${i18n.t('remoteDesktop.display')} ${index() + 1}`} · {item.width} × {item.height}</option>}</For>
      </select></label>
    </Show>
    <Show when={capabilities()?.backend === 'wayland' && capabilities()?.unattended}><div class="remote-desktop-option remote-desktop-sharing"><Switch checked={pendingApproval() ?? status()?.unattended ?? false} disabled={!full() || !!busy() || refreshing()} onChange={rememberApproval} label={i18n.t('remoteDesktop.unattended')} description={i18n.t('remoteDesktop.unattendedHint')} /></div></Show>
    <details class="remote-desktop-options">
      <summary><ChevronRight size={14} aria-hidden="true" /><span>{i18n.t('remoteDesktop.options')}</span><span class="remote-desktop-mode">{i18n.t(mode() === 'view' ? 'remoteDesktop.view' : 'remoteDesktop.control')}</span></summary>
      <div class="remote-desktop-option"><Switch checked={mode() === 'view'} disabled={!!busy()} onChange={value => setMode(value ? 'view' : 'control')} label={i18n.t('remoteDesktop.view')} description={i18n.t('remoteDesktop.viewHint')} /></div>
      <Show when={capabilities()?.backend === 'wayland' && capabilities()?.unattended && ['saved', 'unknown', 'revoked'].includes(capabilities()?.authorization ?? '')}>
        <div class="remote-desktop-option"><Button variant="outline" disabled={!full() || !!busy() || refreshing()} onClick={() => setForgetApproval(true)}>{i18n.t('remoteDesktop.approvalForget')}</Button></div>
      </Show>
    </details>
    <Show when={failure()}>{problem => <div class="remote-desktop-error" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <div><strong>{i18n.t(problem().title)}</strong><p>{i18n.t(problem().hint)}</p>
        <Show when={problem().diagnostic}><details><summary>{i18n.t('remoteDesktop.errorDetails')}</summary><code>{problem().diagnostic}</code></details></Show>
      </div>
    </div>}</Show>
    <div class="remote-desktop-footer">
      <Button class="remote-desktop-connect" disabled={!canConnect()} aria-describedby={descriptionID} onClick={() => status()?.control_in_use && mode() === 'control' ? setTakeover(true) : void open(false)}>
        <StableText reserve={[i18n.t('remoteDesktop.connecting'), i18n.t('remoteDesktop.connect')]}>{i18n.t(busy() === 'connect' ? 'remoteDesktop.connecting' : 'remoteDesktop.connect')}</StableText><ArrowRight size={16} aria-hidden="true" />
      </Button>
      <p id={descriptionID} role={opened() ? 'status' : undefined}>{i18n.t(opened() ? 'remoteDesktop.windowOpened' : 'remoteDesktop.openHint')}</p>
    </div>
    <ConfirmDialog open={forgetApproval()} onOpenChange={setForgetApproval} title={i18n.t('remoteDesktop.approvalForget')} bodyDescription={i18n.t('remoteDesktop.approvalForgetHint')} confirmText={i18n.t('remoteDesktop.approvalForgetConfirm')} cancelText={i18n.t('remoteDesktop.cancel')} onConfirm={() => { setForgetApproval(false); void runAction('forget', 'remoteDesktop.approvalForgetFailed', forgetRemoteDesktopAuthorization); }} />
    <ConfirmDialog open={takeover()} onOpenChange={setTakeover} title={i18n.t('remoteDesktop.takeover')} bodyDescription={i18n.t('remoteDesktop.takeoverHint')} confirmText={i18n.t('remoteDesktop.takeover')} cancelText={i18n.t('remoteDesktop.cancel')} onConfirm={() => void open(true)} />
    <ConfirmDialog
      open={serviceInstallConfirm()}
      onOpenChange={open => { setServiceInstallConfirm(open); if (!open) setPendingServiceClaim(false); }}
      title={i18n.t('remoteDesktop.loginServiceTitle')}
      bodyDescription={i18n.t('remoteDesktop.loginServiceInstallConfirm')}
      confirmText={i18n.t('remoteDesktop.install')}
      cancelText={i18n.t('remoteDesktop.cancel')}
      onConfirm={() => { const claim = pendingServiceClaim(); setServiceInstallConfirm(false); void open(claim, true); }}
    />
  </section>;
}
