import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
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
import { useEnvContext } from './EnvContext';

export function EnvBrowserPage(props: { onInteraction?(): void; onOpenWindow(request: BrowserWorkspaceRequest): Promise<void> }) {
  const i18n = useI18n();
  const theme = useTheme();
  const environment = useEnvContext();
  const protocol = useProtocol();
  const service = browserSourceService(environment.env_id());
  const controller = createBrowserWorkspaceController(service, { request: { managed_profile_id: 'browser-main' }, label: '' });
  const [state, setState] = createSignal(controller.snapshot());
  const unsubscribe = controller.subscribe(setState);
  const [choosing, setChoosing] = createSignal(false);
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
    <Show when={state().view && protocol.session?.()} fallback={<Show when={!choosing()}><BrowserWorkspaceNotice state={state()} service={service} messages={sourceMessages()}
      connected={Boolean(protocol.session?.())} retry={controller.reconnect} recover={controller.recover} chooseSource={() => setChoosing(true)} /></Show>}>
      <FloeBrowserSurface session={protocol.session!()!} view={state().view!} title={i18n.t('shell.nav.remoteBrowser')} locale={i18n.locale()} messages={messages()}
        sources={{ service, messages: sourceMessages(), current: { ...state().selection, label: label() }, select: controller.open }}
        onOpenWindow={() => props.onOpenWindow(controller.currentRequest())}
        onInteraction={() => props.onInteraction?.()}
        copy={{ unavailable: i18n.t('shell.notifications.remoteBrowserUnavailable'), connecting: i18n.t('browserEngine.connection.connecting') }}
        onFailure={code => void controller.fail(code)} onTabs={tabs => controller.selectTarget(tabs.active)} onReconnect={() => void controller.reconnect().catch(() => undefined)} />
    </Show>
    <Show when={choosing()}><BrowserSourceDialog service={service} messages={sourceMessages()} current={state().selection} onClose={() => setChoosing(false)}
      onSelect={async (next, signal) => { await controller.open(next, signal); setChoosing(false); }} /></Show>
  </div>;
}
