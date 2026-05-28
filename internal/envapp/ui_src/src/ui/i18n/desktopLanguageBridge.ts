import { readDesktopHostBridge } from '../services/desktopHostWindow';
import { isRedevenLocale, normalizeLocalePreference, type RedevenLocalePreference } from './localeMeta';
import { resolveLocalePreference, type RedevenLanguageSnapshot } from './resolveLocale';

export type DesktopLanguageBridge = Readonly<{
  getSnapshot: () => RedevenLanguageSnapshot;
  setPreference: (preference: RedevenLocalePreference) => RedevenLanguageSnapshot;
  subscribe: (listener: (snapshot: RedevenLanguageSnapshot) => void) => () => void;
}>;

declare global {
  interface Window {
    redevenDesktopLanguage?: DesktopLanguageBridge;
  }
}

function isDesktopLanguageSnapshot(candidate: unknown): candidate is RedevenLanguageSnapshot {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const snapshot = candidate as Partial<RedevenLanguageSnapshot>;
  const preference = normalizeLocalePreference(snapshot.preference);
  if (
    preference !== snapshot.preference
    || !isRedevenLocale(snapshot.resolved_locale)
    || (snapshot.source !== 'explicit' && snapshot.source !== 'system' && snapshot.source !== 'fallback')
    || !Array.isArray(snapshot.system_candidates)
  ) {
    return false;
  }
  if (snapshot.source === 'explicit') {
    return preference === snapshot.resolved_locale;
  }
  return preference === 'system';
}

function isDesktopLanguageBridge(candidate: unknown): candidate is DesktopLanguageBridge {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const bridge = candidate as Partial<DesktopLanguageBridge>;
  if (
    typeof bridge.getSnapshot !== 'function'
    || typeof bridge.setPreference !== 'function'
    || typeof bridge.subscribe !== 'function'
  ) {
    return false;
  }

  try {
    return isDesktopLanguageSnapshot(bridge.getSnapshot());
  } catch {
    return false;
  }
}

export function desktopLanguageBridge(): DesktopLanguageBridge | null {
  const bridge = readDesktopHostBridge('redevenDesktopLanguage', isDesktopLanguageBridge);
  if (!bridge) {
    return null;
  }

  return {
    getSnapshot: () => {
      const snapshot = bridge.getSnapshot();
      return isDesktopLanguageSnapshot(snapshot)
        ? snapshot
        : fallbackLanguageSnapshot('system', []);
    },
    setPreference: (preference) => {
      const snapshot = bridge.setPreference(preference);
      return isDesktopLanguageSnapshot(snapshot)
        ? snapshot
        : fallbackLanguageSnapshot(preference, []);
    },
    subscribe: (listener) => bridge.subscribe((snapshot) => {
      if (isDesktopLanguageSnapshot(snapshot)) {
        listener(snapshot);
      }
    }),
  };
}

export function fallbackLanguageSnapshot(preference: RedevenLocalePreference, systemCandidates: readonly string[]): RedevenLanguageSnapshot {
  return resolveLocalePreference({ preference, systemCandidates });
}
