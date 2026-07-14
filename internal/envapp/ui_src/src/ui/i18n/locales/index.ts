import type { RedevenLocale } from '../localeMeta';
import { enUS, type EnvAppTranslationShape } from './en-US';

export { enUS } from './en-US';
export type { EnvAppTranslationKey, EnvAppTranslationShape } from './en-US';

type LocalizedEnvAppLocale = Exclude<RedevenLocale, 'en-US'>;
type EnvAppCatalogModule = Readonly<{ default: unknown }>;

const catalogLoaders: Readonly<Record<LocalizedEnvAppLocale, () => Promise<EnvAppCatalogModule>>> = {
  'zh-CN': () => import('./catalogs/zh-CN.json'),
  'zh-TW': () => import('./catalogs/zh-TW.json'),
  'ja-JP': () => import('./catalogs/ja-JP.json'),
  'ko-KR': () => import('./catalogs/ko-KR.json'),
  'de-DE': () => import('./catalogs/de-DE.json'),
  'fr-FR': () => import('./catalogs/fr-FR.json'),
  'es-ES': () => import('./catalogs/es-ES.json'),
  'pt-BR': () => import('./catalogs/pt-BR.json'),
  'ru-RU': () => import('./catalogs/ru-RU.json'),
};

const loadedDictionaries: Partial<Record<RedevenLocale, EnvAppTranslationShape>> = {
  'en-US': enUS,
};

export function getLoadedEnvAppDictionary(locale: RedevenLocale): EnvAppTranslationShape | undefined {
  return loadedDictionaries[locale];
}

export function getLoadedEnvAppDictionaries(): readonly Readonly<{
  locale: RedevenLocale;
  dictionary: EnvAppTranslationShape;
}>[] {
  return Object.entries(loadedDictionaries).flatMap(([locale, dictionary]) => (
    dictionary
      ? [{ locale: locale as RedevenLocale, dictionary }]
      : []
  ));
}

export async function loadEnvAppDictionary(locale: RedevenLocale): Promise<EnvAppTranslationShape> {
  const loaded = getLoadedEnvAppDictionary(locale);
  if (loaded) {
    return loaded;
  }

  const module = await catalogLoaders[locale as LocalizedEnvAppLocale]();
  const dictionary = module.default as EnvAppTranslationShape;
  loadedDictionaries[locale] = dictionary;
  return dictionary;
}
