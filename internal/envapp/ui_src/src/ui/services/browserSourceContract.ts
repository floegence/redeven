import type { FlowerBrowserInstallationSnapshot, FlowerBrowserInstallRequest, FlowerChromeStatus, FlowerComputerExtensionSetup, FlowerComputerManagement } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { BrowserWorkspaceRequest } from './browserWindowProtocol';

export type BrowserSourceTab = { id: string; profile_id: string; title: string; url: string };
export type BrowserSourceProfile = { id: string; name: string };
export type BrowserSourceSelection = { request: BrowserWorkspaceRequest; label: string };
export type BrowserSourceManagement = Pick<FlowerComputerManagement, 'browserDesktopAvailable' | 'subscribeBrowserInstallation' | 'loadBrowserInstallation' | 'saveBrowserEnabled' | 'installBrowser' | 'setupExtension' | 'openExtension' | 'loadExtensionStatus'>;
export type BrowserSourceService = {
  management: BrowserSourceManagement;
  profiles(signal: AbortSignal): Promise<BrowserSourceProfile[]>;
  createProfile(name: string, signal: AbortSignal): Promise<BrowserSourceProfile[]>;
  status(signal: AbortSignal): Promise<FlowerChromeStatus>;
  tabs(profile: string, signal: AbortSignal): Promise<BrowserSourceTab[]>;
  discover(endpoint: string, signal: AbortSignal): Promise<BrowserSourceTab[]>;
};

// The independent document can name only these product operations. It receives
// neither a generic fetch proxy nor Desktop/session capabilities.
export type BrowserSourceOperation =
  | { method: 'source.profiles' | 'source.status' | 'source.setup' | 'source.installation' }
  | { method: 'source.createProfile'; name: string }
  | { method: 'source.tabs'; profile: string }
  | { method: 'source.discover'; endpoint: string }
  | { method: 'source.openExtension'; action: 'extensions' | 'folder' | 'connect' }
  | { method: 'source.enabled'; enabled: boolean }
  | { method: 'source.install'; request: FlowerBrowserInstallRequest }
  | { method: 'source.watch'; enabled: boolean }
  | { method: 'source.select'; selection: BrowserSourceSelection };
export type BrowserSourceResult = BrowserSourceProfile[] | BrowserSourceTab[] | FlowerChromeStatus | FlowerBrowserInstallationSnapshot | FlowerComputerExtensionSetup | undefined;
