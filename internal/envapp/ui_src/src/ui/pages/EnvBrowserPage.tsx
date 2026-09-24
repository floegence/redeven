import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, Globe } from '@floegence/floe-webapp-core/icons';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { FloeBrowserSurface } from '../widgets/FloeBrowserSurface';
import { BrowserSourceDialog, type BrowserSourceSelection } from '../widgets/BrowserSourceDialog';
import { fetchSessionJSON } from '../services/sessionHTTP';
import type { BrowserViewDescriptor, BrowserWorkspaceRequest } from '../services/browserWindowProtocol';
import { useI18n } from '../i18n';
import { browserSourceService } from '../services/browserSourceManagement';
import { browserSourceMessages } from '../i18n/browserSourceMessages';
import { browserMessages } from '../i18n/browserMessages';
import { BrowserWindowBlockedError, browserWorkspaceSource, openBrowserWorkspace } from '../services/browserWorkspaceWindows';
import { useEnvContext } from './EnvContext';

/** The existing environment Session owns all browser carriers, independently
 * of Flower or model configuration. Selecting a source does not select AI work. */
export function EnvBrowserPage(props: { onOpenWindow(request: BrowserWorkspaceRequest): Promise<void> }) {
  const i18n = useI18n();
  const environment = useEnvContext();
  const protocol = useProtocol();
  const sourceService = browserSourceService(environment.env_id());
  const [selection, setSelection] = createSignal<BrowserSourceSelection>({ request: { managed_profile_id: 'browser-main' }, label: '' });
  const [choosing, setChoosing] = createSignal(false);
  const [view, setView] = createSignal<BrowserViewDescriptor>();
  const [failed, setFailed] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [windowFailed, setWindowFailed] = createSignal<'blocked' | 'unavailable'>();
  const [generation, setGeneration] = createSignal(0);
  const messages = createMemo(() => browserMessages(i18n));
  const label = () => 'managed_profile_id' in selection().request && (selection().request as { managed_profile_id: string }).managed_profile_id === 'browser-main'
    ? i18n.t('browserProduct.defaultProfile') : selection().label;
  const retry = () => setGeneration(value => value + 1);
  let confirmed: BrowserWorkspaceRequest | undefined;
  let previousSelection: BrowserSourceSelection | undefined;
  let previousSession: unknown;
  createEffect(on(() => [protocol.session?.(), selection(), generation(), i18n.locale()] as const, ([session, selected]) => {
    if (selected !== previousSelection || session !== previousSession) confirmed = undefined;
    previousSelection = selected; previousSession = session;
    setView(undefined); setFailed(false); setWindowFailed(undefined);
    if (!session) return;
    const controller = new AbortController();
    let issued: BrowserViewDescriptor | undefined;
    void openBrowserWorkspace(confirmed ?? selected.request, controller.signal).then(result => {
      issued = result;
      if (controller.signal.aborted) {
        void fetchSessionJSON(`/_redeven_proxy/api/browser/views/${encodeURIComponent(result.id)}`, { method: 'DELETE' }).catch(() => undefined);
      } else { confirmed = browserWorkspaceSource(result); setView(result); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    onCleanup(() => {
      controller.abort();
      if (issued) void fetchSessionJSON(`/_redeven_proxy/api/browser/views/${encodeURIComponent(issued.id)}`, { method: 'DELETE' }).catch(() => undefined);
    });
  }));
  return <div class="redeven-browser-page">
    <div class="redeven-browser-profile-bar">
      <Button variant="ghost" size="sm" onClick={() => setChoosing(true)} aria-label={i18n.t('browserProduct.sources')}><Globe class="size-3.5" /><span class="max-w-64 truncate">{label()}</span><ChevronDown class="size-3.5" /></Button>
      <Button variant="outline" size="sm" disabled={opening() || !view() || !protocol.session?.()} onClick={() => {
        setOpening(true); setWindowFailed(undefined);
        void props.onOpenWindow(confirmed ?? selection().request).catch(error => setWindowFailed(error instanceof BrowserWindowBlockedError ? 'blocked' : 'unavailable')).finally(() => setOpening(false));
      }}>{i18n.t('browserProduct.openWindow')}</Button>
      <Show when={windowFailed()}><span role="alert" class="text-xs text-destructive">{i18n.t(windowFailed() === 'blocked' ? 'browserProduct.windowBlocked' : 'browserProduct.windowUnavailable')}</span></Show>
    </div>
    <Show when={view() && protocol.session?.()} fallback={<div class="redeven-floebrowser-page-loading" role={failed() ? 'alert' : 'status'}>
      <p>{failed() ? i18n.t('shell.notifications.remoteBrowserUnavailable') : i18n.t('browserEngine.connection.connecting')}</p>
      <Show when={failed()}><div class="flex flex-wrap justify-center gap-2"><Button variant="outline" size="sm" onClick={retry}>{i18n.t('browserEngine.connection.reconnect')}</Button>
        <Button size="sm" onClick={() => setChoosing(true)}>{i18n.t('browserProduct.sources')}</Button></div></Show>
    </div>}>
      <FloeBrowserSurface session={protocol.session!()!} view={view()!} title={i18n.t('shell.nav.remoteBrowser')} locale={i18n.locale()} messages={messages()}
        copy={{ unavailable: i18n.t('shell.notifications.remoteBrowserUnavailable'), connecting: i18n.t('browserEngine.connection.connecting') }} onReconnect={retry} />
    </Show>
    <Show when={choosing()}><BrowserSourceDialog service={sourceService} messages={browserSourceMessages(i18n)} current={selection()} onClose={() => setChoosing(false)}
      onSelect={next => { setSelection({ ...next }); setChoosing(false); }} /></Show>
  </div>;
}
