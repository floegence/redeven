import { createContext, useContext, type Resource } from 'solid-js';
import type { EnvironmentDetail } from '../services/controlplaneApi';

export type EnvNavTab = 'deck' | 'terminal' | 'monitor' | 'files' | 'codespaces' | 'ports' | 'ai';

export type EnvSettingsSection = 'ai';

export type EnvContextValue = {
  env_id: () => string;
  env: Resource<EnvironmentDetail | null>;
  connect: () => Promise<void>;
  connecting: () => boolean;
  connectError: () => string | null;

  goTab: (tab: EnvNavTab) => void;

  settingsSeq: () => number;
  bumpSettingsSeq: () => void;
  openSettings: (section?: EnvSettingsSection) => void;
  settingsFocusSeq: () => number;
  settingsFocusSection: () => EnvSettingsSection | null;

  aiInjectionSeq: () => number;
  aiInjectionMarkdown: () => string | null;
  injectAiMarkdown: (markdown: string) => void;
};

export const EnvContext = createContext<EnvContextValue>();

export function useEnvContext(): EnvContextValue {
  const ctx = useContext(EnvContext);
  if (!ctx) {
    throw new Error('EnvContext is missing');
  }
  return ctx;
}
