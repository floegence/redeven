import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, Globe } from '@floegence/floe-webapp-core/icons';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useTheme } from '@floegence/floe-webapp-core';
import { FloeBrowserSurface } from '../widgets/FloeBrowserSurface';
import { BrowserSourceDialog } from '../widgets/BrowserSourceDialog';
import { BrowserWorkspaceNotice } from '../widgets/BrowserWorkspaceNotice';
import type { BrowserWorkspaceRequest } from '../services/browserWindowProtocol';
import { createBrowserWorkspaceController } from '../services/browserWorkspaceController';
import { useI18n } from '../i18n';
import { browserSourceService } from '../services/browserSourceManagement';
import { browserSourceMessages } from '../i18n/browserSourceMessages';
import { browserMessages } from '../i18n/browserMessages';
import { BrowserWindowBlockedError } from '../services/browserWorkspaceWindows';
import { useEnvContext } from './EnvContext';

export function EnvBrowserPage(props: { onOpenWindow(request: BrowserWorkspaceRequest): Promise<void> }) {
  const i18n = useI18n();
  const theme = useTheme();
  const environment = useEnvContext();
  const protocol = useProtocol();
  const service = browserSourceService(environment.env_id());
  const controller = createBrowserWorkspaceController(service, { request: { managed_profile_id: 'browser-main' }, label: '' });
  const [state, setState] = createSignal(controller.snapshot());
  const unsubscribe = controller.subscribe(setState);
  const [choosing, setChoosing] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [windowFailed, setWindowFailed] = createSignal<'blocked' | 'unavailable'>();
  const messages = createMemo(() => browserMessages(i18n));
  const sourceMessages = createMemo(() => browserSourceMessages(i18n));
  const label = () => 'managed_profile_id' in state().selection.request && (state().selection.request as { managed_profile_id: string }).managed_profile_id === 'browser-main'
    ? i18n.t('browserProduct.defaultProfile') : state().selection.label;
  createEffect(on(() => protocol.session?.(), session => {
    controller.setSession(session ?? undefined);
    if (session) void controller.reconnect().catch(() => undefined);
  }));
  const presentation = createMemo(() => JSON.stringify([i18n.locale(), theme.resolvedTheme(), theme.shellPresetForMode(theme.resolvedTheme())?.name]));
  createEffect(on(presentation, () => {
    if (state().view) void controller.reconnect().catch(() => undefined);
  }, { defer: true }));
  onCleanup(() => { unsubscribe(); controller.close(); });
  return <div class="redeven-browser-page">
    <div class="redeven-browser-profile-bar">
      <Button variant="ghost" size="sm" onClick={() => setChoosing(true)} aria-label={i18n.t('browserProduct.sources')}><Globe class="size-3.5" /><span class="max-w-64 truncate">{label()}</span><ChevronDown class="size-3.5" /></Button>
      <Button variant="outline" size="sm" disabled={opening() || !state().view || !protocol.session?.()} onClick={() => {
        setOpening(true); setWindowFailed(undefined);
        void props.onOpenWindow(state().selection.request).catch(error => setWindowFailed(error instanceof BrowserWindowBlockedError ? 'blocked' : 'unavailable')).finally(() => setOpening(false));
      }}>{i18n.t('browserProduct.openWindow')}</Button>
      <Show when={windowFailed()}><span role="alert" class="text-xs text-destructive">{i18n.t(windowFailed() === 'blocked' ? 'browserProduct.windowBlocked' : 'browserProduct.windowUnavailable')}</span></Show>
    </div>
    <Show when={state().view && protocol.session?.()} fallback={<Show when={!choosing()}><BrowserWorkspaceNotice state={state()} service={service} messages={sourceMessages()}
      connected={Boolean(protocol.session?.())} retry={controller.reconnect} recover={controller.recover} chooseSource={() => setChoosing(true)} /></Show>}>
      <FloeBrowserSurface session={protocol.session!()!} view={state().view!} title={i18n.t('shell.nav.remoteBrowser')} locale={i18n.locale()} messages={messages()}
        copy={{ unavailable: i18n.t('shell.notifications.remoteBrowserUnavailable'), connecting: i18n.t('browserEngine.connection.connecting') }}
        onFailure={code => void controller.fail(code)} onTabs={tabs => controller.selectTarget(tabs.active)} onReconnect={() => void controller.reconnect().catch(() => undefined)} />
    </Show>
    <Show when={choosing()}><BrowserSourceDialog service={service} messages={sourceMessages()} current={state().selection} onClose={() => setChoosing(false)}
      onSelect={async (next, signal) => { await controller.open(next, signal); setChoosing(false); }} /></Show>
  </div>;
}
