import { Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount, useContext, type Accessor, type JSX } from 'solid-js';

import { createI18nHelpers, type I18nHelpers } from './createI18n';
import { desktopLanguageBridge, fallbackLanguageSnapshot } from './desktopLanguageBridge';
import { enUS, loadEnvAppDictionary, type EnvAppTranslationShape } from './locales';
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
  setLocalePreference: (preference: RedevenLocalePreference) => Promise<void>;
}>;

const EnvAppI18nSolidContext = createContext<EnvAppI18nContext>();

function standaloneSnapshot(preference: RedevenLocalePreference = readStoredLanguagePreference()): RedevenLanguageSnapshot {
  return fallbackLanguageSnapshot(preference, readStandaloneSystemLanguageCandidates());
}

function fallbackContext(): EnvAppI18nContext {
  const snapshot = () => standaloneSnapshot(SYSTEM_LOCALE_PREFERENCE);
  const helpers = createI18nHelpers(DEFAULT_LOCALE, enUS);
  return {
    ...helpers,
    snapshot,
    locale: () => DEFAULT_LOCALE,
    localePreference: () => SYSTEM_LOCALE_PREFERENCE,
    source: () => 'browser',
    setLocalePreference: async () => undefined,
  };
}

type LoadedI18nState = Readonly<{
  snapshot: RedevenLanguageSnapshot;
  dictionary: EnvAppTranslationShape;
}>;

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
  const initialSnapshot = bridge?.getSnapshot() ?? standaloneSnapshot();
  const [source, setSource] = createSignal<EnvAppLanguageSource>(bridge ? 'desktop' : 'browser');
  const [loadedState, setLoadedState] = createSignal<LoadedI18nState | null>(
    initialSnapshot.resolved_locale === DEFAULT_LOCALE
      ? { snapshot: initialSnapshot, dictionary: enUS }
      : null,
  );
  let activationRequest = 0;
  const snapshot = (): RedevenLanguageSnapshot => loadedState()?.snapshot ?? initialSnapshot;
  const helpers = createMemo(() => {
    const state = loadedState();
    return createI18nHelpers(
      state?.snapshot.resolved_locale ?? DEFAULT_LOCALE,
      state?.dictionary ?? enUS,
    );
  });

  const activateSnapshot = async (
    nextSnapshot: RedevenLanguageSnapshot,
    nextSource: EnvAppLanguageSource,
  ): Promise<void> => {
    const request = ++activationRequest;
    try {
      const dictionary = await loadEnvAppDictionary(nextSnapshot.resolved_locale);
      if (request !== activationRequest) {
        return;
      }
      setSource(nextSource);
      setLoadedState({ snapshot: nextSnapshot, dictionary });
    } catch (error) {
      if (request !== activationRequest) {
        return;
      }
      console.error(`Failed to load Env App locale ${nextSnapshot.resolved_locale}; using en-US.`, error);
      setSource(nextSource);
      setLoadedState({
        snapshot: {
          ...nextSnapshot,
          resolved_locale: DEFAULT_LOCALE,
          source: 'fallback',
        },
        dictionary: enUS,
      });
    }
  };

  const setLocalePreference = async (preference: RedevenLocalePreference): Promise<void> => {
    const normalized = normalizeLocalePreference(preference);
    const activeBridge = desktopLanguageBridge();
    if (activeBridge) {
      await activateSnapshot(activeBridge.setPreference(normalized), 'desktop');
      return;
    }

    writeStoredLanguagePreference(normalized);
    await activateSnapshot(standaloneSnapshot(normalized), 'browser');
  };

  onMount(() => {
    const activeBridge = desktopLanguageBridge();
    if (activeBridge) {
      void activateSnapshot(activeBridge.getSnapshot(), 'desktop');
      const unsubscribe = activeBridge.subscribe((next) => {
        void activateSnapshot(next, 'desktop');
      });
      onCleanup(unsubscribe);
      return;
    }

    if (!loadedState()) {
      void activateSnapshot(initialSnapshot, 'browser');
    }

    const handleLanguageChange = () => {
      if (snapshot().preference === SYSTEM_LOCALE_PREFERENCE) {
        void activateSnapshot(standaloneSnapshot(SYSTEM_LOCALE_PREFERENCE), 'browser');
      }
    };
    window.addEventListener('languagechange', handleLanguageChange);
    onCleanup(() => window.removeEventListener('languagechange', handleLanguageChange));
  });

  createEffect(() => {
    const state = loadedState();
    if (state) {
      applyDocumentLanguage(state.snapshot, helpers());
    }
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
      <Show when={loadedState()}>{props.children}</Show>
    </EnvAppI18nSolidContext.Provider>
  );
}

export function useI18n(): EnvAppI18nContext {
  return useContext(EnvAppI18nSolidContext) ?? fallbackContext();
}
