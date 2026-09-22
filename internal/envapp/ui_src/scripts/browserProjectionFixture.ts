import { browserSourceMessages } from '../src/ui/i18n/browserSourceMessages';
import { createI18nHelpers } from '../src/ui/i18n/createI18n';
import { enUS } from '../src/ui/i18n/locales/en-US';
import { createArtifactLease, parseArtifact } from '@floegence/flowersec-core';
import { connectProxyBrowser } from '@floegence/flowersec-core/proxy';
import { englishMessages } from '@floegence/floebrowser/viewer';
import { createBrowserWindow } from '../src/ui/services/browserWindow';
import { browserDocumentURL, type BrowserViewDescriptor } from '../src/ui/services/browserWindowProtocol';
import { browserWorkspaceSource, createBrowserWorkspaceWindows } from '../src/ui/services/browserWorkspaceWindows';

// A small trusted environment owner using the actual product bridge. It owns
// exactly one Session and one proxy runtime; browser documents only get ports.
declare global {
  interface Window {
    startBrowserFixture(configuration: { artifact: string; target: string; managed?: boolean; connection: { cdp_url: string; profile_id: string; tab_id: string } }): Promise<void>;
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
  const views: ReturnType<typeof createBrowserWindow>[] = [];
  window.browserFixtureCDPTabs = async endpoint => {
    const response = await owner.runtime.fetch('/_redeven_proxy/api/browser/connections/cdp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Fixture CDP directory failed');
    return result.data;
  };
  const allocate = async (): Promise<BrowserViewDescriptor> => {
    const response = await owner.runtime.fetch('/_redeven_proxy/api/browser/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(managed ? { managed_profile_id: 'browser-main' } : { connection }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`Browser view failed: ${JSON.stringify(result)}`);
    return result.data;
  };
  const attach = (view: BrowserViewDescriptor, child: () => Window | null, nonce: string) => {
    views.push(createBrowserWindow({ session: owner.session, view, child, configuration: { type: 'redeven-browser-ports', nonce, title: 'Browser transport fixture', locale: 'en-US', messages: englishMessages, theme: {} }, onReconnect: () => { throw new Error('Unexpected reconnect'); } }));
  };
  const inline = await allocate();
  window.setBrowserFixturePrivate = async privateMode => {
    const response = await owner.runtime.fetch(`/_redeven_proxy/api/browser/views/${inline.id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: inline.initial_target, takeover: true, private: privateMode }) });
    if (!response.ok) throw new Error('Fixture private control failed');
  };
  const frame = document.createElement('iframe'); frame.id = 'browser-document';
  frame.style.cssText = 'display:block;width:100vw;height:800px;border:0';
  frame.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-downloads');
  document.body.append(frame);
  const nonce = crypto.randomUUID();
  attach(inline, () => frame.contentWindow, nonce);
  frame.src = browserDocumentURL(inline, nonce);
  const independent = createBrowserWorkspaceWindows(() => ({ title: 'Browser transport fixture', connecting: 'Connecting browser', locale: 'en-US', messages: englishMessages, sources: { environment: 'browser-fixture', messages: browserSourceMessages(createI18nHelpers('en-US', enUS)) } }));
  independent.setSession(owner.session);
  document.querySelector('#open')!.addEventListener('click', () => {
    void independent.open(browserWorkspaceSource(inline));
  });
  window.leaveBrowserPage = () => { for (const view of views) view.close(); frame.remove(); };
  window.closeBrowserFixture = async () => { independent.close(); for (const view of views) view.close(); await owner.dispose(); };
};
