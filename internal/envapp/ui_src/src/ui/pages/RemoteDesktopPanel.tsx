import { Button, StableText, Switch } from '@floegence/floe-webapp-core/ui';
import { Refresh, ChevronRight, ArrowRight, AlertCircle, Check } from '@floegence/floe-webapp-core/icons';
import { RemoteDesktopIcon } from '../icons/RemoteDesktopIcon';
import { For, Match, Show, Switch as MatchSwitch, createMemo, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { Dialog } from '../primitives/EnvAppModal';
import { useI18n } from '../i18n';
import type { EnvAppTranslationKey } from '../i18n/locales/en-US';
import { useEnvContext } from './EnvContext';
import { cancelRemoteDesktopPreparation, forgetRemoteDesktopAuthorization, createRemoteDesktop, disconnectRemoteDesktop, getRemoteDesktopStatus, prepareRemoteDesktop, setRemoteDesktopUnattended, type RemoteDesktopStatus } from '../services/remoteDesktopApi';
import type { DesktopAdministratorMethod, DesktopDeploymentOperation, DesktopDeploymentProgress, DesktopDeploymentResult } from '../../../../../../desktop/src/shared/remoteDesktopDeployment';
import { remoteDesktopDeploymentInDesktopShell, onRemoteDesktopDeploymentProgress, desktopShellWebServiceWindowOpenAvailable } from '../services/desktopShellBridge';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { openWebServiceRoute, resolveWebServiceOpenRoute, WebServiceWindowOpenError } from '../services/webServiceWindows';
import { requestHostApplicationPermission } from '../services/hostApplicationsApi';
import { LocalApiError } from '../services/localApi';
import './remote-desktop.css';

type Failure = { title: EnvAppTranslationKey; hint: EnvAppTranslationKey; diagnostic?: string };
type Action = 'connect' | 'prepare' | 'settings' | 'permission' | 'cancel' | 'forget' | 'deployment';
type DeploymentPhase = 'authorizing' | 'preparing' | 'password' | 'confirmation' | 'canceling' | 'failed' | 'connecting' | 'connection_failed' | 'complete';
type DeploymentState = {id:string;operation:DesktopDeploymentOperation;connectAfterSetup:boolean;phase:DeploymentPhase;method:DesktopAdministratorMethod;progress?:DesktopDeploymentProgress;result?:DesktopDeploymentResult};

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
    return { title, hint, diagnostic: `${failure.code} · HTTP ${failure.status}` };
  }
  return { title, hint };
}

export function RemoteDesktopLauncher() {
  const [open, setOpen] = createSignal(false);
  const i18n = useI18n();
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><RemoteDesktopIcon class="w-4 h-4" />{i18n.t('remoteDesktop.title')}</Button>
    <Dialog open={open()} onOpenChange={setOpen} title={i18n.t('remoteDesktop.title')} closeLabel={i18n.t('common.actions.close')} escapeKeyPhase="bubble"
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
  const [actionBusy, setBusy] = createSignal<Action>();
 const busy = () => deployment() && ['preparing','password','confirmation','canceling'].includes(deploymentPhase()) ? 'deployment' : actionBusy();
  const [mode, setMode] = createSignal<'view' | 'control'>('control');
  const [display, setDisplay] = createSignal('');
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const [confirmation, setConfirmation] = createSignal<'takeover' | 'forget'>();
  const [opened, setOpened] = createSignal(false);
  const [pendingApproval, setPendingApproval] = createSignal<boolean>();
  const [sshDeploymentAvailable, setSSHDeploymentAvailable] = createSignal(false);
  const [deployment,setDeployment]=createSignal<DeploymentState>();
  const [administratorPassword,setAdministratorPassword]=createSignal('');
  const deploymentOperation=()=>deployment()?.operation;
  const deploymentConnectIntent=()=>deployment()?.connectAfterSetup??false;
  const deploymentPhase=()=>deployment()?.phase??'authorizing';
  const deploymentProgress=()=>deployment()?.progress;
  const deploymentResult=()=>deployment()?.result;
  const cancelingDeployment=()=>deploymentPhase()==='canceling';
  const sshPhysical=()=>readDesktopSessionContextSnapshot()?.target_kind==='ssh_environment';
  let disposed = false, refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshRequest: Promise<void> | undefined;
  let connectionAttempt = 0, pendingPopup: Window | null = null;
  let panel: HTMLElement | undefined, returnFocus: HTMLElement | undefined, returnFocusKey: string | undefined;
  const focusStep = (element: HTMLElement) => queueMicrotask(() => { if (!disposed && element.isConnected) element.focus({ preventScroll: true }); });
  const rememberFocus = () => { if (document.activeElement instanceof HTMLElement) { returnFocus = document.activeElement; returnFocusKey = returnFocus.dataset.desktopFocus; } };
  const restoreFocus = () => queueMicrotask(() => {
    if (disposed) return;
    const target = returnFocus?.isConnected ? returnFocus : returnFocusKey ? panel?.querySelector<HTMLElement>(`[data-desktop-focus="${returnFocusKey}"]`) : undefined;
    (target ?? panel?.querySelector<HTMLElement>('.remote-desktop-connect'))?.focus({ preventScroll: true });
  });

  // The Desktop connection label names SSH/gateway targets. A local Runtime's
  // generic environment name is not the identity of the machine running it.
  const hostName = createMemo(() => readDesktopSessionContextSnapshot()?.label?.trim()
    || (env.localRuntime() ? env.env()?.agent?.hostname?.trim() : env.env()?.name?.trim())
    || env.env()?.agent?.hostname?.trim() || env.env_id());
  const full = () => !!env.env()?.permissions?.can_read && !!env.env()?.permissions?.can_write && !!env.env()?.permissions?.can_execute;
  const capabilities = () => status()?.capabilities;
  const loginService = () => status()?.login_service;
  const sshServiceUnsupported = () => sshDeploymentAvailable() && loginService()?.state === 'unsupported';
  const sshManaged = () => sshPhysical() && sshDeploymentAvailable() && loginService()?.state !== 'unsupported';
  const needsSSHSetup = () => sshManaged() && !sshServiceUnsupported() && loginService()?.state !== 'active';
  const serviceUpdateRequired = () => loginService()?.reason === 'SERVICE_UPDATE_REQUIRED' || capabilities()?.reason === 'SERVICE_UPDATE_REQUIRED';
  const sshCaptureUnavailable = () => sshManaged() && loginService()?.state === 'active' && ['DISPLAY_DISCONNECTED', 'DISPLAY_INACTIVE', 'GPU_SCANOUT_UNSUPPORTED', 'LOGIN_SESSION_UNSUPPORTED'].includes(capabilities()?.reason ?? '');
  const displays = () => capabilities()?.displays ?? [];
  const preparing = () => ['checking', 'downloading', 'receiving', 'verifying', 'installing', 'validating'].includes(status()?.setup?.state ?? '');
  const authorization = () => capabilities()?.state === 'authorization_required' || capabilities()?.state === 'host_action_required';
  const macPermission = () => !sshServiceUnsupported() && capabilities()?.state !== 'locked' && capabilities()?.backend === 'macos' && (!capabilities()?.screen || (mode() === 'control' && !capabilities()?.input));
  const lockedDesktopAvailable = () => capabilities()?.state === 'locked'
    && capabilities()?.unlock !== false
    && loginService()?.state !== 'unsupported';
  const loginDesktopAvailable = () => ['locked', 'session_unavailable'].includes(capabilities()?.state ?? '')
    && capabilities()?.unlock === true
    && loginService()?.state !== 'unsupported';
  const available = () => !loadError() && !sshServiceUnsupported() && (!!capabilities()?.screen || loginDesktopAvailable()) && (mode() === 'view' || !!capabilities()?.input || loginDesktopAvailable())
    && (capabilities()?.state === 'ready' || loginDesktopAvailable() || authorization());
  const connectionReady = () => full() && available() && !preparing();
  const canConnect = () => connectionReady() && !busy() && !refreshing();
  const failure = () => actionError() ?? loadError();

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (refreshRequest) return refreshRequest;
    clearTimeout(refreshTimer); setRefreshing(true);
    refreshRequest = (async () => {
      try {
        const next = await getRemoteDesktopStatus(sshPhysical());
        if (disposed) return;
        setLoadError(undefined); setStatus(next);
        if (!(next.capabilities.displays ?? []).some(item => item.id === display())) {
          setDisplay(displays().find(item => item.id === next.last_display_id)?.id ?? displays().find(item => item.primary)?.id ?? displays()[0]?.id ?? '');
        }
        if (preparing()) refreshTimer = setTimeout(() => void refresh(), 1500);
      } catch (error) {
        if (!disposed) setLoadError(desktopFailure('remoteDesktop.statusFailed', error));
      } finally { refreshRequest = undefined; if (!disposed) setRefreshing(false); }
    })();
    return refreshRequest;
  };
  onMount(() => {
    void refresh(); window.addEventListener('focus', refresh);
    void remoteDesktopDeploymentInDesktopShell({ action: 'capabilities' }).then(result => { if (!disposed) setSSHDeploymentAvailable(result.available === true); }).catch(() => {});
    onCleanup(onRemoteDesktopDeploymentProgress(progress => {
      const current=deployment();if(disposed||!current||progress.operation_id!==current.id||['complete','failed','connection_failed'].includes(current.phase))return;
      setDeployment({...current,progress,phase:current.phase==='canceling'?'canceling':progress.stage==='authorization_required'?'password':progress.stage==='confirmation_required'?'confirmation':'preparing'});
    }));
  });
  onCleanup(() => {
    disposed=true;connectionAttempt++;pendingPopup?.close();setAdministratorPassword('');
    const current=deployment();if(current)void remoteDesktopDeploymentInDesktopShell({action:'cancel',operationId:current.id}).catch(()=>{});
    clearTimeout(refreshTimer);window.removeEventListener('focus',refresh);
  });


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
    if (sshServiceUnsupported()) return i18n.t('remoteDesktop.unsupported');
    if (needsSSHSetup()) return i18n.t(serviceUpdateRequired() ? 'remoteDesktop.deployUpdate' : loginService()?.state === 'stopped' ? 'remoteDesktop.serviceStopped' : 'remoteDesktop.deploySetup');
    if (capabilities()?.state === 'locked') return i18n.t('remoteDesktop.locked');
    if (capabilities()?.state === 'setup_required') return i18n.t('remoteDesktop.setupRequired');
    if (available() && approvalCopy()) return i18n.t(approvalCopy()!);
    if (macPermission() || authorization()) return i18n.t('remoteDesktop.permissionRequired');
    return i18n.t(available() ? 'remoteDesktop.ready' : 'remoteDesktop.unsupported');
  };
  const stateHint = (): EnvAppTranslationKey | undefined => {
    if (!full()) return 'remoteDesktop.accessRequired';
    if (sshServiceUnsupported()) return 'remoteDesktop.deployPlatformUnsupported';
    if (serviceUpdateRequired()) return 'remoteDesktop.serviceUpdateRequired';
    if (needsSSHSetup()) return 'remoteDesktop.deployHint';
    if (sshManaged()) {
      switch (capabilities()?.reason) {
        case 'DISPLAY_DISCONNECTED': return 'remoteDesktop.displayDisconnected';
        case 'DISPLAY_INACTIVE': return 'remoteDesktop.displayInactive';
        case 'GPU_SCANOUT_UNSUPPORTED': return 'remoteDesktop.gpuUnsupported';
        case 'LOGIN_SESSION_UNSUPPORTED': return 'remoteDesktop.sessionUnsupported';
      }
    }
    if (!status() || preparing() || capabilities()?.state === 'setup_required') return undefined;
    if (capabilities()?.state === 'locked') return lockedDesktopAvailable() ? 'remoteDesktop.lockedHint' : 'remoteDesktop.serviceUnsupported';
    if (macPermission()) return 'remoteDesktop.permissionHint';
    if (available() && !sshManaged() && capabilities()?.backend === 'wayland' && (!status()?.unattended || !capabilities()?.unattended || capabilities()?.authorization === 'needs_consent')) return 'remoteDesktop.authorizationHint';
    if (capabilities()?.state === 'session_unavailable') return loginDesktopAvailable() ? 'remoteDesktop.lockedHint' : 'remoteDesktop.sessionHint';
    if (capabilities()?.state === 'unsupported') return 'remoteDesktop.unsupportedHostHint';
    if (!available() && !loadError()) return 'remoteDesktop.connectionHint';
    return undefined;
  };
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
  const open = async (claim: boolean): Promise<boolean> => {
    if (!canConnect()) return false;
    const attempt = ++connectionAttempt;
    const canceled = () => disposed || attempt !== connectionAttempt;
    setBusy('connect'); setActionError(undefined); setConfirmation(undefined); setOpened(false);
    const desktop = desktopShellWebServiceWindowOpenAvailable();
    let popup: Window | null = null, created: string | undefined;
    try {
      popup = desktop ? null : window.open('', '_blank');
      pendingPopup = popup;
      if (!desktop && !popup) {
        setActionError({ title: 'remoteDesktop.connectionFailed', hint: 'webServices.errors.popupBlocked' });
        return false;
      }
      const session = await createRemoteDesktop({ mode: mode(), display_id: display(), locale: i18n.locale(), theme: document.documentElement.dataset.floeShellTheme ?? '', host_name: hostName(), takeover: claim, ...(sshPhysical()?{target:'ssh_physical' as const}:{}) });
      created = session.id;
      if (canceled() || popup?.closed) { popup?.close(); await disconnectRemoteDesktop(session.id).catch(() => {}); return false; }
      const route = resolveWebServiceOpenRoute({ forwardID: session.forward_id, localRuntime: env.localRuntime(), desktopContext: readDesktopSessionContextSnapshot(), appPath: '/_redeven_desktop/', desktopWindowAvailable: desktop, presentation: 'desktop' });
      await openWebServiceRoute(route, session.forward_id, session.target_url, 'unified_proxy', '/_redeven_desktop/', desktop, () => {}, {
        missingEnvContext: i18n.t('webServices.errors.missingEnvContext'), opening: i18n.t('remoteDesktop.connecting'),
        openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'), requestingEntryTicket: i18n.t('webServices.status.requestingEntryTicket'),
        updating: i18n.t('webServices.status.updating'), desktopWindowFailed: i18n.t('webServices.errors.desktopWindowFailed'), popupBlocked: i18n.t('webServices.errors.popupBlocked'),
      }, popup, 'desktop');
      if (canceled()) { popup?.close(); await disconnectRemoteDesktop(session.id).catch(() => {}); return false; }
      pendingPopup = null;
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
      if (!canceled()) { setOpened(true); props.onConnected?.(); }
      return true;
    } catch (error) {
      popup?.close(); if (created) await disconnectRemoteDesktop(created).catch(() => {});
      if (!canceled()) {
        if (error instanceof LocalApiError && error.code === 'DESKTOP_CONTROL_IN_USE') setConfirmation('takeover');
        else setActionError(desktopFailure('remoteDesktop.connectionFailed', error, created ? 'remoteDesktop.windowFailed' : 'remoteDesktop.connectionHint'));
      }
      return false;
    } finally { if (!canceled()) { pendingPopup = null; setBusy(undefined); void refresh(); } }
  };
  const cancelConnection = () => { connectionAttempt++; pendingPopup?.close(); pendingPopup = null; setBusy(undefined); setDeployment(undefined); restoreFocus(); };
  const showConfirmation = (value: 'takeover' | 'forget') => { rememberFocus(); setConfirmation(value); };
  const closeConfirmation = () => { setConfirmation(undefined); restoreFocus(); };

  const operationLabels: Record<DesktopDeploymentOperation, EnvAppTranslationKey> = {
    ensure: 'remoteDesktop.deployEnsure', stop: 'remoteDesktop.deployStop', uninstall: 'remoteDesktop.deployUninstall',
  };
  const showDeployment = (operation: DesktopDeploymentOperation, connectAfterSetup = false) => {
    if (!full() || busy()) return;
    rememberFocus(); setAdministratorPassword(''); setActionError(undefined);
    setDeployment({ id:crypto.randomUUID(), operation, connectAfterSetup, phase:'authorizing', method:'sudo' });
  };
  const cancelDeployment = async () => {
    const current=deployment(); if(!current)return;
    setAdministratorPassword('');
    if(current.phase==='connecting'){cancelConnection();return;}
    if(current.phase==='canceling'){setDeployment(undefined);restoreFocus();return;}
    if(!['preparing','password','confirmation','canceling'].includes(current.phase)){setDeployment(undefined);restoreFocus();return;}
    setDeployment({...current,phase:'canceling'});
    void remoteDesktopDeploymentInDesktopShell({action:'cancel',operationId:current.id}).catch(()=>{});
  };
  const changeAdministratorMethod = async (method:DesktopAdministratorMethod) => {
    const current=deployment();if(!current||method===current.method)return;
    setAdministratorPassword('');
    if(current.phase!=='password'){setDeployment({...current,method});return;}
    const id=crypto.randomUUID();
    setDeployment({...current,id,method,phase:'canceling',progress:undefined,result:undefined});
    await remoteDesktopDeploymentInDesktopShell({action:'cancel',operationId:current.id}).catch(()=>{});
    if(!disposed&&deployment()?.id===id)setDeployment({...current,id,method,phase:'authorizing',progress:undefined,result:undefined});
  };
  const respondDeployment = async () => {
    const current=deployment(), challenge=current?.progress?.challenge_id;
    if(!current||!challenge||!['password','confirmation'].includes(current.phase))return;
    const credential=administratorPassword();setAdministratorPassword('');
    if(current.phase==='password'&&!credential)return;
    const submitted={...current,phase:'preparing' as const};
    setDeployment(submitted);
    const result=await remoteDesktopDeploymentInDesktopShell({action:'respond',operationId:current.id,challengeId:challenge,...(current.phase==='password'?{administratorPassword:credential}:{confirmed:true as const})}).catch(()=>({ok:false,code:'transport_interrupted'}));
    if(!disposed&&deployment()===submitted&&!result.ok){void remoteDesktopDeploymentInDesktopShell({action:'cancel',operationId:current.id}).catch(()=>{});setDeployment({...submitted,phase:'failed',result});}
  };
  const manageDeployment = async () => {
    const current=deployment();if(!current||!full()||!['authorizing','failed'].includes(current.phase))return;
    const id=current.phase==='failed'?crypto.randomUUID():current.id;
    const running={...current,id,phase:'preparing' as const,result:undefined,progress:undefined};
    setDeployment(running);setAdministratorPassword('');setActionError(undefined);
    try {
      const result=await remoteDesktopDeploymentInDesktopShell({action:'manage',operationId:id,operation:current.operation,confirmed:true,administratorMethod:current.method});
      if(disposed||deployment()?.id!==id)return;
      setAdministratorPassword('');
      if(!result.ok){setDeployment({...running,phase:'failed',result});void refresh();return;}
      if(!current.connectAfterSetup||deployment()?.phase==='canceling'){setDeployment({...running,phase:'complete',result});void refresh();return;}
      setDeployment({...running,phase:'connecting',result});await refresh();
      if(disposed||deployment()?.id!==id)return;
      await continueDeploymentConnection();
    } catch {
      if(!disposed&&deployment()?.id===id)setDeployment({...running,phase:'failed',result:{ok:false,code:'transport_interrupted',rollback:'unknown'}});
    }
  };
  const continueDeploymentConnection = async (claim = false) => {
    const current=deployment();if(!current)return;
    if (!connectionReady()) { setDeployment({...current,phase:'connection_failed'});setActionError({title:'remoteDesktop.connectionFailed',hint:stateHint()??'remoteDesktop.connectionHint'});return; }
    setDeployment({...current,phase:'connecting'});setActionError(undefined);
    const connected=await open(claim);
    if(disposed||deployment()?.id!==current.id)return;
    if(connected)setDeployment(undefined);
    else {setDeployment({...current,phase:'connection_failed'});if(!actionError())setActionError({title:'remoteDesktop.connectionFailed',hint:stateHint()??'remoteDesktop.connectionHint'});}
  };
  const deploymentStep = () => ['authorizing','password'].includes(deploymentPhase()) ? 0 : ['preparing','confirmation','canceling','failed'].includes(deploymentPhase()) ? 1 : 2;
  const deploymentStageCopy = (): EnvAppTranslationKey => {
    switch (deploymentProgress()?.stage) {
      case 'checking': return 'remoteDesktop.deployChecking';
      case 'preparing_media': return 'remoteDesktop.preparing';
      case 'transferring': case 'verifying_files': return 'remoteDesktop.deployTransferring';
      case 'authorization_required': case 'authorized': return 'remoteDesktop.deployAuthorizing';
      case 'rolling_back': case 'rolled_back': return 'remoteDesktop.deployRollback';
      default: return 'remoteDesktop.deployApplying';
    }
  };
  const deploymentFailureCopy = (): EnvAppTranslationKey => {
    switch (deploymentResult()?.code) {
      case 'canceled': return 'remoteDesktop.deployCanceled';
      case 'administrator_required': case 'authorization_failed': case 'authorization_unavailable': case 'authentication_challenge_unsupported': case 'authorization_timeout': return 'remoteDesktop.deployAuthFailed';
      case 'runtime_identity_changed': return 'remoteDesktop.deployIdentityFailed';
      case 'installation_ownership_conflict': case 'retained_version_untrusted': case 'deployment_path_untrusted': return 'remoteDesktop.deployOwnershipFailed';
      case 'installation_record_invalid': return 'remoteDesktop.deployVersionFailed';
      case 'transport_interrupted': case 'transaction_commit_unknown': return 'remoteDesktop.deployTransportFailed';
      case 'runtime_authentication_failed': return 'remoteDesktop.deployVerificationFailed';
      case 'management_protocol_invalid': case 'challenge_expired': return 'remoteDesktop.deployProtocolFailed';
      case 'permission_denied': return 'remoteDesktop.accessRequired';
      case 'unsupported_target': return 'remoteDesktop.deploySSHRequired';
      default: return 'remoteDesktop.deployFailed';
    }
  };

  return <section ref={panel} class="remote-desktop-panel" aria-label={i18n.t('remoteDesktop.title')} onKeyDown={event => {
    if (event.key === 'Escape' && confirmation()) { event.preventDefault(); event.stopPropagation(); closeConfirmation(); }
  }}>
    <MatchSwitch>
    <Match when={!deploymentOperation() && !confirmation() && busy() !== 'connect'}>
    <div class="remote-desktop-host">
      <div class="remote-desktop-host-icon" aria-hidden="true"><RemoteDesktopIcon size={24} /></div>
      <div class="remote-desktop-identity">
        <h3 title={hostName()}>{hostName()}</h3>
        <p class="remote-desktop-state" role="status"><span class="remote-desktop-state-dot" data-ready={capabilities()?.state === 'ready' && available() && full() && !preparing() && (capabilities()?.backend !== 'wayland' || capabilities()?.authorization === 'saved' && status()?.unattended)} aria-hidden="true" />{stateCopy()}</p>
      </div>
      <Button size="icon" variant="ghost" disabled={refreshing() || !!busy()} aria-label={i18n.t('remoteDesktop.refresh')} title={i18n.t('remoteDesktop.refresh')} onClick={() => void refresh()}><Refresh size={16} class={refreshing() ? 'animate-spin motion-reduce:animate-none' : ''} /></Button>
    </div>
    <p class="remote-desktop-description">{i18n.t('remoteDesktop.description')}</p>
    <Show when={!failure() && stateHint()}>{key => <p class="remote-desktop-guidance">{i18n.t(key())}</p>}</Show>
    <Show when={!sshManaged() && (status()?.capabilities.state === 'setup_required' || preparing())}>
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
          <Button variant="outline" disabled={!full() || !!busy() || preparing()} onClick={() => void runAction('prepare', 'remoteDesktop.prepareFailed', prepareRemoteDesktop)}><StableText class="text-center" reserve={[i18n.t('remoteDesktop.preparing'), i18n.t('remoteDesktop.prepare')]}>{i18n.t(preparing() ? 'remoteDesktop.preparing' : 'remoteDesktop.prepare')}</StableText></Button>
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
    <Show when={!sshManaged() && capabilities()?.backend === 'wayland' && capabilities()?.unattended}><div class="remote-desktop-option remote-desktop-sharing"><Switch checked={pendingApproval() ?? status()?.unattended ?? false} disabled={!full() || !!busy() || refreshing()} onChange={rememberApproval} label={i18n.t('remoteDesktop.unattended')} description={i18n.t('remoteDesktop.unattendedHint')} /></div></Show>
    <Show when={sshManaged() && loginService()?.state === 'active'}><p class="remote-desktop-service-status">{i18n.t('remoteDesktop.serviceActive')}</p></Show>
    <details class="remote-desktop-options" open={optionsOpen()} onToggle={event => setOptionsOpen(event.currentTarget.open)}>
      <summary><ChevronRight size={14} aria-hidden="true" /><span>{i18n.t('remoteDesktop.options')}</span><span class="remote-desktop-mode">{i18n.t(mode() === 'view' ? 'remoteDesktop.view' : 'remoteDesktop.control')}</span></summary>
      <Show when={sshManaged() && (serviceUpdateRequired() || ['active', 'stopped'].includes(loginService()?.state ?? ''))}><div class="remote-desktop-actions remote-desktop-service-actions">
        <For each={['ensure', ...(loginService()?.state === 'active' ? ['stop'] : []), 'uninstall'] as DesktopDeploymentOperation[]}>{operation => <Button data-desktop-focus={operation} variant="outline" disabled={!full() || !!busy()} onClick={() => showDeployment(operation)}>{i18n.t(operationLabels[operation])}</Button>}</For>
      </div></Show>
      <div class="remote-desktop-option"><Switch checked={mode() === 'view'} disabled={!!busy()} onChange={value => setMode(value ? 'view' : 'control')} label={i18n.t('remoteDesktop.view')} description={i18n.t('remoteDesktop.viewHint')} /></div>
      <Show when={!sshManaged() && capabilities()?.backend === 'wayland' && capabilities()?.unattended && ['saved', 'unknown', 'revoked'].includes(capabilities()?.authorization ?? '')}>
        <div class="remote-desktop-option"><Button data-desktop-focus="forget" variant="outline" disabled={!full() || !!busy() || refreshing()} onClick={() => showConfirmation('forget')}>{i18n.t('remoteDesktop.approvalForget')}</Button></div>
      </Show>
    </details>
    <Show when={failure()}>{problem => <div class="remote-desktop-error" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <div><strong>{i18n.t(problem().title)}</strong><p>{i18n.t(problem().hint)}</p>
        <Show when={problem().diagnostic}><details><summary>{i18n.t('remoteDesktop.errorDetails')}</summary><code>{problem().diagnostic}</code></details></Show>
      </div>
    </div>}</Show>
    <div class="remote-desktop-footer">
      <Button class="remote-desktop-connect" data-desktop-focus="connect" disabled={sshManaged() ? !full() || !!busy() || refreshing() || sshCaptureUnavailable() : !canConnect()} aria-describedby={descriptionID} onClick={() => { rememberFocus(); if (sshManaged()) showDeployment('ensure', true); else if (status()?.control_in_use && mode() === 'control') showConfirmation('takeover'); else void open(false); }}>
        <StableText class="text-center" reserve={[i18n.t('remoteDesktop.connecting'), i18n.t('remoteDesktop.connect')]}>{i18n.t(needsSSHSetup() ? 'remoteDesktop.connect' : busy() === 'connect' ? 'remoteDesktop.connecting' : 'remoteDesktop.connect')}</StableText><ArrowRight size={16} aria-hidden="true" />
      </Button>
      <p id={descriptionID} role={opened() ? 'status' : undefined}>{i18n.t(opened() ? 'remoteDesktop.windowOpened' : 'remoteDesktop.openHint')}</p>
    </div>
    </Match>
    <Match when={confirmation()}>
      {value => <div class="remote-desktop-inline-step">
        <h3 tabIndex={-1} ref={focusStep}>{i18n.t(value() === 'takeover' ? 'remoteDesktop.takeover' : 'remoteDesktop.approvalForget')}</h3>
        <p>{i18n.t(value() === 'takeover' ? 'remoteDesktop.takeoverHint' : 'remoteDesktop.approvalForgetHint')}</p>
        <div class="remote-desktop-flow-footer">
          <Button variant="ghost" onClick={closeConfirmation}>{i18n.t('remoteDesktop.cancel')}</Button>
          <Button disabled={!full() || !!busy()} onClick={() => {
            if (value() === 'takeover') void (deploymentOperation() ? continueDeploymentConnection(true) : open(true));
            else { closeConfirmation(); void runAction('forget', 'remoteDesktop.approvalForgetFailed', forgetRemoteDesktopAuthorization); }
          }}>{i18n.t(value() === 'takeover' ? 'remoteDesktop.takeover' : 'remoteDesktop.approvalForgetConfirm')}</Button>
        </div>
      </div>}
    </Match>
    <Match when={deploymentOperation()}>
      {operation => <div class="remote-desktop-deployment-flow">
        <div class="remote-desktop-flow-header">
          <div class="remote-desktop-flow-icon" aria-hidden="true"><RemoteDesktopIcon size={22} /></div>
          <div>
            <p class="remote-desktop-flow-eyebrow" title={hostName()}>{hostName()}</p>
            <h3>{i18n.t(operationLabels[operation()])}</h3>
          </div>
        </div>
        <ol class="remote-desktop-flow-steps" data-count={deploymentConnectIntent() ? 3 : 2} style={{ 'grid-template-columns': `repeat(${deploymentConnectIntent() ? 3 : 2}, minmax(0, 1fr))` }} aria-label={i18n.t('remoteDesktop.connectionProgress')}>
          <For each={deploymentConnectIntent() ? ['remoteDesktop.authorizeStep', 'remoteDesktop.installStep', 'remoteDesktop.connectStep'] as const : ['remoteDesktop.authorizeStep', 'remoteDesktop.installStep'] as const}>{(key, index) => <li class="remote-desktop-flow-step" data-state={deploymentStep() > index() ? 'complete' : deploymentStep() === index() ? 'active' : 'upcoming'} aria-current={deploymentStep() === index() ? 'step' : undefined}>
            <span class="remote-desktop-flow-step-index" aria-hidden="true"><Show when={deploymentStep() > index()} fallback={index() + 1}><Check size={13} /></Show></span>
            <span>{i18n.t(key)}</span>
          </li>}</For>
        </ol>
        <div class="remote-desktop-flow-content">
          <Show when={deploymentProgress()?.host}><p>{deploymentProgress()?.host} · {deploymentProgress()?.ssh_user}</p></Show>
          <Show when={deploymentPhase()==='confirmation'}><div class="remote-desktop-flow-stage" role="alert"><h4 tabIndex={-1} ref={focusStep}>{i18n.t('remoteDesktop.deployInterruptTitle')}</h4><p>{i18n.t(deploymentProgress()?.active_connections===undefined?'remoteDesktop.deployInterruptUnknown':'remoteDesktop.deployInterruptHint')}</p><div class="remote-desktop-actions"><Button onClick={()=>void respondDeployment()}>{i18n.t('remoteDesktop.deployInterruptConfirm')}</Button></div></div></Show>

          <Show when={['authorizing','password','failed'].includes(deploymentPhase())}>
            <div class="remote-desktop-flow-stage" data-phase="authorizing">
            <h4 class="remote-desktop-step-title" tabIndex={-1} ref={focusStep}>{i18n.t('remoteDesktop.authorizeStep')}</h4>
            <div class="remote-desktop-flow-copy">
              <p>{i18n.t('remoteDesktop.deployScope')}</p>
              <Show when={deploymentConnectIntent()}><p class="remote-desktop-flow-note">{i18n.t('remoteDesktop.deployHint')}</p></Show>
            </div>
            <label class="remote-desktop-credential"><span>{i18n.t('remoteDesktop.deployAuthMethod')}</span><select value={deployment()?.method} onChange={event=>void changeAdministratorMethod(event.currentTarget.value as DesktopAdministratorMethod)}><option value="sudo">{i18n.t('remoteDesktop.deploySudoPassword')}</option><option value="root">{i18n.t('remoteDesktop.deployRootPassword')}</option></select></label>
            <Show when={deploymentPhase()==='password'}><label class="remote-desktop-credential"><span>{i18n.t(deployment()?.method==='root'?'remoteDesktop.deployRootPassword':'remoteDesktop.deploySudoPassword')}</span>
              <input ref={focusStep} type="password" autocomplete="off" disabled={deploymentPhase()!=='password'} value={administratorPassword()} onInput={event => setAdministratorPassword(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void respondDeployment(); } }} />
              <span class="remote-desktop-credential-hint">{i18n.t('remoteDesktop.deployPasswordHint')}</span>
            </label></Show>
            </div>
          </Show>
          <Show when={['preparing','canceling'].includes(deploymentPhase())}>
            <div class="remote-desktop-flow-stage" data-phase="applying">
              <div class="remote-desktop-flow-transition" role="status">
                <span class="remote-desktop-flow-spinner" aria-hidden="true" />
                <div><h4 class="remote-desktop-step-title" tabIndex={-1} ref={focusStep}>{i18n.t(cancelingDeployment() ? 'remoteDesktop.deployRollback' : 'remoteDesktop.installStep')}</h4><p>{i18n.t('remoteDesktop.deployPasswordHint')}</p></div>
              </div>

              <div class="remote-desktop-deployment-progress"><p>{i18n.t(deploymentStageCopy())}</p><Show when={deploymentProgress()?.expected_bytes} fallback={<progress aria-label={i18n.t(deploymentStageCopy())} />}>
                {total => <progress aria-label={i18n.t(deploymentStageCopy())} max={total()} value={deploymentProgress()?.received_bytes ?? 0} />}
              </Show></div>
            </div>
          </Show>
          <Show when={deploymentPhase() === 'connecting'}>
            <div class="remote-desktop-flow-transition" data-phase="connecting">
              <span class="remote-desktop-flow-spinner" aria-hidden="true" />
              <div><h4 class="remote-desktop-step-title" tabIndex={-1} ref={focusStep}>{i18n.t('remoteDesktop.connecting')}</h4><p>{i18n.t('remoteDesktop.connectionContinuing')}</p></div>
            </div>
          </Show>
          <Show when={deploymentPhase() === 'connection_failed'}>
            <div class="remote-desktop-flow-transition" data-phase="failed" role="alert">
              <span class="remote-desktop-flow-status-icon" aria-hidden="true"><AlertCircle size={18} /></span>
              <div><h4 class="remote-desktop-step-title" tabIndex={-1} ref={focusStep}>{i18n.t('remoteDesktop.connectionFailed')}</h4><p>{i18n.t(actionError()?.hint ?? 'remoteDesktop.connectionHint')}</p><Show when={actionError()?.diagnostic}><code>{actionError()?.diagnostic}</code></Show></div>
            </div>
          </Show>
          <Show when={deploymentPhase() === 'complete'}><div class="remote-desktop-flow-transition" data-phase="complete" role="status">
            <span class="remote-desktop-flow-status-icon" data-success aria-hidden="true"><Check size={18} /></span>
            <div><h4 class="remote-desktop-step-title" tabIndex={-1} ref={focusStep}>{i18n.t('remoteDesktop.deploymentComplete')}</h4><p>{i18n.t(operationLabels[operation()])}</p></div>
          </div></Show>
          <Show when={deploymentResult() && !deploymentResult()?.ok}><div class="remote-desktop-deployment-result" role="alert">
            <p>{i18n.t(deploymentFailureCopy())}</p><code>{deploymentResult()?.code}</code>
            <Show when={deploymentResult()?.rollback}>{rollback => <p>{i18n.t(rollback() === 'complete' ? 'remoteDesktop.deployRolledBack' : rollback() === 'failed' ? 'remoteDesktop.deployRollbackFailed' : 'remoteDesktop.deployRollbackUnknown')}</p>}</Show>
          </div></Show>
        </div>
        <div class="remote-desktop-flow-footer">
          <Button variant="ghost" onClick={() => void cancelDeployment()}>{i18n.t(['authorizing','preparing','password','confirmation','canceling','failed','connecting'].includes(deploymentPhase()) ? 'remoteDesktop.cancel' : 'remoteDesktop.backToConnection')}</Button>
          <Show when={['authorizing','password','failed'].includes(deploymentPhase())}>
            <Button disabled={deploymentPhase()==='password'?!administratorPassword():!!busy()} onClick={() => void (deploymentPhase()==='password'?respondDeployment():manageDeployment())}><StableText class="text-center" reserve={[i18n.t('remoteDesktop.deployConfirm'), i18n.t('remoteDesktop.installStep')]}>{i18n.t('remoteDesktop.deployConfirm')}</StableText></Button>
          </Show>
          <Show when={['preparing','canceling'].includes(deploymentPhase())}><Button disabled aria-busy="true"><StableText class="text-center" reserve={[i18n.t('remoteDesktop.deployConfirm'), i18n.t('remoteDesktop.installStep')]}>{i18n.t('remoteDesktop.installStep')}</StableText></Button></Show>
          <Show when={deploymentPhase() === 'connection_failed'}>
            <Button disabled={!!busy() || refreshing()} onClick={() => {
              const attempt = deployment()?.id, reconnect=connectionReady();
              void refresh().then(() => {
                if (disposed || attempt !== deployment()?.id || !deploymentOperation()) return;
                if (reconnect && canConnect()) void continueDeploymentConnection();
                else setActionError({ title: 'remoteDesktop.connectionFailed', hint: stateHint() ?? 'remoteDesktop.connectionHint' });
              });
            }}>{i18n.t(connectionReady() ? 'remoteDesktop.connect' : 'remoteDesktop.refresh')}</Button>
          </Show>
        </div>
      </div>}
    </Match>
    <Match when={busy() === 'connect'}><div class="remote-desktop-inline-step">
      <div class="remote-desktop-flow-transition" role="status"><span class="remote-desktop-flow-spinner" aria-hidden="true" /><div><h3 class="remote-desktop-step-title" tabIndex={-1} ref={focusStep}>{i18n.t('remoteDesktop.connecting')}</h3><p>{hostName()}</p></div></div>
      <div class="remote-desktop-flow-footer"><Button variant="ghost" onClick={cancelConnection}>{i18n.t('remoteDesktop.cancel')}</Button></div>
    </div></Match>
    </MatchSwitch>
  </section>;
}
