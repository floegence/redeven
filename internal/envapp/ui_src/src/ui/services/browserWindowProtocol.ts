import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceOperation, BrowserSourceResult, BrowserSourceSelection } from './browserSourceContract';
import type { BrowserMessages, AddressSuggestion } from '@floegence/floebrowser/viewer';
import type { BrowserState, FileChooserState, TabState } from '@floegence/floebrowser/protocol';

export type BrowserWorkspaceRequest =
  | { source_target: string }
  | { managed_profile_id: string }
  | { connection: { cdp_url: string; profile_id: string; tab_id: string; tab_title?: string; tab_url?: string } }
  | { connection: { extension_profile_id: string; tab_id: string; tab_title: string; tab_url: string } }
  | { connection: { extension_profile_id: string; new_tab: true } };

export type BrowserViewDescriptor = Readonly<{
  id: string;
  protocol_version: number;
  media_wire_version: number;
  profile_id?: string;
  library_profile_id?: string;
  initial_target: string;
}>;

export type BrowserDocumentConfiguration = Readonly<{
  type: 'redeven-browser-ports';
  nonce: string;
  title: string;
  locale: string;
  messages: BrowserMessages;
  theme: Record<string, string>;
  library?: boolean;
  sources?: { messages: BrowserSourceMessages; current: BrowserSourceSelection; desktop: boolean };
}>;

// This private product port has no URL fetch, generic IPC, filesystem or
// environment-session operation. Source page scripts never run in this document.
export type BrowserDocumentRequest = BrowserSourceOperation
  | { method: 'control'; target: string; takeover: boolean; private: boolean }
  | { method: 'suggest'; query: string; tabs: TabState }
  | { method: 'library.list'; kind: 'bookmarks' | 'history'; query: string }
  | { method: 'library.save'; url: string; title: string }
  | { method: 'library.remove'; url: string }
  | { method: 'library.clear' }
  | { method: 'zoom.load'; origin: string }
  | { method: 'zoom.save'; origin: string; factor: number }
  | { method: 'upload'; chooser: FileChooserState; file: File }
  | { method: 'visibility'; visible: boolean };

export type BrowserDocumentEvent =
  | { type: 'reconnect' }
  | { type: 'tabs'; state: TabState }
  | { type: 'state'; state: BrowserState }
  | { type: 'status'; status: 'connecting' | 'refreshing' | 'live' | 'disconnected' };

export type BrowserDocumentResult = BrowserSourceResult | string | number | readonly AddressSuggestion[] | undefined;

export function browserDocumentURL(view: BrowserViewDescriptor, nonce: string): string {
  if (!/^browser-view-[A-Za-z0-9]+$/u.test(view.id) || view.protocol_version !== 22 || view.media_wire_version !== 1)
    throw new Error('Browser version or identity unavailable');
  return `/_redeven_proxy/env/browser/${encodeURIComponent(view.id)}/#${encodeURIComponent(nonce)}`;
}
