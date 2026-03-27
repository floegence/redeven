import { createContext, useContext, type Resource } from 'solid-js';
import type { EnvironmentDetail, LocalRuntimeInfo } from '../services/controlplaneApi';
import type { AskFlowerIntent } from './askFlowerIntent';

export type EnvNavTab = 'deck' | 'terminal' | 'monitor' | 'files' | 'codespaces' | 'ports' | 'ai' | 'codex';

export type EnvSettingsSection =
  | 'config'
  | 'connection'
  | 'agent'
  | 'runtime'
  | 'logging'
  | 'codespaces'
  | 'permission_policy'
  | 'skills'
  | 'ai'
  | 'codex';

export type AskFlowerComposerAnchor = {
  x: number;
  y: number;
};

export type OpenTerminalInDirectoryRequest = {
  requestId: string;
  workingDir: string;
  preferredName?: string;
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

  goTab: (tab: EnvNavTab) => void;
  filesSidebarOpen: () => boolean;
  setFilesSidebarOpen: (open: boolean) => void;
  toggleFilesSidebar: () => void;

  settingsSeq: () => number;
  bumpSettingsSeq: () => void;
  openSettings: (section?: EnvSettingsSection) => void;
  openDebugConsole: () => void;
  settingsFocusSeq: () => number;
  settingsFocusSection: () => EnvSettingsSection | null;

  askFlowerIntentSeq: () => number;
  askFlowerIntent: () => AskFlowerIntent | null;
  injectAskFlowerIntent: (intent: AskFlowerIntent) => void;
  openAskFlowerComposer: (intent: AskFlowerIntent, anchor?: AskFlowerComposerAnchor) => void;
  openTerminalInDirectoryRequestSeq: () => number;
  openTerminalInDirectoryRequest: () => OpenTerminalInDirectoryRequest | null;
  openTerminalInDirectory: (workingDir: string, options?: { preferredName?: string }) => void;
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
