import { type FeedbackIndicatorEntry, Button, Dropdown, Input } from '@floegence/floe-webapp-core/ui';
import { createEnvCachedResource } from '../services/envResourceCache';
import { hostApplicationSnapshot } from '../services/envResourceSnapshots';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { useViewActivation, useResizeObserver } from '@floegence/floe-webapp-core';
import { Check, Filter, MoreHorizontal, ExternalLink, Plus, Refresh, Search, Stop } from '@floegence/floe-webapp-core/icons';
import { hostApplicationPresentation, hostApplicationLaunchFailureCopy } from '../services/hostApplicationPresentation';
import { renderHostApplicationLaunchDocument } from '../services/hostApplicationLaunchDocument';
import { ActivityBarHostApplicationsIcon } from '../icons/ActivityBarDockIcons';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { useEnvContext } from './EnvContext';
import { addHostApplication, cancelHostApplicationSetup, getHostApplicationSetup, getHostApplicationTransferPlan, hostApplicationSetupActive, observeHostApplicationSetup, startHostApplicationSetup, uploadHostApplicationSetup, requestHostApplicationPermission, launchHostApplication, listHostApplicationSessions, listHostApplications, listRunningHostApplications, quitHostApplication, terminateHostApplication, detachHostApplication, type RunningHostApplication, type HostApplication, type HostApplicationCatalog, type HostApplicationSession, type HostApplicationSetup, type HostApplicationTransferPlan } from '../services/hostApplicationsApi';
import { HostApplicationSetupPanel, hostApplicationSetupHeading, hostApplicationSetupProgress, hostApplicationDesktopDetail, type HostApplicationDesktopProgress } from './HostApplicationSetupPanel';
import type { HostApplicationComponentsProgress } from '../../../../../../desktop/src/shared/hostApplicationComponents';
import { updateHostApplicationPreparationDocument, type HostApplicationPreparationView } from '../../../../../../desktop/src/shared/hostApplicationPreparation';
import { desktopShellWebServiceWindowOpenAvailable } from '../services/desktopShellBridge';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { LocalApiError } from '../services/localApi';
import { openWebServiceRoute, resolveWebServiceOpenRoute } from '../services/webServiceWindows';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { HostApplicationsHeader, HostApplicationsListSkeleton } from './HostApplicationsPresentation';

class ComponentAcquisitionError extends Error {
  constructor(readonly translationKey: EnvAppTranslationKey) { super(translationKey); }
}

function ApplicationIcon(props: { app: HostApplication }) {
  return <span class="host-app-icon" aria-hidden="true">
    <Show when={props.app.icon.startsWith('data:image/png;base64,')} fallback={<ActivityBarHostApplicationsIcon class="w-6 h-6" />}>
      <img src={props.app.icon} alt="" draggable={false} />
    </Show>
  </span>;
}

export function EnvHostApplicationsPage() {
  const ctx = useEnvContext();
  const i18n = useI18n();
  let pageRoot: HTMLDivElement | undefined;
  const pageSize = useResizeObserver(() => pageRoot, { preserveWhenHidden: true });
  const compactLayout = () => (pageSize()?.width ?? 768) < 768;
  const [runningOnly, setRunningOnly] = createSignal(false);
  const activation = (() => { try { return useViewActivation(); } catch { return null; } })();
  const canRead = () => Boolean(ctx.env()?.permissions?.can_read);
  const canLaunch = () => Boolean(applicationResource.ready() && canRead() && ctx.env()?.permissions?.can_write && ctx.env()?.permissions?.can_execute);
  const applicationResource = createEnvCachedResource(ctx, () => `host-applications:${i18n.locale()}`, hostApplicationSnapshot);
  const catalog = () => applicationResource.data() ?? null;
  const isMac = createMemo(() => catalog()?.availability.backend === 'macos');
  const nativeLaunch = () => isMac() && readDesktopSessionContextSnapshot()?.target_kind === 'local_environment' && readDesktopSessionContextSnapshot()?.target_route === 'local_host';
  const ready = () => nativeLaunch() ? catalog()?.availability.native_ready : catalog()?.availability.ready;
  const availabilityDescription = (): EnvAppTranslationKey => {
    const availability = catalog()!.availability;
    if (!availability.supported) return 'hostApplications.unsupportedDescription';
    if (availability.reason === 'catalog_unavailable') return 'hostApplications.catalogUnavailable';
    if (!isMac()) return 'hostApplications.setupDescription';
    if (availability.reason === 'graphical_session_required') return 'hostApplications.macSessionRequired';
    if (availability.reason === 'native_helper_missing') return 'hostApplications.macHelperMissing';
    return 'hostApplications.macPermissions';
  };
  const [permissionBusy, setPermissionBusy] = createSignal(false);
  const requestPermission = async (permission: 'screen_recording' | 'accessibility') => {
    if (!canLaunch() || permissionBusy()) return;
    setPermissionBusy(true);
    try {
      const app = selectedApplication();
      if (app) await reserveApplication(app);
      await requestHostApplicationPermission(permission);
      await refresh();
    }
    catch (e) {setError(translateError(e));}
    finally {setPermissionBusy(false);}
  };
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const displayError = () => error() || (applicationResource.snapshot().error ? translateError(applicationResource.snapshot().error) : '');
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal('');
  const [busy, setBusy] = createSignal<Record<string, boolean>>({});
  const [appErrors, setAppErrors] = createSignal<Record<string, string>>({});
  const [setup, setSetup] = createSignal<HostApplicationSetup | null>(null);
  const [setupBusy, setSetupBusy] = createSignal(false);
  const [setupPlan, setSetupPlan] = createSignal<HostApplicationTransferPlan | null>(null);
  const [planBusy, setPlanBusy] = createSignal(false);
  const [downloadMethod, setDownloadMethod] = createSignal<'host' | 'desktop'>('host');
  const [acquisitionProgress, setAcquisitionProgress] = createSignal<HostApplicationDesktopProgress | null>(null);
  const preparationActive = () => Boolean(acquisitionProgress()) || hostApplicationSetupActive(setup());
  const [setupDisconnected, setSetupDisconnected] = createSignal(false);
  const [setupDialog, setSetupDialog] = createSignal(false);
  const [selectedApplication, setSelectedApplication] = createSignal<HostApplication | null>(null);
  type PendingApplication = { app: HostApplication; popup: Window | null; preparationID?: string; active: boolean };
  const pendingApplications = new Map<string, PendingApplication>();
  let setupObserver: AbortController | undefined;
  let setupTransfer: AbortController | undefined;
  let setupRequestID = '';
  let setupRequestSignature = '';
  let setupCancelled = false;
  let relaying = false;
  let relaySourceReceiving = false;
  let completingSetup = false;
  const [ending, setEnding] = createSignal<HostApplicationSession | null>(null);
  const [stopBusy, setStopBusy] = createSignal(false);
  const [quitting, setQuitting] = createSignal<{ app: HostApplication; instances: string[]; force?: boolean } | null>(null);
  const [quitBusy, setQuitBusy] = createSignal(false);
  const [quitError, setQuitError] = createSignal('');
  const [quitNotices, setQuitNotices] = createSignal<Record<string, string[]>>({});
  const [addOpen, setAddOpen] = createSignal(false);
  const [addBusy, setAddBusy] = createSignal(false);
  const [name, setName] = createSignal('');
  const [executable, setExecutable] = createSignal('');
  const [argumentsText, setArgumentsText] = createSignal('');
  const [addError, setAddError] = createSignal('');
  let request: AbortController | null = null;
  let disposed = false;
  const windows = new Map<string, Window>();

  const translateError = (e: unknown, fallback: EnvAppTranslationKey = 'hostApplications.errors.failed') => {
    if (e instanceof ComponentAcquisitionError) return i18n.t(e.translationKey);
    const keys: Record<string, EnvAppTranslationKey> = {
      HOST_APP_VIEWER_PREPARATION_FAILED: 'hostApplications.viewerPreparationHint',
      HOST_APP_UNAVAILABLE: 'hostApplications.errors.unavailable', HOST_APP_NOT_FOUND: 'hostApplications.errors.notFound',
      HOST_APP_QUIT_REJECTED: isMac() ? 'hostApplications.macQuitRejected' : 'hostApplications.macOperationFailed', HOST_APP_INVALID: 'hostApplications.errors.invalid', HOST_APP_LIMIT: 'hostApplications.errors.limit',
    };
    return i18n.t(e instanceof LocalApiError && keys[e.code] ? keys[e.code] : e instanceof LocalApiError && e.code.startsWith('HOST_APP_') ? hostApplicationLaunchFailureCopy(e.code) : fallback);
  };
  const sessionError = (id: string) => {
    const code = catalog()?.sessions.find(session => session.application.id === id && session.state === 'failed')?.error_code;
    return i18n.t(hostApplicationLaunchFailureCopy(code ?? ''));
  };

  let refreshPending: Promise<void> | null = null;
  const invalidateCatalog = (owner = applicationResource.identity()) => {
    owner.invalidate();
    if (owner === applicationResource.identity()) { request?.abort(); request = null; refreshPending = null; }
  };
  const refresh = (quiet = false): Promise<void> => {
    if (!applicationResource.ready()) { applicationResource.retry(); return Promise.resolve(); }
    if (!canRead()) return Promise.resolve();
    if (refreshPending) return refreshPending;
    const controller = new AbortController(); request = controller;
    const locale = i18n.locale();
    const stale = untrack(applicationResource.snapshot).stale;
    setLoading(true);
    const pending = (async () => {
      try {
        const current = untrack(catalog);
        const next = await applicationResource.refresh(async signal => {
          let value: HostApplicationCatalog;
          if (quiet && current && !stale) {
            const [sessions, running] = await Promise.all([
              listHostApplicationSessions(signal),
              listRunningHostApplications(signal),
            ]);
            value = { ...current, sessions, running };
          } else value = await listHostApplications(locale, signal);
          return value;
        });
        if (disposed || controller.signal.aborted) return;
        setError('');
        if (ready() && pendingApplications.size) void continuePreparedApplications();
        if (!quiet && next.availability.supported && next.availability.backend !== 'macos') {
          void getHostApplicationSetup(controller.signal).then(value => {
            if (!disposed && !controller.signal.aborted) { acceptSetup(value); observeSetup(); }
          }).catch(() => { if (!disposed && !controller.signal.aborted) setSetupDisconnected(true); });
        }
      } catch (e) {
        if (!disposed && !controller.signal.aborted && !(e instanceof DOMException && e.name === 'AbortError')) setError(translateError(e));
      } finally {
        if (request === controller) { request = null; if (!disposed) setLoading(false); }
      }
    })();
    refreshPending = pending;
    void pending.finally(() => { if (refreshPending === pending) refreshPending = null; });
    return pending;
  };

  let revealRevision = 0;
  createEffect(() => {
    const intent = ctx.revealHostApplicationRequest?.();
    if (!intent || !canRead() || !applicationResource.ready() || (activation && !activation.active())) return;
    untrack(() => {
      ctx.consumeRevealHostApplicationRequest?.(intent.requestId);
      const revision = ++revealRevision;
      const current = applicationResource.captureAuthority();
      if (intent.environmentID !== ctx.env_id()) return;
      invalidateCatalog();
      void refresh().then(() => {
        if (disposed || revision !== revealRevision || !current() || (activation && !activation.active())) return;
        const app = catalog()?.applications.find(item => item.id === intent.applicationID);
        if (!app) { setError(i18n.t('hostApplications.errors.notFound')); return; }
        setSelectedApplication(app); setSetupDialog(true);
      });
    });
  });

  createEffect(() => {
    applicationResource.identity();
    const active = activation ? activation.active() : true;
    const locale = i18n.locale();
    void locale;
    if (!canRead() || !active || !applicationResource.ready()) return;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(!(isMac() && pendingApplications.size > 0)); }, isMac() ? 2000 : 8000);
    onCleanup(() => { window.clearInterval(timer); request?.abort(); request = null; refreshPending = null; setLoading(false); });
  });
  const resumeMacPreparation = () => { if (isMac()) void refresh(pendingApplications.size === 0); };
  window.addEventListener('focus', resumeMacPreparation);
  onCleanup(() => window.removeEventListener('focus', resumeMacPreparation));
  const removePreparationClosedListener = window.redevenDesktopShell?.onApplicationPreparationClosed?.(id => {
    for (const pending of pendingApplications.values()) {
      if (pending.preparationID === id) { pending.active = false; pendingApplications.delete(pending.app.id); }
    }
  });
  onCleanup(() => {
    disposed = true; request?.abort(); setupObserver?.abort(); setupTransfer?.abort(); removePreparationClosedListener?.();
    for (const pending of pendingApplications.values()) closePending(pending);
    pendingApplications.clear();
    if (relaying) void window.redevenDesktopShell?.applicationComponents?.({ action: 'cancel' });
  });

  const preparationView = (app: HostApplication): HostApplicationPreparationView => ({
    title: app.name, icon: app.icon, locale: i18n.locale(),
    heading: i18n.t(isMac() ? 'hostApplications.macPermissions' : setupDisconnected() ? 'hostApplications.disconnected' : hostApplicationSetupHeading(setup(), acquisitionProgress())),
    detail: hostApplicationDesktopDetail(acquisitionProgress(), i18n) ?? i18n.t(setupDisconnected() ? 'hostApplications.prepare.connectionHint' : 'hostApplications.prepare.background'),
    progress: hostApplicationSetupProgress(setup(), acquisitionProgress()), failed: setup()?.state === 'failed',
  });
  const closePending = (pending: PendingApplication) => {
    pending.active = false;
    pending.popup?.close();
    if (pending.preparationID) void window.redevenDesktopShell?.applicationPreparation?.({ action: 'close', id: pending.preparationID });
  };
  const pendingIsOpen = async (pending: PendingApplication) => {
    if (!pending.active || disposed) return false;
    const open = pending.preparationID
      ? (await window.redevenDesktopShell?.applicationPreparation?.({ action: 'check', id: pending.preparationID }))?.ok === true
      : Boolean(pending.popup && !pending.popup.closed);
    return open && pending.active && !disposed;
  };
  const updatePending = async () => {
    for (const pending of pendingApplications.values()) {
      if (!await pendingIsOpen(pending)) { pending.active = false; pendingApplications.delete(pending.app.id); continue; }
      const view = preparationView(pending.app);
      if (pending.preparationID) await window.redevenDesktopShell?.applicationPreparation?.({ action: 'update', id: pending.preparationID, view });
      else if (pending.popup) updateHostApplicationPreparationDocument(view, pending.popup.document);
    }
  };
  const continuePreparedApplications = async () => {
    if (disposed || completingSetup) return;
    completingSetup = true;
    try {
      const owner = applicationResource.identity();
      const locale = i18n.locale();
      // Preparation changes launch capability. A session-only refresh retains
      // the previous availability and cannot satisfy this reconciliation.
      invalidateCatalog(owner);
      const current = await applicationResource.refresh(signal => listHostApplications(locale, signal));
      if (disposed || owner !== applicationResource.identity()) return;
      if (!ready()) return;
      setSetupDialog(false);
      for (const pending of [...pendingApplications.values()]) {
        const app = current.applications.find(app => app.id === pending.app.id);
        if (app && await pendingIsOpen(pending)) await open(app, pending);
        else closePending(pending);
        pendingApplications.delete(pending.app.id);
      }
    } catch (e) { if (!disposed) setError(translateError(e)); }
    finally { completingSetup = false; }
  };
  const acceptSetup = (next: HostApplicationSetup) => {
    if (disposed) return;
    const previous = setup();
    if (previous?.package?.digest !== next.package?.digest) setSetupPlan(null);
    setSetup(next); setSetupDisconnected(false);
    void updatePending().catch(() => { if (!disposed) setSetupDisconnected(true); });
    if (next.state === 'ready' && (pendingApplications.size > 0 || (previous && previous.state !== 'ready'))) void continuePreparedApplications();
  };
  const observeSetup = () => {
    if (disposed || setupObserver) return;
    const controller = new AbortController(); setupObserver = controller;
    setSetupDisconnected(false);
    void observeHostApplicationSetup(next => {
      if (!controller.signal.aborted) acceptSetup(next);
    }, controller.signal).catch(() => {
      if (!disposed && !controller.signal.aborted) { setSetupDisconnected(true); void updatePending().catch(() => {}); }
    }).finally(() => { if (setupObserver === controller) setupObserver = undefined; });
  };
  const reserveApplication = async (app: HostApplication): Promise<PendingApplication> => {
    const existing = pendingApplications.get(app.id);
    if (existing && (existing.preparationID ? await pendingIsOpen(existing) : existing.active && !existing.popup?.closed)) return existing;
    const view = preparationView(app);
    const prepare = window.redevenDesktopShell?.applicationPreparation;
    let pending: PendingApplication;
    if (desktopShellWebServiceWindowOpenAvailable()) {
      if (!prepare) throw new Error('Desktop application preparation is unavailable.');
      const result = await prepare({ action: 'create', application_id: app.id, view });
      if (!result.ok || !result.id) throw new Error('Desktop application preparation could not open.');
      pending = { app, popup: null, preparationID: result.id, active: true };
    } else {
      const popup = window.open('about:blank', `redeven-host-app-${ctx.env_id()}-${encodeURIComponent(app.id)}`);
      if (!popup) throw new Error('The application window was blocked.');
      renderHostApplicationLaunchDocument(popup, view);
      pending = { app, popup, active: true };
    }
    if (disposed) { closePending(pending); throw new Error('The application page was closed.'); }
    pendingApplications.set(app.id, pending);
    return pending;
  };
  const inspectPreparation = async () => {
    setPlanBusy(true);
    try {
      const plan = await getHostApplicationTransferPlan();
      if (!disposed) setSetupPlan(plan);
      return plan;
    } finally { if (!disposed) setPlanBusy(false); }
  };
  const viewUpdate = async () => {
    setSelectedApplication(null); setSetupDialog(true); setError('');
    try { await inspectPreparation(); }
    catch (e) { if (!disposed) setError(translateError(e)); }
  };
  const prepare = async (file?: File) => {
    if (!canLaunch() || setupBusy() || relaying) return;
    setSetupBusy(true);
    setupCancelled = false;
    setError('');
    try {
      if (file && (!setup()?.package || file.size < setup()!.package!.size_bytes || file.size > setup()!.package!.size_bytes + 2 * 1048576)) throw new Error('The component package does not match this host.');
      const app = selectedApplication();
      // Reserve browser popups in the original click before awaiting network work.
      if (app) await reserveApplication(app);
      if (!setup()?.installed?.ready) setSetupDialog(false);
      const plan = file ? null : await inspectPreparation();
      if (disposed || setupCancelled) return;
      let next = setup();
      if (!file && plan && plan.missing_bytes > 0 && downloadMethod() === 'desktop') {
        if (!next?.package || !window.redevenDesktopShell?.applicationComponents) throw new Error('Desktop component acquisition is unavailable.');
        await relayPreparation(next, plan);
        observeSetup();
        return;
      }
      if (!file && next?.state === 'receiving') return;
      if (!hostApplicationSetupActive(setup())) {
        const source = file ? 'upload' : plan?.missing_bytes === 0 ? 'cache' : 'download';
        const signature = `${source}:${file?.size ?? 0}:${setup()?.package?.digest ?? ''}`;
        if (!setupRequestID || setupRequestSignature !== signature || (setup() && ['failed', 'cancelled', 'interrupted'].includes(setup()!.state))) {
          setupRequestID = crypto.randomUUID();
        }
        setupRequestSignature = signature;
        next = await startHostApplicationSetup(setupRequestID, source, file?.size ?? 0, plan?.package_digest ?? setup()?.package?.digest);
        if (setupCancelled || (disposed && file)) {
          if (next.can_cancel && next.operation_id) await cancelHostApplicationSetup(next.operation_id);
          return;
        }
        if (disposed) return;
        acceptSetup(next);
      }
      if (next?.state === 'receiving' && next.can_cancel) {
        if (file) {
          if (!next.operation_id || file.size !== next.expected_bytes) throw new Error('The component package does not match this host.');
          setupTransfer = new AbortController();
          observeSetup();
          acceptSetup(await uploadHostApplicationSetup(next.operation_id, file, setupTransfer.signal));
          setupTransfer = undefined;
        }
      }
      observeSetup();
    } catch (e) {
      if (!disposed && !setupTransfer?.signal.aborted) {
        if (e instanceof LocalApiError && e.code === 'HOST_APP_SETUP_BUSY') {
          try { acceptSetup(await getHostApplicationSetup()); observeSetup(); }
          catch { setSetupDisconnected(true); }
        } else setError(translateError(e));
      }
    }
    finally { if (!relaying) setupTransfer = undefined; if (!disposed) setSetupBusy(false); }
  };
  const relayPreparation = async (source: HostApplicationSetup, plan: HostApplicationTransferPlan) => {
    const bridge = window.redevenDesktopShell;
    const acquire = bridge?.applicationComponents;
    if (!canLaunch() || !acquire || !source.package || relaying || disposed) return;
    relaying = true; relaySourceReceiving = source.state === 'receiving';
    const transfer = new AbortController(); setupTransfer = transfer;
    const updateAcquisition = (progress: HostApplicationComponentsProgress) => {
      if (disposed || transfer.signal.aborted) return;
      setAcquisitionProgress(progress);
      void updatePending().catch(() => {});
    };
    const remove = bridge.onApplicationComponentsProgress?.(updateAcquisition);
    updateAcquisition({ phase: 'checking', component_bytes: plan.missing_bytes, downloaded_bytes: 0 });
    try {
      const capability = await acquire({ action: 'capabilities' });
      if (disposed || transfer.signal.aborted) return;
      if (!capability.ok || !capability.supports_transfer_plan || !capability.supports_cache_progress) throw new ComponentAcquisitionError('hostApplications.update.desktopMismatch');
      const bundle = await acquire({ action: 'acquire', architecture: source.package.architecture, plan });
      if (disposed || transfer.signal.aborted) return;
      if (!bundle.ok || !bundle.size) throw new ComponentAcquisitionError(bundle.error === 'target_mismatch' ? 'hostApplications.update.desktopMismatch' : 'hostApplications.prepare.networkError');
      if (source.state === 'receiving' && bundle.size !== source.expected_bytes) throw new Error('The component package does not match this transfer.');
      if (source.state !== 'receiving') {
        const signature = `upload:${bundle.size}:${plan.package_digest}`;
        if (!setupRequestID || setupRequestSignature !== signature || ['failed', 'cancelled', 'interrupted'].includes(source.state)) setupRequestID = crypto.randomUUID();
        setupRequestSignature = signature;
      }
      const next = source.state === 'receiving' ? source : await startHostApplicationSetup(setupRequestID, 'upload', bundle.size, plan.package_digest);
      if (disposed || transfer.signal.aborted) {
        if (next.can_cancel && next.operation_id) await cancelHostApplicationSetup(next.operation_id);
        return;
      }
      setAcquisitionProgress(current => current ? { ...current, phase: 'uploading' } : null);
      acceptSetup(next);
      if (next.state === 'receiving' && next.operation_id) {
        acceptSetup(await uploadHostApplicationSetup(next.operation_id, { size: bundle.size, read: async offset => {
          const chunk = await acquire({ action: 'read', offset });
          if (!chunk.ok || !chunk.data) throw new Error('Desktop component transfer failed.');
          return new Blob([Uint8Array.from(chunk.data)]);
        } }, transfer.signal));
      }
    } catch (e) {
      if (!disposed && !transfer.signal.aborted) {
        setError(translateError(e));
        // Reconcile uncertain admission or upload results with the host operation.
        try { acceptSetup(await getHostApplicationSetup()); }
        catch { setSetupDisconnected(true); }
      }
    } finally {
      remove?.();
      setAcquisitionProgress(null);
      try { await acquire({ action: 'cancel' }); }
      finally { if (setupTransfer === transfer) setupTransfer = undefined; relaying = false; }
    }
  };
  const cancelPreparation = async () => {
    if (!canLaunch() || (!relaying && !setup()?.operation_id)) return;
    const operationID = setup()?.operation_id;
    setupCancelled = true;
    const localAcquisitionOnly = relaying && !relaySourceReceiving && acquisitionProgress() !== null && acquisitionProgress()?.phase !== 'uploading';
    setupTransfer?.abort();
    setAcquisitionProgress(null);
    for (const pending of pendingApplications.values()) closePending(pending);
    pendingApplications.clear();
    setSelectedApplication(null);
    if (relaying) {
      await window.redevenDesktopShell?.applicationComponents?.({ action: 'cancel' });
      setSetup(value => value ? { ...value, state: 'cancelled', can_cancel: false } : value);
      if (localAcquisitionOnly) return;
    }
    if (!operationID) return;
    try {
      acceptSetup(await cancelHostApplicationSetup(operationID));
    } catch (e) { setError(translateError(e)); }
  };

  const preparationPanel = (inDialog = false) => <HostApplicationSetupPanel setup={setup()} desktopProgress={acquisitionProgress()} plan={setupPlan()} checkingPlan={planBusy()} inDialog={inDialog}
    downloadMethod={downloadMethod()} onDownloadMethodChange={setDownloadMethod} allowed={canLaunch()} submitting={setupBusy()}
    canRelay={Boolean(window.redevenDesktopShell?.applicationComponents)}
    disconnected={setupDisconnected()} applicationName={selectedApplication()?.name}
    onStart={() => void prepare()} onCancel={() => void cancelPreparation()} onReconnect={observeSetup} onUpload={file => void prepare(file)} />;

  const running = createMemo(() => (catalog()?.sessions ?? []).filter(s => s.state === 'starting' || s.state === 'running'));
  const runningByApp = createMemo(() => new Map(running().map(s => [s.application.id, s])));
  // Preserve focused controls across OS snapshots; process generations, rather
  // than newly decoded JSON object identities, determine whether a row changed.
  const runningApplications = createMemo<(RunningHostApplication & { app: HostApplication })[]>(previous => (catalog()?.running ?? []).flatMap(instance => {
    const app = catalog()?.applications.find(candidate => candidate.id === instance.application_id);
    if (!app) return [];
    const retained = previous?.find(item => item.app === app && item.instances.join(',') === instance.instances.join(','));
    return [retained ?? { ...instance, app }];
  }).sort((a, b) => a.app.name.localeCompare(b.app.name, i18n.locale()) || a.application_id.localeCompare(b.application_id)));
  const runningApplicationIDs = createMemo(() => new Set(runningApplications().map(item => item.application_id)));
  const quitNotice = (item: RunningHostApplication) => quitNotices()[item.application_id]?.some(id => item.instances.includes(id));
  const requestQuit = async () => {
    const target = quitting();
    if (!target || quitBusy() || !canLaunch()) return;
    setQuitBusy(true); setQuitError('');
    try {
      const operationResource = applicationResource.identity();
    const operationCurrent = applicationResource.captureAuthority();
      const runningNow = await listRunningHostApplications();
      if (disposed || !operationCurrent()) return;
      const instances = runningNow.find(item => item.application_id === target.app.id)?.instances ?? [];
      if (instances.length === 0) { setQuitting(null); invalidateCatalog(); await refresh(true); return; }
      if ([...instances].sort().join(',') !== [...target.instances].sort().join(',')) {
        setQuitting({ ...target, instances });
        setQuitError(i18n.t('hostApplications.applicationChanged'));
        return;
      }
      await (target.force ? terminateHostApplication : quitHostApplication)(target.app.id, instances);
      invalidateCatalog(operationResource);
      if (disposed) return;
      if (!target.force) setQuitNotices(previous => ({ ...previous, [target.app.id]: target.instances }));
      setQuitting(null);
      await refresh(true);
    } catch (e) { if (!disposed) setQuitError(translateError(e, isMac() ? 'hostApplications.macQuitFailed' : 'hostApplications.macOperationFailed')); }
    finally { if (!disposed) setQuitBusy(false); }
  };
  const starting = (appID: string) => Boolean(busy()[appID] || runningByApp().get(appID)?.state === 'starting');
  const categories = createMemo(() => [...new Set((catalog()?.applications ?? []).flatMap(app => app.categories))].sort((a, b) => a.localeCompare(b, i18n.locale())));
  createEffect(() => { if (category() && !categories().includes(category())) setCategory(''); });
  const apps = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    const filtered = [...new Map((catalog()?.applications ?? []).map(app => [app.id, app])).values()].filter(app =>
      (!category() || app.categories.includes(category()))
      && (!compactLayout() || !runningOnly() || starting(app.id) || runningByApp().has(app.id) || runningApplicationIDs().has(app.id))
      && (!needle || `${app.name} ${app.description}`.toLocaleLowerCase().includes(needle)));
    return compactLayout() ? filtered.sort((a, b) => Number(starting(b.id) || runningByApp().has(b.id) || runningApplicationIDs().has(b.id)) - Number(starting(a.id) || runningByApp().has(a.id) || runningApplicationIDs().has(a.id)) || a.name.localeCompare(b.name, i18n.locale()) || a.id.localeCompare(b.id)) : filtered;
  });

  const applicationsByID = createMemo(() => new Map((catalog()?.applications ?? []).map(app => [app.id, app])));
  const processesByID = createMemo(() => new Map(runningApplications().map(item => [item.app.id, item])));

  const showLaunchFailure = (app: HostApplication, popup: Window, message: string) => {
    if (!popup.closed) {
      try {
        renderHostApplicationLaunchDocument(popup, {
          title: app.name, icon: app.icon, locale: i18n.locale(), heading: message,
          detail: '', failed: true,
        }, {
          retry: i18n.t('hostApplications.retry'), dismiss: i18n.t('hostApplications.dismiss'),
          onRetry: () => { if (!disposed) void open(app, { app, popup, active: true }); },
        });
      } catch { /* Navigation may already have transferred the tab to its viewer origin. */ }
    }
  };

  const open = async (app: HostApplication, prepared?: PendingApplication) => {
    if (!canLaunch() || busy()[app.id]) return;
    const operationResource = applicationResource.identity();
    const operationCurrent = applicationResource.captureAuthority();
    if (applicationResource.snapshot().stale || applicationResource.snapshot().refreshing) {
      if (!prepared && !desktopShellWebServiceWindowOpenAvailable() && !nativeLaunch()) {
        prepared = { app, popup: window.open('about:blank', `redeven-host-app-${ctx.env_id()}-${encodeURIComponent(app.id)}`), active: true };
      }
      setBusy(value => ({ ...value, [app.id]: true }));
      await refresh();
      setBusy(value => ({ ...value, [app.id]: false }));
      const current = catalog()?.applications.find(item => item.id === app.id);
      if (disposed || !operationCurrent() || applicationResource.snapshot().stale || !current) {
        const message = i18n.t(current ? 'hostApplications.errors.failed' : 'hostApplications.errors.notFound');
        if (prepared?.popup && !disposed && operationCurrent()) showLaunchFailure(app, prepared.popup, message);
        else if (prepared) closePending(prepared);
        if (!disposed) setAppErrors(value => ({ ...value, [app.id]: message }));
        return;
      }
      app = current;
    }
    if (!ready() && !runningApplicationIDs().has(app.id) && !runningByApp().has(app.id)) {
      if (prepared) closePending(prepared);
      setSelectedApplication(app);
      if (preparationActive()) {
        try { await reserveApplication(app); observeSetup(); if (setup()?.state === 'ready') void continuePreparedApplications(); }
        catch (e) { if (!disposed) setAppErrors(v => ({ ...v, [app.id]: translateError(e) })); }
      } else setSetupDialog(true);
      return;
    }
    if (prepared && !await pendingIsOpen(prepared)) return;
    const existing = windows.get(app.id);
    if (existing && !existing.closed && runningByApp().has(app.id)) { existing.focus(); return; }
    const desktop = desktopShellWebServiceWindowOpenAvailable();
    const localNative = nativeLaunch();
    const popup = prepared?.popup ?? (desktop || localNative ? null : window.open('about:blank', `redeven-host-app-${ctx.env_id()}-${encodeURIComponent(app.id)}`));
    if (!desktop && !localNative && !popup) { setAppErrors(v => ({ ...v, [app.id]: i18n.t('webServices.errors.popupBlocked') })); return; }
    if (popup) {
      renderHostApplicationLaunchDocument(popup, {
        title: app.name, icon: app.icon, locale: i18n.locale(),
        heading: i18n.t('hostApplications.starting'), detail: '',
      });
    }
    setBusy(v => ({ ...v, [app.id]: true })); setAppErrors(v => ({ ...v, [app.id]: '' }));
    try {
      const result = await launchHostApplication(app.id, i18n.locale(), hostApplicationPresentation(
        i18n, app.name, isMac(), document.documentElement.dataset.floeShellTheme ?? '',
      ), localNative ? 'native' : 'stream');
      invalidateCatalog(operationResource);
      if (disposed || (prepared && !await pendingIsOpen(prepared)) || popup?.closed) {
        // Launch admission belongs to the host. A stale catalog cannot prove
        // this page owns the session returned by server-side deduplication.
        if (!disposed) await refresh(true);
        return;
      }
      if (result.mode === 'native') {if (prepared) closePending(prepared); await refresh(true);return;}
      if (!result.forward) throw new Error('Missing application forward');
      const { forward, app_path: appPath } = result.forward;
      const route = resolveWebServiceOpenRoute({ forwardID: forward.forward_id, localRuntime: ctx.localRuntime(), desktopContext: readDesktopSessionContextSnapshot(), appPath, desktopWindowAvailable: desktop });
      await openWebServiceRoute(route, forward.forward_id, forward.target_url, 'unified_proxy', appPath, desktop, () => {}, {
        missingEnvContext: i18n.t('webServices.errors.missingEnvContext'), opening: i18n.t('hostApplications.starting'),
        openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'), requestingEntryTicket: i18n.t('webServices.status.requestingEntryTicket'),
        updating: i18n.t('webServices.status.updating'), desktopWindowFailed: i18n.t('webServices.errors.desktopWindowFailed'), popupBlocked: i18n.t('webServices.errors.popupBlocked'),
      }, popup, 'application', ...(prepared?.preparationID ? [prepared.preparationID] : []));
      if (popup) windows.set(app.id, popup);
      await refresh(true);
    } catch (e) {
      const message = translateError(e);
      if (popup) showLaunchFailure(app, popup, message);
      else if (prepared?.preparationID) closePending(prepared);
      if (!disposed) void refresh(true);
      if (!disposed) setAppErrors(v => ({ ...v, [app.id]: message }));
    } finally { if (!disposed) setBusy(v => ({ ...v, [app.id]: false })); }
  };

  const stop = async () => {
    const target = ending(); if (!target || stopBusy()) return;
    const operationResource = applicationResource.identity();
    const operationCurrent = applicationResource.captureAuthority();
    setStopBusy(true);
    try {
      if (applicationResource.snapshot().stale || applicationResource.snapshot().refreshing) {
        await refresh(true);
        if (disposed || !operationCurrent() || applicationResource.snapshot().stale) return;
        if (!catalog()?.sessions.some(session => session.id === target.id && ['starting', 'running'].includes(session.state))) { setEnding(null); return; }
      }
      await detachHostApplication(target.id);
      invalidateCatalog(operationResource); setEnding(null); await refresh(true);
    }
    catch (e) { setError(translateError(e)); }
    finally { setStopBusy(false); }
  };

  const add = async () => {
    if ((!isMac() && !name().trim()) || !executable().trim() || addBusy()) return;
    setAddBusy(true); setAddError('');
    try {
      await addHostApplication({ name: name().trim(), executable: executable().trim(), arguments: argumentsText() });
      setAddOpen(false); setName(''); setExecutable(''); setArgumentsText(''); invalidateCatalog(); await refresh();
    } catch (e) { setAddError(translateError(e)); }
    finally { setAddBusy(false); }
  };

  const feedback = (): FeedbackIndicatorEntry[] => [
    ...(catalog() && displayError() ? [{ id: 'inventory', severity: 'error' as const, summary: displayError(), actions: <Button size="sm" variant="outline" disabled={loading()} onClick={() => void refresh()}>{i18n.t('common.actions.retry')}</Button> }] : []),
    ...(ready() && !isMac() && setup()?.installed?.ready && (setup()?.update_available || preparationActive() || setup()?.state === 'failed') ? [{ id: 'component-update', severity: setup()?.state === 'failed' ? 'error' as const : 'info' as const, summary: i18n.t(preparationActive() ? hostApplicationSetupHeading(setup(), acquisitionProgress()) : 'hostApplications.update.available'), detail: i18n.t(setup()?.state === 'failed' ? 'hostApplications.update.failedRetained' : 'hostApplications.update.description'), actions: <Button size="sm" variant="outline" onClick={() => void viewUpdate()}>{i18n.t('hostApplications.update.view')}</Button> }] : []),
  ];
  return <div ref={pageRoot} class="host-apps h-full min-h-0 flex flex-col" data-testid="host-applications" data-env-reload-state={catalog() ? 'content' : displayError() ? 'error' : 'pending'}>
    <HostApplicationsHeader feedback={feedback()} actions={<>

        <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-busy={loading()} disabled={loading() || !canRead()} title={i18n.t('hostApplications.refresh')} aria-label={i18n.t('hostApplications.refresh')}><Refresh class={`w-4 h-4 ${loading() ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>
        <Button aria-label={i18n.t('hostApplications.add')} title={i18n.t('hostApplications.add')} variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={!canLaunch() || !catalog()?.availability.supported}><Plus class="w-3.5 h-3.5" /><span>{i18n.t('hostApplications.add')}</span></Button>
          </>} />
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="host-apps-content min-h-0 flex-1 overflow-auto" data-floe-reload-scroll="host-applications">
      <Show when={!catalog() && displayError()}><div class="host-apps-notice text-destructive" role="alert">{displayError()}<Button size="sm" variant="outline" onClick={() => void refresh()}>{i18n.t('common.actions.retry')}</Button></div></Show>
      <Show when={ctx.env()?.permissions?.can_read === false}><div class="host-apps-empty"><ActivityBarHostApplicationsIcon class="w-9 h-9" /><h2>{i18n.t('hostApplications.permissionTitle')}</h2><p>{i18n.t('hostApplications.readPermission')}</p></div></Show>
      <Show when={ctx.env()?.permissions?.can_read !== false}>
        <Show when={catalog()} fallback={<Show when={!displayError()}><HostApplicationsListSkeleton /></Show>}>

          <Show when={!ready() && catalog()!.availability.supported && !isMac()}>{preparationPanel()}</Show>
          <Show when={!ready() && (isMac() || !catalog()!.availability.supported)}>
            <div class="host-apps-notice"><ActivityBarHostApplicationsIcon class="w-5 h-5 shrink-0" /><div><strong>{i18n.t(catalog()!.availability.supported ? 'hostApplications.setupTitle' : 'hostApplications.unsupportedTitle')}</strong><p>{i18n.t(availabilityDescription())}</p>
              <Show when={isMac() && catalog()!.availability.reason === 'macos_permissions'}><div class="flex flex-wrap gap-2 mt-3">
                <Show when={!catalog()!.availability.permissions?.screen_recording}><Button variant="outline" size="sm" disabled={!canLaunch() || permissionBusy()} onClick={() => void requestPermission('screen_recording')}>{i18n.t('hostApplications.macAllowScreen')}</Button></Show>
                <Show when={!catalog()!.availability.permissions?.accessibility}><Button variant="outline" size="sm" disabled={!canLaunch() || permissionBusy()} onClick={() => void requestPermission('accessibility')}>{i18n.t('hostApplications.macAllowAccessibility')}</Button></Show>
              </div></Show>
            </div></div>
          </Show>
          <Show when={applicationResource.ready() && canRead() && !canLaunch()}><div class="host-apps-notice">{i18n.t('hostApplications.launchPermission')}</div></Show>
          <Show when={runningApplications().length}>
            <section class="host-apps-running" aria-label={i18n.t('hostApplications.running')}>
              <div class="host-apps-section-title"><h2>{i18n.t('hostApplications.running')}</h2><span>{runningApplications().length}</span></div>
              <p class="host-apps-hint">{i18n.t(isMac() ? 'hostApplications.macRunningHint' : 'hostApplications.linuxRunningHint')}</p>
              <div class="host-apps-session-grid host-apps-process-grid"><For each={runningApplications().map(item => item.app.id)}>{appID => { const item = () => processesByID().get(appID)!; return  <div class={`host-app-session host-app-process ${redevenSurfaceRoleClass('panelInteractive')}`}>
                <div class="host-app-process-row">
                  <button class="host-app-session-open" aria-label={`${i18n.t('hostApplications.resume')} · ${item().app.name}`} onClick={() => void open(item().app)} disabled={!canLaunch() || busy()[item().app.id]}>
                    <ApplicationIcon app={item().app} /><span class="min-w-0"><strong class="block truncate">{item().app.name}</strong><span class="host-app-status"><span class="host-app-status-dot" />{i18n.t(runningByApp().has(item().app.id) ? 'hostApplications.macSharing' : 'hostApplications.macAppRunning')}</span></span>
                  </button>
                  <Show when={runningByApp().get(item().app.id)}>{session => <button class="host-app-stop" onClick={() => setEnding(session())} disabled={!canLaunch()} title={i18n.t('hostApplications.stopSharing')} aria-label={`${i18n.t('hostApplications.stopSharing')} · ${item().app.name}`}><Stop class="w-3.5 h-3.5" /></button>}</Show>
                  <button class="host-app-quit" aria-label={`${i18n.t(isMac() ? 'hostApplications.macQuit' : 'hostApplications.closeAllWindows')} · ${item().app.name}`} disabled={!canLaunch() || !(isMac() ? catalog()?.availability.native_ready : ready())} onClick={() => { setQuitError(''); setQuitting({ app: item().app, instances: [...item().instances] }); }}>{i18n.t(isMac() ? 'hostApplications.macQuit' : 'hostApplications.closeAllWindows')}</button>
                </div>
                <Show when={quitNotice(item())}><p class="host-app-quit-notice" role="status">{i18n.t(isMac() ? 'hostApplications.macQuitPending' : 'hostApplications.closeWindowsPending')}</p></Show>
              </div>; }}</For></div>
            </section>
          </Show>
          <Show when={catalog()!.availability.supported && (ready() || catalog()!.applications.length > 0)}><section class="host-apps-library" aria-label={i18n.t('hostApplications.library')}>
            <div class="host-apps-library-heading">
              <div class="host-apps-section-title"><h2>{i18n.t('hostApplications.library')}</h2><span>{catalog()!.applications.length}</span></div>
              <div class="host-apps-filters">
                <Show when={categories().length}>
                  <select class="host-apps-category" value={category()} onChange={e => setCategory(e.currentTarget.value)} aria-label={i18n.t('hostApplications.category')}>
                    <option value="">{i18n.t('hostApplications.allApplications')}</option>
                    <For each={categories()}>{value => <option value={value}>{value}</option>}</For>
                  </select>
                </Show>
                <div class="host-apps-search"><Search class="w-3.5 h-3.5" /><Input value={query()} onInput={e => setQuery(e.currentTarget.value)} placeholder={i18n.t('hostApplications.search')} aria-label={i18n.t('hostApplications.search')} /></div>
                <div class="host-apps-mobile-filters"><Dropdown align="end" triggerAriaLabel={i18n.t('hostApplications.filterApplications')}
                  triggerClass="host-apps-filter-button" trigger={<><Filter class="h-4 w-4" /><Show when={category() || runningOnly()}><span class="host-apps-filter-count">{Number(Boolean(category())) + Number(runningOnly())}</span></Show></>}
                  items={[
                    { id: 'running', label: i18n.t('hostApplications.running'), keepOpen: true, icon: () => runningOnly() ? <Check class="h-4 w-4" /> : <span class="h-4 w-4" /> },
                    { id: 'category', label: i18n.t('hostApplications.category'), children: [{ id: 'category:', label: i18n.t('hostApplications.allApplications') }, ...categories().map(value => ({ id: `category:${value}`, label: value, icon: () => category() === value ? <Check class="h-4 w-4" /> : <span class="h-4 w-4" /> }))] },
                    { id: 'clear', label: i18n.t('hostApplications.clearFilters'), disabled: !category() && !runningOnly() },
                  ]}
                  onSelect={id => { if (id === 'running') setRunningOnly(value => !value); else if (id === 'clear') { setCategory(''); setRunningOnly(false); } else if (id.startsWith('category:')) setCategory(id.slice(9)); }} /></div>
              </div>
            </div>
            <Show when={apps().length} fallback={<Show when={ready()}><div class="host-apps-empty"><Search class="w-8 h-8" /><h2>{i18n.t(query() ? 'hostApplications.noResults' : 'hostApplications.emptyTitle')}</h2><p>{i18n.t(query() ? 'hostApplications.noResultsDescription' : 'hostApplications.emptyDescription')}</p></div></Show>}>
              <div class="host-apps-grid"><For each={apps().map(app => app.id)}>{appID => { const app = () => applicationsByID().get(appID)!; return  <div class="host-app-tile-wrap">
                <button class={`host-app-tile ${redevenSurfaceRoleClass('panelInteractive')}`} aria-busy={starting(app().id)} disabled={busy()[app().id] || (applicationResource.ready() && !canLaunch())} aria-disabled={!canLaunch()} onClick={() => void open(app())} aria-label={`${i18n.t((runningByApp().has(app().id) || runningApplicationIDs().has(app().id)) ? 'hostApplications.resume' : 'hostApplications.open')} · ${app().name}`}>
                  <ApplicationIcon app={app()} />
                  <div class="host-app-tile-copy">
                    <strong title={app().name}>{app().name}</strong>
                    <Show when={app().description}><p title={app().description}>{app().description}</p></Show>
                  </div>
                  <span class="host-app-tile-affordance" aria-hidden="true">
                    <Show when={starting(app().id)} fallback={<>
                      <Show when={runningByApp().get(app().id)?.state === 'running' || runningApplicationIDs().has(app().id)}><span class="host-app-status-dot" /></Show>
                      <ExternalLink class="host-app-open-icon w-3.5 h-3.5" />
                    </>}><span class="host-app-launch-indicator" /></Show>
                  </span>
                  <Show when={starting(app().id)}><span class="sr-only" role="status">{i18n.t('hostApplications.starting')}</span></Show>
                </button>
                <div class="host-app-mobile-actions">
                  <Show when={runningByApp().has(appID) || processesByID().has(appID)}>
                    <span class="host-app-status">{i18n.t(starting(appID) ? 'hostApplications.starting' : runningByApp().has(appID) ? 'hostApplications.macSharing' : 'hostApplications.macAppRunning')}</span>
                    <Dropdown align="end" triggerAriaLabel={`${i18n.t('hostApplications.macControls')} · ${app().name}`} triggerClass="host-apps-filter-button" trigger={<MoreHorizontal class="h-4 w-4" />}
                      items={[
                        ...(runningByApp().has(appID) ? [{ id: 'stop', label: i18n.t('hostApplications.stopSharing'), disabled: !canLaunch() }] : []),
                        ...(processesByID().has(appID) ? [{ id: 'quit', label: i18n.t(isMac() ? 'hostApplications.macQuit' : 'hostApplications.closeAllWindows'), disabled: !canLaunch() || (isMac() && !catalog()?.availability.native_ready) }] : []),
                      ]} onSelect={id => {
                        if (id === 'stop') setEnding(runningByApp().get(appID)!);
                        if (id === 'quit') { setQuitError(''); setQuitting({ app: app(), instances: [...processesByID().get(appID)!.instances] }); }
                      }} />
                  </Show>
                  <Show when={processesByID().get(appID) && quitNotice(processesByID().get(appID)!)}><p class="host-app-quit-notice" role="status">{i18n.t(isMac() ? 'hostApplications.macQuitPending' : 'hostApplications.closeWindowsPending')}</p></Show>
                </div>
                <Show when={appErrors()[app().id] || catalog()?.sessions.find(s => s.application.id === app().id)?.state === 'failed'}><p class="host-app-error" role="alert">{appErrors()[app().id] || sessionError(app().id)}</p></Show>
              </div>; }}</For></div>
            </Show>
          </section></Show>
        </Show>
      </Show>
    </div>
    <Dialog open={setupDialog()} onOpenChange={setSetupDialog} class="host-apps-dialog" contentClass="host-apps-dialog-content" closeLabel={i18n.t('common.actions.close')} title={<Show when={selectedApplication()} keyed fallback={i18n.t(setup()?.installed ? 'hostApplications.update.title' : 'hostApplications.prepare.title')}>{app => <span class="host-apps-dialog-identity"><ApplicationIcon app={app} /><span>{app.name}</span></span>}</Show>}>
      <Show when={error()}><p role="alert" class="host-app-error">{error()}</p></Show>
      <Show when={ready() && selectedApplication()} fallback={<Show when={!isMac()} fallback={<div class="space-y-4"><p class="text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t(availabilityDescription())}</p>
        <Show when={catalog()?.availability.reason === 'macos_permissions'}>
          <Show when={!catalog()?.availability.permissions?.screen_recording}><Button disabled={permissionBusy()} onClick={() => void requestPermission('screen_recording')}>{i18n.t('hostApplications.macAllowScreen')}</Button></Show>
          <Show when={!catalog()?.availability.permissions?.accessibility}><Button disabled={permissionBusy()} onClick={() => void requestPermission('accessibility')}>{i18n.t('hostApplications.macAllowAccessibility')}</Button></Show>
        </Show>
      </div>}>{preparationPanel(true)}</Show>}>
        <div class="space-y-4">
          <p class="text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t('hostApplications.openDescription')}</p>
          <div class="flex justify-end"><Button disabled={!canLaunch() || Boolean(busy()[selectedApplication()!.id])} onClick={() => {
            const app = selectedApplication(); if (!app) return;
            setSetupDialog(false); void open(app);
          }}>{i18n.t('hostApplications.open')}</Button></div>
        </div>
      </Show>
    </Dialog>
    <Dialog open={Boolean(quitting())} onOpenChange={value => { if (!value && !quitBusy()) setQuitting(null); }} class="host-apps-dialog" contentClass="host-apps-dialog-content" closeLabel={i18n.t('common.actions.close')}
      title={i18n.t(quitting()?.force ? 'hostApplications.forceQuitTitle' : isMac() ? 'hostApplications.macQuitTitle' : 'hostApplications.closeAllWindowsTitle', { name: quitting()?.app.name ?? '' })}
      footer={<><Show when={!quitting()?.force}><Button variant="ghost" disabled={quitBusy()} onClick={() => { setQuitError(''); setQuitting(value => value ? { ...value, force: true } : null); }}>{i18n.t('hostApplications.forceQuit')}</Button></Show><Button variant="ghost" disabled={quitBusy()} onClick={() => setQuitting(null)}>{i18n.t('hostApplications.cancel')}</Button><Button variant="destructive" loading={quitBusy()} disabled={quitBusy()} onClick={() => void requestQuit()}>{i18n.t(quitting()?.force ? 'hostApplications.forceQuit' : isMac() ? 'hostApplications.macQuit' : 'hostApplications.closeAllWindows')}</Button></>}>
      <p class="host-app-quit-description">{i18n.t(quitting()?.force ? 'hostApplications.forceQuitDescription' : isMac() ? 'hostApplications.macQuitDescription' : 'hostApplications.sessionQuitDescription')}</p>
      <Show when={quitError()}><p role="alert" class="host-app-error">{quitError()}</p></Show>
    </Dialog>
    <ConfirmDialog open={Boolean(ending())} onOpenChange={value => { if (!value && !stopBusy()) setEnding(null); }} title={i18n.t('hostApplications.stopSharing')} bodyDescription={i18n.t('hostApplications.stopSharingDescription')} confirmText={i18n.t('hostApplications.stopSharing')} cancelText={i18n.t('hostApplications.cancel')} variant="default" loading={stopBusy()} onConfirm={() => void stop()} />
    <Dialog class="host-apps-dialog" contentClass="host-apps-dialog-content" closeLabel={i18n.t('common.actions.close')} open={addOpen()} onOpenChange={value => { if (!addBusy()) setAddOpen(value); }} title={i18n.t('hostApplications.addTitle')} footer={<><Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addBusy()}>{i18n.t('hostApplications.cancel')}</Button><Button onClick={() => void add()} disabled={addBusy() || (!isMac() && !name().trim()) || !executable().trim()}>{i18n.t('hostApplications.add')}</Button></>}>
      <div class="space-y-4"><p class="text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t(isMac() ? 'hostApplications.macAddDescription' : 'hostApplications.addDescription')}</p>
        <Show when={!isMac()}><label class="block space-y-1.5"><span class="text-xs font-medium">{i18n.t('hostApplications.name')}</span><Input value={name()} onInput={e => setName(e.currentTarget.value)} maxLength={120} /></label></Show>
        <label class="block space-y-1.5"><span class="text-xs font-medium">{i18n.t(isMac() ? 'hostApplications.macBundlePath' : 'hostApplications.executable')}</span><Input value={executable()} onInput={e => setExecutable(e.currentTarget.value)} placeholder={isMac() ? "/Applications/Example.app" : "/usr/bin/example"} /></label>
        <Show when={!isMac()}><label class="block space-y-1.5"><span class="text-xs font-medium">{i18n.t('hostApplications.arguments')}</span><Input value={argumentsText()} onInput={e => setArgumentsText(e.currentTarget.value)} /></label></Show>
        <Show when={addError()}><p role="alert" class="text-[length:var(--floe-type-body)] text-destructive">{addError()}</p></Show>
      </div>
    </Dialog>
  </div>;
}
