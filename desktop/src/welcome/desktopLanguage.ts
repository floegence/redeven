import type { RedevenLanguageSnapshot, RedevenLocalePreference } from '../shared/i18n';

type WelcomeDesktopLanguageBridge = Readonly<{
  getSnapshot: () => RedevenLanguageSnapshot;
  setPreference: (preference: RedevenLocalePreference) => RedevenLanguageSnapshot;
  subscribe: (listener: (snapshot: RedevenLanguageSnapshot) => void) => () => void;
}>;

export function desktopLanguageBridge(): WelcomeDesktopLanguageBridge | null {
  const candidate = (window as Window & {
    redevenDesktopLanguage?: WelcomeDesktopLanguageBridge;
  }).redevenDesktopLanguage;
  if (
    !candidate
    || typeof candidate.getSnapshot !== 'function'
    || typeof candidate.setPreference !== 'function'
    || typeof candidate.subscribe !== 'function'
  ) {
    return null;
  }
  return candidate;
}
