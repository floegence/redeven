import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { BrowserSourceDialog } from './ui/widgets/BrowserSourceDialog';
import type { BrowserSourceMessages } from './ui/i18n/browserSourceMessages';
import type { BrowserSourceService, BrowserSourceSelection } from './ui/services/browserSourceContract';
import './styles/browserSourcesDocument.css';

/** The same chooser as the Env App, given only named product operations. */
export function mountBrowserSources(configuration: { service: BrowserSourceService; messages: BrowserSourceMessages; current: BrowserSourceSelection; select(selection: BrowserSourceSelection, signal: AbortSignal): Promise<void>; close(): void }): () => void {
  const container = document.createElement('div'); document.body.append(container);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider><BrowserSourceDialog
    service={configuration.service} messages={configuration.messages} current={configuration.current}
    onSelect={configuration.select} onClose={configuration.close} /></LayoutProvider></FloeConfigProvider>, container);
  return () => { dispose(); container.remove(); };
}
