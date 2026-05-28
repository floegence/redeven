import { createContext, createEffect, createMemo, createSignal, onCleanup, onMount, useContext, type Accessor, type JSX } from 'solid-js';

import { createI18nHelpers, type I18nHelpers } from './createI18n';
import { desktopLanguageBridge, fallbackLanguageSnapshot } from './desktopLanguageBridge';
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  SYSTEM_LOCALE_PREFERENCE,
  normalizeLocalePreference,
  type RedevenLocale,
  type RedevenLocalePreference,
} from './localeMeta';
import { readStandaloneSystemLanguageCandidates, readStoredLanguagePreference, writeStoredLanguagePreference } from './storage';
import type { RedevenLanguageSnapshot } from './resolveLocale';

export type EnvAppLanguageSource = 'desktop' | 'browser';

export type EnvAppI18nContext = I18nHelpers & Readonly<{
  snapshot: Accessor<RedevenLanguageSnapshot>;
  locale: Accessor<RedevenLocale>;
  localePreference: Accessor<RedevenLocalePreference>;
  source: Accessor<EnvAppLanguageSource>;
  setLocalePreference: (preference: RedevenLocalePreference) => void;
}>;

const EnvAppI18nSolidContext = createContext<EnvAppI18nContext>();

function standaloneSnapshot(preference: RedevenLocalePreference = readStoredLanguagePreference()): RedevenLanguageSnapshot {
  return fallbackLanguageSnapshot(preference, readStandaloneSystemLanguageCandidates());
}

function fallbackContext(): EnvAppI18nContext {
  const snapshot = () => standaloneSnapshot(SYSTEM_LOCALE_PREFERENCE);
  const helpers = createI18nHelpers(DEFAULT_LOCALE);
  return {
    ...helpers,
    snapshot,
    locale: () => DEFAULT_LOCALE,
    localePreference: () => SYSTEM_LOCALE_PREFERENCE,
    source: () => 'browser',
    setLocalePreference: () => undefined,
  };
}

function applyDocumentLanguage(snapshot: RedevenLanguageSnapshot, helpers: I18nHelpers): void {
  if (typeof document === 'undefined') {
    return;
  }
  const meta = LOCALE_META[snapshot.resolved_locale];
  document.documentElement.lang = meta.htmlLang;
  document.documentElement.dir = meta.textDirection;
  document.title = helpers.t('document.title');
}

export function I18nProvider(props: Readonly<{ children: JSX.Element }>) {
  const bridge = desktopLanguageBridge();
  const [source, setSource] = createSignal<EnvAppLanguageSource>(bridge ? 'desktop' : 'browser');
  const [snapshot, setSnapshot] = createSignal<RedevenLanguageSnapshot>(
    bridge?.getSnapshot() ?? standaloneSnapshot(),
  );
  const helpers = createMemo(() => createI18nHelpers(snapshot().resolved_locale));

  const setLocalePreference = (preference: RedevenLocalePreference): void => {
    const normalized = normalizeLocalePreference(preference);
    const activeBridge = desktopLanguageBridge();
    if (activeBridge) {
      setSource('desktop');
      setSnapshot(activeBridge.setPreference(normalized));
      return;
    }

    setSource('browser');
    writeStoredLanguagePreference(normalized);
    setSnapshot(standaloneSnapshot(normalized));
  };

  onMount(() => {
    const activeBridge = desktopLanguageBridge();
    if (activeBridge) {
      setSource('desktop');
      setSnapshot(activeBridge.getSnapshot());
      const unsubscribe = activeBridge.subscribe((next) => {
        setSource('desktop');
        setSnapshot(next);
      });
      onCleanup(unsubscribe);
      return;
    }

    const handleLanguageChange = () => {
      if (snapshot().preference === SYSTEM_LOCALE_PREFERENCE) {
        setSnapshot(standaloneSnapshot(SYSTEM_LOCALE_PREFERENCE));
      }
    };
    window.addEventListener('languagechange', handleLanguageChange);
    onCleanup(() => window.removeEventListener('languagechange', handleLanguageChange));
  });

  createEffect(() => {
    applyDocumentLanguage(snapshot(), helpers());
  });

  const value: EnvAppI18nContext = {
    t: (key, params) => helpers().t(key, params),
    tn: (key, count, params) => helpers().tn(key, count, params),
    rich: (key, params) => helpers().rich(key, params),
    formatDateTime: (value, options) => helpers().formatDateTime(value, options),
    formatRelativeTime: (value) => helpers().formatRelativeTime(value),
    formatNumber: (value, options) => helpers().formatNumber(value, options),
    snapshot,
    locale: () => snapshot().resolved_locale,
    localePreference: () => snapshot().preference,
    source,
    setLocalePreference,
  };

  return (
    <EnvAppI18nSolidContext.Provider value={value}>
      {props.children}
    </EnvAppI18nSolidContext.Provider>
  );
}

export function useI18n(): EnvAppI18nContext {
  return useContext(EnvAppI18nSolidContext) ?? fallbackContext();
}
