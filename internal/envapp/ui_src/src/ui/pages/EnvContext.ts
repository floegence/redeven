import { createContext, useContext, type Resource } from 'solid-js';
import type { EnvironmentDetail, LocalRuntimeInfo } from '../services/controlplaneApi';
import type { AskFlowerIntent } from './askFlowerIntent';
import type {
  EnvFileBrowserSurfacePayload,
  EnvOpenSurfaceOptions,
  EnvSurfaceId,
  EnvTerminalSurfacePayload,
  EnvViewMode,
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

export type AskFlowerComposerAnchor = {
  x: number;
  y: number;
};

export type SetEnvViewModeOptions = {
  surfaceId?: EnvSurfaceId;
  focusSurface?: boolean;
};

export type EnvDeckSurfaceActivationRequest = {
  requestId: string;
  surfaceId: EnvSurfaceId;
  widgetId?: string;
  focus?: boolean;
  ensureVisible?: boolean;
};

export type EnvWorkbenchSurfaceActivationRequest = {
  requestId: string;
  surfaceId: EnvSurfaceId;
  widgetId?: string;
  focus?: boolean;
  ensureVisible?: boolean;
  centerViewport?: boolean;
  openStrategy?: EnvWorkbenchSurfaceOpenStrategy;
  terminalPayload?: EnvTerminalSurfacePayload;
  fileBrowserPayload?: EnvFileBrowserSurfacePayload;
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
  connectError: () => string | null;
  connectionOverlayVisible: () => boolean;
  connectionOverlayMessage: () => string;

  viewMode: () => EnvViewMode;
  setViewMode: (mode: EnvViewMode, options?: SetEnvViewModeOptions) => void;
  activeSurface: () => EnvSurfaceId;
  lastActivitySurface: () => EnvSurfaceId;
  openSurface: (surfaceId: EnvSurfaceId, options?: EnvOpenSurfaceOptions) => void;
  goActivity: (surfaceId: EnvSurfaceId) => void;
  deckSurfaceActivationSeq: () => number;
  deckSurfaceActivation: () => EnvDeckSurfaceActivationRequest | null;
  consumeDeckSurfaceActivation: (requestId: string) => void;
  workbenchSurfaceActivationSeq: () => number;
  workbenchSurfaceActivation: () => EnvWorkbenchSurfaceActivationRequest | null;
  consumeWorkbenchSurfaceActivation: (requestId: string) => void;
  filesSidebarOpen: () => boolean;
  setFilesSidebarOpen: (open: boolean) => void;
  toggleFilesSidebar: () => void;

  settingsSeq: () => number;
  bumpSettingsSeq: () => void;
  openSettings: (section?: EnvSettingsSection) => void;
  debugConsoleEnabled: () => boolean;
  setDebugConsoleEnabled: (enabled: boolean) => void;
  openDebugConsole: () => void;
  settingsFocusSeq: () => number;
  settingsFocusSection: () => EnvSettingsSection | null;

  askFlowerIntentSeq: () => number;
  askFlowerIntent: () => AskFlowerIntent | null;
  injectAskFlowerIntent: (intent: AskFlowerIntent) => void;
  openAskFlowerComposer: (intent: AskFlowerIntent, anchor?: AskFlowerComposerAnchor) => void;
  openTerminalInDirectoryRequestSeq: () => number;
  openTerminalInDirectoryRequest: () => OpenTerminalInDirectoryRequest | null;
  openTerminalInDirectory: (
    workingDir: string,
    options?: {
      preferredName?: string;
      openStrategy?: EnvWorkbenchSurfaceOpenStrategy;
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
  consumeOpenTerminalInDirectoryRequest: (requestId: string) => void;

  aiThreadFocusSeq: () => number;
  aiThreadFocusId: () => string | null;
  focusAIThread: (threadId: string) => void;
};

export const EnvContext = createContext<EnvContextValue>();

export function useEnvContext(): EnvContextValue {
  const ctx = useContext(EnvContext);
  if (!ctx) {
    throw new Error('EnvContext is missing');
  }
  return ctx;
}
