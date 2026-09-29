import { bindSessionHTTP } from '../src/ui/services/sessionHTTP';
import { browserSourceMessages } from '../src/ui/i18n/browserSourceMessages';
import { createI18nHelpers } from '../src/ui/i18n/createI18n';
import { enUS } from '../src/ui/i18n/locales/en-US';
import { createArtifactLease, parseArtifact } from '@floegence/flowersec-core';
import { connectProxyBrowser } from '@floegence/flowersec-core/proxy';
import { englishMessages } from '@floegence/floebrowser/viewer';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeBrowserSurface } from '../src/ui/widgets/FloeBrowserSurface';
import { createBrowserWorkspaceController } from '../src/ui/services/browserWorkspaceController';
import type { BrowserWorkspaceRequest } from '../src/ui/services/browserWindowProtocol';
import { browserSourceService } from '../src/ui/services/browserSourceManagement';
import { createBrowserWorkspaceWindows } from '../src/ui/services/browserWorkspaceWindows';

// A small trusted environment owner using the actual product bridge. It owns
// exactly one Session and one proxy runtime; browser documents only get ports.
declare global {
  interface Window {
    startBrowserFixture(configuration: { artifact: string; target: string; managed?: boolean; connection: Extract<BrowserWorkspaceRequest, { connection: unknown }>['connection'] }): Promise<void>;
    closeBrowserFixture(): Promise<void>;
    leaveBrowserPage(): void;
    setBrowserFixturePrivate(privateMode: boolean): Promise<void>;
    browserFixtureCDPTabs(endpoint: string): Promise<Array<{ title: string; url: string }>>;
  }
}
window.startBrowserFixture = async ({ artifact, connection, managed }) => {
  const owner = await connectProxyBrowser(createArtifactLease(parseArtifact(artifact), async () => undefined), {
    serviceWorker: { scriptUrl: '/_redeven_sw.js', scope: '/' },
    runtime: { pathPolicy: { allowedPathPrefixes: ['/_redeven_proxy/'] } },
  });
  const releaseHTTP = bindSessionHTTP({ fetch: (input, init) => owner.runtime.fetch(input, init), events: async function* () { throw new Error('Unexpected event stream'); } });
  const sourceMessages = browserSourceMessages(createI18nHelpers('en-US', enUS));
  const service = browserSourceService('browser-fixture');
  const controller = createBrowserWorkspaceController(service, { label: 'Default profile', request: managed ? { managed_profile_id: 'browser-main' } : { connection } });
  controller.setSession(owner.session);
  await controller.reconnect();
  const [workspace, setWorkspace] = createSignal(controller.snapshot());
  const unsubscribe = controller.subscribe(setWorkspace);
  window.browserFixtureCDPTabs = async endpoint => {
    const response = await owner.runtime.fetch('/_redeven_proxy/api/browser/connections/cdp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Fixture CDP directory failed');
    return result.data;
  };
  window.setBrowserFixturePrivate = async privateMode => {
    const inline = controller.snapshot().view!;
    const response = await owner.runtime.fetch(`/_redeven_proxy/api/browser/views/${inline.id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: inline.initial_target, takeover: true, private: privateMode }) });
    if (!response.ok) throw new Error('Fixture private control failed');
  };
  const container = document.createElement('div'); container.className = 'redeven-browser-page'; container.style.height = '800px'; document.body.append(container);
  const independent = createBrowserWorkspaceWindows(() => ({ title: 'Browser transport fixture', connecting: 'Connecting browser', locale: 'en-US', messages: englishMessages, sources: { environment: 'browser-fixture', messages: sourceMessages } }));
  independent.setSession(owner.session);
  const dispose = render(() => <FloeBrowserSurface session={owner.session} view={workspace().view!} title="Browser transport fixture" locale="en-US" messages={englishMessages}
    copy={{ connecting: 'Connecting browser', unavailable: 'Browser unavailable' }} sources={{ service, messages: sourceMessages, current: workspace().selection, select: controller.open }}
    onOpenWindow={() => independent.open(controller.currentRequest())} onReconnect={() => { throw new Error('Unexpected reconnect'); }} onFailure={code => { throw new Error(`Inline browser failed: ${code}`); }}
    onTabs={tabs => controller.selectTarget(tabs.active)} />, container);
  container.querySelector('iframe')!.id = 'browser-document';
  document.querySelector('#open')!.addEventListener('click', () => {
    void independent.open(controller.currentRequest());
  });
  let left = false;
  window.leaveBrowserPage = () => { if (left) return; left = true; dispose(); unsubscribe(); controller.close(); container.remove(); };
  window.closeBrowserFixture = async () => { independent.close(); window.leaveBrowserPage(); await owner.dispose(); releaseHTTP(); };
};
