import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { useViewActivation } from '@floegence/floe-webapp-core';
import { ExternalLink, Plus, Refresh, Search, Stop } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { ActivityBarHostApplicationsIcon } from '../icons/ActivityBarDockIcons';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { useEnvContext } from './EnvContext';
import { addHostApplication, launchHostApplication, listHostApplicationSessions, listHostApplications, stopHostApplication, type HostApplication, type HostApplicationCatalog, type HostApplicationSession } from '../services/hostApplicationsApi';
import { desktopShellWebServiceWindowOpenAvailable } from '../services/desktopShellBridge';
import { readDesktopSessionContextSnapshot } from '../services/desktopSessionContext';
import { LocalApiError } from '../services/localApi';
import { openWebServiceRoute, resolveWebServiceOpenRoute } from '../services/webServiceWindows';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import './host-applications.css';

function ApplicationIcon(props: { app: HostApplication }) {
  return <span class="host-app-icon" aria-hidden="true">
    <Show when={props.app.icon.startsWith('data:image/png;base64,')} fallback={<ActivityBarHostApplicationsIcon class="w-6 h-6" />}>
      <img src={props.app.icon} alt="" loading="lazy" draggable={false} />
    </Show>
  </span>;
}

export function EnvHostApplicationsPage() {
  const ctx = useEnvContext();
  const i18n = useI18n();
  const activation = (() => { try { return useViewActivation(); } catch { return null; } })();
  const canRead = () => Boolean(ctx.env()?.permissions?.can_read);
  const canLaunch = () => Boolean(canRead() && ctx.env()?.permissions?.can_write && ctx.env()?.permissions?.can_execute);
  const [catalog, setCatalog] = createSignal<HostApplicationCatalog | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal('');
  const [busy, setBusy] = createSignal<Record<string, boolean>>({});
  const [appErrors, setAppErrors] = createSignal<Record<string, string>>({});
  const [ending, setEnding] = createSignal<HostApplicationSession | null>(null);
  const [stopBusy, setStopBusy] = createSignal(false);
  const [addOpen, setAddOpen] = createSignal(false);
  const [addBusy, setAddBusy] = createSignal(false);
  const [name, setName] = createSignal('');
  const [executable, setExecutable] = createSignal('');
  const [argumentsText, setArgumentsText] = createSignal('');
  const [addError, setAddError] = createSignal('');
  let request: AbortController | null = null;
  let disposed = false;
  const windows = new Map<string, Window>();

  const translateError = (e: unknown) => {
    const keys: Record<string, EnvAppTranslationKey> = {
      HOST_APP_UNAVAILABLE: 'hostApplications.errors.unavailable', HOST_APP_NOT_FOUND: 'hostApplications.errors.notFound',
      HOST_APP_INVALID: 'hostApplications.errors.invalid', HOST_APP_LIMIT: 'hostApplications.errors.limit',
    };
    return i18n.t(e instanceof LocalApiError && keys[e.code] ? keys[e.code] : 'hostApplications.errors.failed');
  };

  const refresh = async (quiet = false) => {
    if (!canRead() || request) return;
    const controller = new AbortController(); request = controller;
    if (!quiet) setLoading(true);
    try {
      const current = untrack(catalog);
      const next = quiet && current ? { ...current, sessions: await listHostApplicationSessions(controller.signal) } : await listHostApplications(i18n.locale(), controller.signal);
      if (!disposed && !controller.signal.aborted) { setCatalog(next); setError(''); }
    } catch (e) {
      if (!disposed && !controller.signal.aborted) setError(translateError(e));
    } finally {
      if (request === controller) request = null;
      if (!disposed) setLoading(false);
    }
  };

  createEffect(() => {
    const active = activation ? activation.active() : true;
    const locale = i18n.locale();
    void locale;
    if (!canRead() || !active) return;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(true); }, 8000);
    onCleanup(() => { window.clearInterval(timer); request?.abort(); request = null; });
  });
  onCleanup(() => { disposed = true; request?.abort(); });

  const running = createMemo(() => (catalog()?.sessions ?? []).filter(s => s.state === 'starting' || s.state === 'running'));
  const runningByApp = createMemo(() => new Map(running().map(s => [s.application.id, s])));
  const starting = (appID: string) => Boolean(busy()[appID] || runningByApp().get(appID)?.state === 'starting');
  const categories = createMemo(() => [...new Set((catalog()?.applications ?? []).flatMap(app => app.categories))].sort((a, b) => a.localeCompare(b, i18n.locale())));
  createEffect(() => { if (category() && !categories().includes(category())) setCategory(''); });
  const apps = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return (catalog()?.applications ?? []).filter(app =>
      (!category() || app.categories.includes(category()))
      && (!needle || `${app.name} ${app.description}`.toLocaleLowerCase().includes(needle)));
  });

  const open = async (app: HostApplication) => {
    if (!canLaunch() || busy()[app.id]) return;
    const existing = windows.get(app.id);
    if (existing && !existing.closed && runningByApp().has(app.id)) { existing.focus(); return; }
    const desktop = desktopShellWebServiceWindowOpenAvailable();
    const popup = desktop ? null : window.open('about:blank', `redeven-host-app-${ctx.env_id()}-${encodeURIComponent(app.id)}`);
    if (!desktop && !popup) { setAppErrors(v => ({ ...v, [app.id]: i18n.t('webServices.errors.popupBlocked') })); return; }
    if (popup) {
      popup.document.title = app.name;
      popup.document.body.textContent = i18n.t('hostApplications.starting');
      popup.document.body.style.cssText = 'font:14px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;color-scheme:light dark';
    }
    setBusy(v => ({ ...v, [app.id]: true })); setAppErrors(v => ({ ...v, [app.id]: '' }));
    try {
      const result = await launchHostApplication(app.id, i18n.locale(), {
        locale: i18n.locale(),
        connecting: i18n.t('hostApplications.connecting'), reconnecting: i18n.t('hostApplications.reconnecting'),
        disconnected: i18n.t('hostApplications.disconnected'), connectionHint: i18n.t('hostApplications.connectionHint'), reconnect: i18n.t('hostApplications.reconnect'),
        starting: i18n.t('hostApplications.starting'), failed: i18n.t('hostApplications.errors.failed'),
        ended: i18n.t('hostApplications.ended'), retry: i18n.t('hostApplications.retry'),
      });
      if (!result.forward) throw new Error('Missing application forward');
      const { forward, app_path: appPath } = result.forward;
      const route = resolveWebServiceOpenRoute({ forwardID: forward.forward_id, localRuntime: ctx.localRuntime(), desktopContext: readDesktopSessionContextSnapshot(), appPath, desktopWindowAvailable: desktop });
      await openWebServiceRoute(route, forward.forward_id, forward.target_url, 'unified_proxy', appPath, desktop, () => {}, {
        missingEnvContext: i18n.t('webServices.errors.missingEnvContext'), opening: i18n.t('hostApplications.starting'),
        openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'), requestingEntryTicket: i18n.t('webServices.status.requestingEntryTicket'),
        updating: i18n.t('webServices.status.updating'), desktopWindowFailed: i18n.t('webServices.errors.desktopWindowFailed'), popupBlocked: i18n.t('webServices.errors.popupBlocked'),
      }, popup, 'application');
      if (popup) windows.set(app.id, popup);
      await refresh(true);
    } catch (e) {
      popup?.close(); setAppErrors(v => ({ ...v, [app.id]: translateError(e) }));
    } finally { setBusy(v => ({ ...v, [app.id]: false })); }
  };

  const stop = async () => {
    const target = ending(); if (!target || stopBusy()) return;
    setStopBusy(true);
    try { await stopHostApplication(target.id); setEnding(null); await refresh(true); }
    catch (e) { setError(translateError(e)); }
    finally { setStopBusy(false); }
  };

  const add = async () => {
    if (!name().trim() || !executable().trim() || addBusy()) return;
    setAddBusy(true); setAddError('');
    try {
      await addHostApplication({ name: name().trim(), executable: executable().trim(), arguments: argumentsText() });
      setAddOpen(false); setName(''); setExecutable(''); setArgumentsText(''); await refresh();
    } catch (e) { setAddError(translateError(e)); }
    finally { setAddBusy(false); }
  };

  return <div class="host-apps h-full min-h-0 flex flex-col" data-testid="host-applications">
    <header class="host-apps-header">
      <div class="min-w-0"><div class="host-apps-eyebrow">{i18n.t('hostApplications.eyebrow')}</div><h1>{i18n.t('hostApplications.title')}</h1><p>{i18n.t('hostApplications.description')}</p></div>
      <div class="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading() || !canRead()} title={i18n.t('hostApplications.refresh')} aria-label={i18n.t('hostApplications.refresh')}><Refresh class="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={!canLaunch() || !catalog()?.availability.supported}><Plus class="w-3.5 h-3.5" />{i18n.t('hostApplications.add')}</Button>
      </div>
    </header>
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="host-apps-content min-h-0 flex-1 overflow-auto">
      <Show when={error()}><div class="host-apps-notice text-destructive" role="alert">{error()}</div></Show>
      <Show when={!canRead()}><div class="host-apps-empty"><ActivityBarHostApplicationsIcon class="w-9 h-9" /><h2>{i18n.t('hostApplications.permissionTitle')}</h2><p>{i18n.t('hostApplications.readPermission')}</p></div></Show>
      <Show when={canRead()}>
        <Show when={catalog()} fallback={<div role="status" aria-label={i18n.t('hostApplications.loading')} class="host-apps-skeleton"><div class="host-apps-skeleton-heading" aria-hidden="true" /><div class="host-apps-grid" aria-hidden="true"><For each={[0,1,2,3,4,5]}>{() => <div class="host-app-skeleton-tile"><span /><i /><i /><i /></div>}</For></div></div>}>
          <Show when={!catalog()!.availability.ready}>
            <div class="host-apps-notice"><ActivityBarHostApplicationsIcon class="w-5 h-5 shrink-0" /><div><strong>{i18n.t(catalog()!.availability.supported ? 'hostApplications.setupTitle' : 'hostApplications.unsupportedTitle')}</strong><p>{i18n.t(!catalog()!.availability.supported ? 'hostApplications.unsupportedDescription' : catalog()!.availability.reason === 'catalog_unavailable' ? 'hostApplications.catalogUnavailable' : 'hostApplications.setupDescription')}</p>
              <Show when={catalog()!.availability.requirements?.length}><p>{i18n.t('hostApplications.setupRequirements', { requirements: catalog()!.availability.requirements!.join(', ') })}</p></Show>
              <Show when={catalog()!.availability.supported}><a class="host-apps-setup-guide" href="https://github.com/Xpra-org/xpra/wiki/Download" target="_blank" rel="noopener noreferrer">{i18n.t('hostApplications.setupGuide')}<ExternalLink class="w-3 h-3" /></a></Show></div></div>
          </Show>
          <Show when={canRead() && !canLaunch()}><div class="host-apps-notice">{i18n.t('hostApplications.launchPermission')}</div></Show>
          <Show when={running().length}>
            <section class="host-apps-running" aria-label={i18n.t('hostApplications.running')}>
              <div class="host-apps-section-title"><h2>{i18n.t('hostApplications.running')}</h2><span>{running().length}</span></div>
              <p class="host-apps-hint">{i18n.t('hostApplications.retained')}</p>
              <div class="host-apps-session-grid"><For each={running()}>{session =>
                <div class={`host-app-session ${redevenSurfaceRoleClass('panelInteractive')}`}>
                  <button class="host-app-session-open" onClick={() => void open(session.application)} disabled={!canLaunch() || busy()[session.application.id]}>
                    <ApplicationIcon app={session.application} /><span class="min-w-0"><strong class="block truncate">{session.application.name}</strong><span class="host-app-status"><span class="host-app-status-dot" />{i18n.t(session.state === 'starting' ? 'hostApplications.starting' : 'hostApplications.resume')}</span></span><ExternalLink class="w-3.5 h-3.5 ml-auto shrink-0 opacity-50" />
                  </button>
                  <button class="host-app-stop" onClick={() => setEnding(session)} disabled={!canLaunch()} title={i18n.t('hostApplications.stop')} aria-label={`${i18n.t('hostApplications.stop')} · ${session.application.name}`}><Stop class="w-3.5 h-3.5" /></button>
                </div>
              }</For></div>
            </section>
          </Show>
          <Show when={catalog()!.availability.supported}><section class="host-apps-library" aria-label={i18n.t('hostApplications.library')}>
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
              </div>
            </div>
            <Show when={apps().length} fallback={<div class="host-apps-empty"><Search class="w-8 h-8" /><h2>{i18n.t(query() ? 'hostApplications.noResults' : 'hostApplications.emptyTitle')}</h2><p>{i18n.t(query() ? 'hostApplications.noResultsDescription' : 'hostApplications.emptyDescription')}</p></div>}>
              <div class="host-apps-grid"><For each={apps()}>{app => <div class="host-app-tile-wrap">
                <button class={`host-app-tile ${redevenSurfaceRoleClass('panelInteractive')}`} aria-busy={starting(app.id)} disabled={!canLaunch() || !catalog()!.availability.ready || busy()[app.id]} onClick={() => void open(app)} aria-label={`${i18n.t(runningByApp().has(app.id) ? 'hostApplications.resume' : 'hostApplications.open')} · ${app.name}`}>
                  <div class="host-app-tile-top"><ApplicationIcon app={app} /><span class="host-app-tile-affordance" aria-hidden="true"><Show when={runningByApp().get(app.id)?.state === 'running'}><span class="host-app-status-dot" /></Show><ExternalLink class="host-app-open-icon w-3.5 h-3.5" /></span></div>
                  <strong>{app.name}</strong><Show when={app.description}><p title={app.description}>{app.description}</p></Show>
                  <Show when={starting(app.id)}><span class="host-app-tile-action" role="status"><span class="host-app-launch-indicator" aria-hidden="true" />{i18n.t('hostApplications.starting')}</span></Show>
                </button>
                <Show when={appErrors()[app.id] || catalog()?.sessions.find(s => s.application.id === app.id)?.state === 'failed'}><p class="host-app-error" role="alert">{appErrors()[app.id] || i18n.t('hostApplications.errors.failed')}</p></Show>
              </div>}</For></div>
            </Show>
          </section></Show>
        </Show>
      </Show>
    </div>
    <ConfirmDialog open={Boolean(ending())} onOpenChange={value => { if (!value && !stopBusy()) setEnding(null); }} title={i18n.t('hostApplications.stopTitle')} description={i18n.t('hostApplications.stopDescription')} confirmText={i18n.t('hostApplications.stop')} cancelText={i18n.t('hostApplications.cancel')} variant="destructive" loading={stopBusy()} onConfirm={() => void stop()} />
    <Dialog open={addOpen()} onOpenChange={value => { if (!addBusy()) setAddOpen(value); }} title={i18n.t('hostApplications.addTitle')} footer={<><Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addBusy()}>{i18n.t('hostApplications.cancel')}</Button><Button onClick={() => void add()} disabled={addBusy() || !name().trim() || !executable().trim()}>{i18n.t('hostApplications.add')}</Button></>}>
      <div class="space-y-4"><p class="text-sm text-muted-foreground">{i18n.t('hostApplications.addDescription')}</p>
        <label class="block space-y-1.5"><span class="text-xs font-medium">{i18n.t('hostApplications.name')}</span><Input value={name()} onInput={e => setName(e.currentTarget.value)} maxLength={120} /></label>
        <label class="block space-y-1.5"><span class="text-xs font-medium">{i18n.t('hostApplications.executable')}</span><Input value={executable()} onInput={e => setExecutable(e.currentTarget.value)} placeholder="/usr/bin/gedit" /></label>
        <label class="block space-y-1.5"><span class="text-xs font-medium">{i18n.t('hostApplications.arguments')}</span><Input value={argumentsText()} onInput={e => setArgumentsText(e.currentTarget.value)} /></label>
        <Show when={addError()}><p role="alert" class="text-sm text-destructive">{addError()}</p></Show>
      </div>
    </Dialog>
  </div>;
}
