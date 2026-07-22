import { createContext, useContext, type Resource } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type {
  FlowerFileOpenRequest,
  FlowerLinkedContextPathOpenRequest,
  FlowerThreadFocusRequest,
  FlowerTurnLauncherAnchor,
  FlowerTurnLauncherIntent,
} from '../../../../../flower_ui/src';
import type { EnvironmentDetail, LocalRuntimeInfo } from '../services/controlplaneApi';
import type { FilePreviewOpenOptions } from '../widgets/FilePreviewContext';
import type { FlowerCanonicalReferenceNavigationTarget } from '../flower/linkedContextNavigation';
import type {
  EnvFileBrowserSurfacePayload,
  EnvOpenSurfaceOptions,
  EnvSurfaceId,
  EnvTerminalSurfacePayload,
  EnvViewMode,
  EnvWorkbenchHandoffAnchor,
  EnvWorkbenchSurfaceOpenStrategy,
} from '../envViewMode';

export type EnvSettingsSection =
  | 'config'
  | 'connection'
  | 'agent'
  | 'runtime'
  | 'logging'
  | 'debug_console'
  | 'codespaces'
  | 'permission_policy'
  | 'skills'
  | 'ai'
  | 'codex';

export type EnvSettingsOrigin =
  | {
      kind: 'flower';
      returnSurfaceId: EnvSurfaceId;
    }
  | null;

export type OpenEnvSettingsOptions = {
  origin?: EnvSettingsOrigin;
};

export type SetEnvViewModeOptions = {
  surfaceId?: EnvSurfaceId;
  focusSurface?: boolean;
  requestWorkbenchOverview?: boolean;
};

export type EnvWorkbenchSurfaceActivationRequest = {
  requestId: string;
  surfaceId: EnvSurfaceId;
  widgetId?: string;
  focus?: boolean;
  ensureVisible?: boolean;
  centerViewport?: boolean;
  openStrategy?: EnvWorkbenchSurfaceOpenStrategy;
  workbenchAnchor?: EnvWorkbenchHandoffAnchor;
  terminalPayload?: EnvTerminalSurfacePayload;
  fileBrowserPayload?: EnvFileBrowserSurfacePayload;
};

export type EnvWorkbenchFilePreviewActivationRequest = {
  requestId: string;
  item: FileItem;
  focus?: boolean;
  ensureVisible?: boolean;
  centerViewport?: boolean;
  openStrategy?: EnvWorkbenchSurfaceOpenStrategy | 'same_file_or_create';
};

export type EnvWorkbenchOverviewEntryRequest = {
  requestId: string;
  reason: 'mode_switch';
};

export type OpenTerminalInDirectoryRequest = {
  requestId: string;
  workingDir: string;
  preferredName?: string;
  targetMode: EnvViewMode;
};

export type EnvContextValue = {
  env_id: () => string;
  env: Resource<EnvironmentDetail | null>;
  localRuntime: () => LocalRuntimeInfo | null;
  connect: () => Promise<void>;
  connecting: () => boolean;

  viewMode: () => EnvViewMode;
  setViewMode: (mode: EnvViewMode, options?: SetEnvViewModeOptions) => void;
  activeSurface: () => EnvSurfaceId;
  lastActivitySurface: () => EnvSurfaceId;
  openSurface: (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => void;
  goActivity: (surfaceId: EnvSurfaceId) => void;
  workbenchSurfaceActivationSeq: () => number;
  workbenchSurfaceActivation: () => EnvWorkbenchSurfaceActivationRequest | null;
  consumeWorkbenchSurfaceActivation: (requestId: string) => void;
  workbenchOverviewEntrySeq: () => number;
  workbenchOverviewEntry: () => EnvWorkbenchOverviewEntryRequest | null;
  consumeWorkbenchOverviewEntry: (requestId: string) => void;
  workbenchFilePreviewActivationSeq: () => number;
  workbenchFilePreviewActivation: () => EnvWorkbenchFilePreviewActivationRequest | null;
  consumeWorkbenchFilePreviewActivation: (requestId: string) => void;
  filesSidebarOpen: () => boolean;
  setFilesSidebarOpen: (open: boolean) => void;
  toggleFilesSidebar: () => void;

  settingsSeq: () => number;
  bumpSettingsSeq: () => void;
  openSettings: (section?: EnvSettingsSection, options?: OpenEnvSettingsOptions) => void;
  settingsOrigin: () => EnvSettingsOrigin;
  returnFromSettingsOrigin: () => void;
  debugConsoleEnabled: () => boolean;
  setDebugConsoleEnabled: (enabled: boolean) => void;
  openDebugConsole: (options?: { query?: string }) => void;
  settingsFocusSeq: () => number;
  settingsFocusSection: () => EnvSettingsSection | null;

  openFlowerTurnLauncher: (intent: FlowerTurnLauncherIntent, anchor?: FlowerTurnLauncherAnchor) => void;
  openTerminalInDirectoryRequestSeq: () => number;
  openTerminalInDirectoryRequest: () => OpenTerminalInDirectoryRequest | null;
  openTerminalInDirectory: (
    workingDir: string,
    options?: {
      preferredName?: string;
      openStrategy?: EnvWorkbenchSurfaceOpenStrategy;
      workbenchAnchor?: EnvWorkbenchHandoffAnchor;
    },
  ) => void;
  openFileBrowserAtPath: (
    path: string,
    options?: {
      homePath?: string;
      title?: string;
      openStrategy?: EnvWorkbenchSurfaceOpenStrategy;
    },
  ) => Promise<void>;
  openFilePreview: (
    item: FileItem,
    options?: FilePreviewOpenOptions,
  ) => Promise<void>;
  openFlowerFileBrowser: (request: FlowerFileOpenRequest) => Promise<void>;
  openFlowerFilePreview: (request: FlowerFileOpenRequest) => Promise<void>;
  openFlowerCanonicalReferenceTarget?: (target: FlowerCanonicalReferenceNavigationTarget) => Promise<void>;
  openFlowerLinkedFilePreview: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  openFlowerLinkedDirectoryBrowser: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  consumeOpenTerminalInDirectoryRequest: (requestId: string) => void;

  aiThreadFocusRequest: () => FlowerThreadFocusRequest | null;
  focusAIThread: (threadId: string) => void;
  consumeAIThreadFocusRequest: (requestId: string) => void;
};

export const EnvContext = createContext<EnvContextValue>();

export function useEnvContext(): EnvContextValue {
  const ctx = useContext(EnvContext);
  if (!ctx) {
    throw new Error('EnvContext is missing');
  }
  return ctx;
}
