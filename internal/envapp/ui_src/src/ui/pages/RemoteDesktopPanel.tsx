import { Button, StableText } from '@floegence/floe-webapp-core/ui';
import { MonitorPointer, Refresh } from '@floegence/floe-webapp-core/icons';
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Dialog, ConfirmDialog } from '../primitives/EnvAppModal';
import { useI18n } from '../i18n';
import { useEnvContext } from './EnvContext';
import { cancelRemoteDesktopPreparation, createRemoteDesktop, disconnectRemoteDesktop, getRemoteDesktopStatus, prepareRemoteDesktop, setRemoteDesktopUnattended, type RemoteDesktopStatus } from '../services/remoteDesktopApi';
import { desktopShellWebServiceWindowOpenAvailable } from '../services/desktopShellBridge';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { openWebServiceRoute, resolveWebServiceOpenRoute } from '../services/webServiceWindows';
import { requestHostApplicationPermission } from '../services/hostApplicationsApi';
import { LocalApiError } from '../services/localApi';

export function RemoteDesktopLauncher() {
  const [open, setOpen] = createSignal(false);
  const i18n = useI18n();
  return <><Button variant="outline" onClick={() => setOpen(true)}><MonitorPointer class="w-4 h-4" />{i18n.t('remoteDesktop.title')}</Button>
    <Dialog open={open()} onOpenChange={setOpen} title={i18n.t('remoteDesktop.title')} bodyDescription={i18n.t('remoteDesktop.description')} closeLabel={i18n.t('common.actions.close')}>
      <Show when={open()}><RemoteDesktopPanel /></Show>
    </Dialog></>;
}

export function RemoteDesktopPanel() {
  const env = useEnvContext(), i18n = useI18n();
  const [status, setStatus] = createSignal<RemoteDesktopStatus>();
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [mode, setMode] = createSignal<'view' | 'control'>('control');
  const [display, setDisplay] = createSignal('');
  const [takeover, setTakeover] = createSignal(false);
  let disposed = false, refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const full = () => !!env.env()?.permissions?.can_read && !!env.env()?.permissions?.can_write && !!env.env()?.permissions?.can_execute;
  const preparing = () => ['checking', 'downloading', 'receiving', 'verifying', 'installing', 'validating'].includes(status()?.setup?.state ?? '');
  const refresh = async () => {
    clearTimeout(refreshTimer);
    try { const next = await getRemoteDesktopStatus(); if (!disposed) { setError(''); setStatus(next); if (!next.capabilities.displays.some(item => item.id === display())) setDisplay(next.capabilities.displays.find(item => item.id === next.last_display_id)?.id ?? next.capabilities.displays.find(item => item.primary)?.id ?? ''); if (preparing()) refreshTimer = setTimeout(() => void refresh(), 1500); } }
    catch { if (!disposed) setError(i18n.t('remoteDesktop.failure')); }
  };
  onMount(() => void refresh());
  onCleanup(() => { disposed = true; clearTimeout(refreshTimer); });
  const stateCopy = () => {
    const value = status()?.capabilities.state;
    if (!value) return i18n.t('remoteDesktop.connecting');
    if (value === 'ready') return i18n.t('remoteDesktop.ready');
    if (value === 'locked') return i18n.t('remoteDesktop.locked');
    if (value === 'setup_required') return i18n.t('remoteDesktop.setupRequired');
    if (/permission|authorization|host_action/.test(value)) return i18n.t('remoteDesktop.permissionRequired');
    return i18n.t('remoteDesktop.unsupported');
  };
  const open = async (claim: boolean) => {
    if (busy() || !full()) return;
    setBusy(true); setError(''); setTakeover(false);
    const desktop = desktopShellWebServiceWindowOpenAvailable();
    const popup = desktop ? null : window.open('', '_blank');
    let created: string | undefined;
    try {
      if (!desktop && !popup) throw new Error('POPUP_BLOCKED');
      const session = await createRemoteDesktop({ mode: mode(), display_id: display(), locale: i18n.locale(), theme: document.documentElement.dataset.floeShellTheme ?? '', host_name: env.env()?.name ?? env.env_id(), takeover: claim });
      created = session.id;
      const route = resolveWebServiceOpenRoute({ forwardID: session.forward_id, localRuntime: env.localRuntime(), desktopContext: readDesktopSessionContextSnapshot(), appPath: '/_redeven_desktop/', desktopWindowAvailable: desktop });
      await openWebServiceRoute(route, session.forward_id, session.target_url, 'unified_proxy', '/_redeven_desktop/', desktop, () => {}, {
        missingEnvContext: i18n.t('webServices.errors.missingEnvContext'), opening: i18n.t('remoteDesktop.connecting'),
        openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'), requestingEntryTicket: i18n.t('webServices.status.requestingEntryTicket'),
        updating: i18n.t('webServices.status.updating'), desktopWindowFailed: i18n.t('webServices.errors.desktopWindowFailed'), popupBlocked: i18n.t('webServices.errors.popupBlocked'),
      }, popup, 'desktop');
      if (popup) {
        const files = (event: MessageEvent) => {
          if (event.source === popup && event.data?.type === 'redeven:remote-desktop:files' && event.data.session_id === session.id) { env.openSurface('files'); window.focus(); }
        };
        window.addEventListener('message', files);
        const closed = setInterval(() => { if (popup.closed) { clearInterval(closed); window.removeEventListener('message', files); void disconnectRemoteDesktop(session.id).catch(() => {}); } }, 1000);
      }
    } catch (failure) {
      popup?.close(); if (created) await disconnectRemoteDesktop(created).catch(() => {});
      if (!disposed) {
        if (failure instanceof LocalApiError && failure.code === 'DESKTOP_CONTROL_IN_USE') setTakeover(true);
        else setError(i18n.t('remoteDesktop.failure'));
      }
    } finally { if (!disposed) { setBusy(false); void refresh(); } }
  };
  const prepare = async () => { setBusy(true); setError(''); try { await prepareRemoteDesktop(); await refresh(); } catch { setError(i18n.t('remoteDesktop.failure')); } finally { setBusy(false); } };
  return <div class="p-4 space-y-5">
    <div class="flex items-start justify-between gap-3"><div class="min-w-0"><div class="font-medium truncate">{env.env()?.name ?? env.env_id()}</div><p class="text-sm text-muted-foreground" role="status">{stateCopy()}</p></div><Button variant="ghost" aria-label={i18n.t('remoteDesktop.refresh')} onClick={() => void refresh()}><Refresh class="w-4 h-4" /></Button></div>
    <Show when={status()?.capabilities.state === 'setup_required' || preparing()}><div class="space-y-3"><p class="text-sm text-muted-foreground">{i18n.t('remoteDesktop.setupHint')}</p><Show when={preparing()}><progress class="w-full" aria-label={i18n.t('remoteDesktop.preparing')} max={status()?.setup?.expected_bytes || 1} value={status()?.setup?.received_bytes || 0} /></Show><Show when={status()?.setup?.error_code}><p role="alert" class="text-sm text-destructive">{i18n.t('remoteDesktop.failure')}</p></Show><div class="flex flex-wrap gap-2"><Button disabled={!full() || busy() || preparing()} onClick={() => void prepare()}><StableText reserve={[i18n.t('remoteDesktop.preparing'), i18n.t('remoteDesktop.prepare')]}>{i18n.t(preparing() ? 'remoteDesktop.preparing' : 'remoteDesktop.prepare')}</StableText></Button><Show when={status()?.setup?.can_cancel}><Button variant="outline" disabled={busy()} onClick={async () => { const id = status()?.setup?.operation_id; if (id) { setBusy(true); try { await cancelRemoteDesktopPreparation(id); await refresh(); } catch { setError(i18n.t('remoteDesktop.failure')); } finally { setBusy(false); } } }}>{i18n.t('remoteDesktop.cancel')}</Button></Show></div></div></Show>
    <Show when={status()?.capabilities.backend === 'macos' && (!status()?.capabilities.screen || !status()?.capabilities.input)}><div class="space-y-3"><p class="text-sm text-muted-foreground">{i18n.t('remoteDesktop.permissionHint')}</p><div class="flex flex-wrap gap-2"><Button disabled={!full()} onClick={() => void requestHostApplicationPermission('screen_recording').then(refresh)}>{i18n.t('hostApplications.macAllowScreen')}</Button><Button disabled={!full()} onClick={() => void requestHostApplicationPermission('accessibility').then(refresh)}>{i18n.t('hostApplications.macAllowAccessibility')}</Button></div></div></Show>
    <Show when={status()?.capabilities.displays.length}><label class="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{i18n.t('remoteDesktop.display')}</span><select class="rounded-md border border-input bg-background p-2 max-w-full cursor-pointer" value={display()} onChange={event => setDisplay(event.currentTarget.value)}><For each={status()?.capabilities.displays}>{(item, index) => <option value={item.id}>{item.name || `${i18n.t('remoteDesktop.display')} ${index() + 1} · ${item.width} × ${item.height}`}</option>}</For></select></label></Show>
    <label class="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{i18n.t('remoteDesktop.control')}</span><select class="rounded-md border border-input bg-background p-2 cursor-pointer" value={mode()} onChange={event => setMode(event.currentTarget.value as 'view' | 'control')}><option value="control">{i18n.t('remoteDesktop.control')}</option><option value="view">{i18n.t('remoteDesktop.view')}</option></select></label>
    <div class="space-y-2"><label class="flex gap-2 items-center text-sm"><input type="checkbox" class="cursor-pointer" checked={status()?.unattended ?? false} disabled={!full() || busy()} onChange={async event => { const enabled = event.currentTarget.checked; try { await setRemoteDesktopUnattended(enabled); await refresh(); } catch { setError(i18n.t('remoteDesktop.failure')); } }} />{i18n.t('remoteDesktop.unattended')}</label><p class="text-xs text-muted-foreground">{i18n.t('remoteDesktop.unattendedHint')}</p></div>
    <Show when={error()}><p class="text-sm text-destructive" role="alert">{error()}</p></Show>
    <Button disabled={!full() || busy() || !status() || preparing() || status()?.capabilities.state === 'setup_required'} onClick={() => status()?.control_in_use && mode() === 'control' ? setTakeover(true) : void open(false)}><StableText reserve={[i18n.t('remoteDesktop.connecting'), i18n.t('remoteDesktop.connect')]}>{i18n.t(busy() ? 'remoteDesktop.connecting' : 'remoteDesktop.connect')}</StableText></Button>
    <ConfirmDialog open={takeover()} onOpenChange={setTakeover} title={i18n.t('remoteDesktop.takeover')} bodyDescription={i18n.t('remoteDesktop.takeoverHint')} confirmText={i18n.t('remoteDesktop.takeover')} cancelText={i18n.t('remoteDesktop.cancel')} onConfirm={() => void open(true)} />
  </div>;
}
