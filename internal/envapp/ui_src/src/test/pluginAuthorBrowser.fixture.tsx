import '../index.css';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../ui/i18n';
import { bindSessionHTTP } from '../ui/services/sessionHTTP';
import { PluginCreationWorkspace } from '../ui/plugins/PluginCreationWorkspace';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import { PluginSurfaceBody } from '../ui/plugins/PluginSurfaceFrame';
import { createPluginConfirmationQueue, PluginConfirmationDialog } from '../ui/plugins/PluginConfirmationQueue';
import { createPluginSurfacePlacementCoordinator, createRedevenPluginPlatform } from '../ui/plugins/pluginPlatform';
import type { PluginSurfaceLaunchTarget } from '../ui/plugins/pluginTypes';

const configuration: { draftID: string; workspaceID: string; formal: boolean; target: PluginSurfaceLaunchTarget } =
  await (await fetch('/qualification.json')).json();
const release = bindSessionHTTP({ fetch: globalThis.fetch.bind(globalThis), events: async function* () {} });
const platform = createRedevenPluginPlatform();
const coordinator = createPluginSurfacePlacementCoordinator(platform.client);
const confirmations = createPluginConfirmationQueue();
const [visible, setVisible] = createSignal(true);
let close: (() => Promise<boolean>) | null = null;
const fail = (error: unknown) => {
  document.querySelector('#failure')!.textContent += String(error);
};
render(
  () => (
    <FloeConfigProvider>
      <I18nProvider>
        <header
          style={{
            height: '44px',
            display: 'flex',
            'align-items': 'center',
            padding: '0 12px',
            'font-size': '13px',
            'border-bottom': '1px solid var(--border)',
          }}
        >
          {configuration.formal ? 'Installed plugin' : 'Plugin authoring qualification'}
          <Show when={configuration.formal}>
            <button
              style={{ 'margin-left': 'auto' }}
              onClick={() =>
                void (async () => {
                  if (!close || (await close())) setVisible(false);
                })()
              }
            >
              Close surface
            </button>
            <button onClick={() => setVisible(true)}>Reopen surface</button>
          </Show>
        </header>
        <main style={{ height: 'calc(100dvh - 44px)', display: 'flex', 'min-height': 0 }}>
          <Show when={visible()}>
            <Show
              when={configuration.formal}
              fallback={
                <PluginCreationWorkspace
                  draftID={configuration.draftID}
                  draftCoordinator={createFlowerComposerDraftCoordinator()}
                  visible
                  canManage
                  onBack={() => setVisible(false)}
                  onSaved={() => {}}
                  onInstalled={() => {}}
                  renderFlower={() => (
                    <p style={{ padding: '12px', 'font-size': '13px' }}>
                      The real model has completed this draft. This carrier exercises preview, review and installation.
                    </p>
                  )}
                />
              }
            >
              <PluginSurfaceBody
                coordinator={coordinator}
                target={configuration.target}
                visible
                confirmationQueue={confirmations}
                registerClose={(value) => {
                  close = value;
                }}
                onRetirementError={fail}
              />
            </Show>
          </Show>
        </main>
        <pre id="failure" role="alert" />
        <PluginConfirmationDialog queue={confirmations} />
      </I18nProvider>
    </FloeConfigProvider>
  ),
  document.querySelector('#root')!,
);
window.addEventListener('pagehide', () => {
  release();
  confirmations.cancelAll();
  void coordinator.dispose();
});
