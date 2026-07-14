import type { RedevenLocale } from '../localeMeta';
import { createI18nHelpers, type I18nHelpers } from '../createI18n';
import type { EnvAppTranslationShape } from './en-US';
import { enUS } from './en-US';
import deDECatalog from './catalogs/de-DE.json';
import esESCatalog from './catalogs/es-ES.json';
import frFRCatalog from './catalogs/fr-FR.json';
import jaJPCatalog from './catalogs/ja-JP.json';
import koKRCatalog from './catalogs/ko-KR.json';
import ptBRCatalog from './catalogs/pt-BR.json';
import ruRUCatalog from './catalogs/ru-RU.json';
import zhCNCatalog from './catalogs/zh-CN.json';
import zhTWCatalog from './catalogs/zh-TW.json';

export const dictionaries: Readonly<Record<RedevenLocale, EnvAppTranslationShape>> = {
  'en-US': enUS,
  'zh-CN': zhCNCatalog as EnvAppTranslationShape,
  'zh-TW': zhTWCatalog as EnvAppTranslationShape,
  'ja-JP': jaJPCatalog as EnvAppTranslationShape,
  'ko-KR': koKRCatalog as EnvAppTranslationShape,
  'de-DE': deDECatalog as EnvAppTranslationShape,
  'fr-FR': frFRCatalog as EnvAppTranslationShape,
  'es-ES': esESCatalog as EnvAppTranslationShape,
  'pt-BR': ptBRCatalog as EnvAppTranslationShape,
  'ru-RU': ruRUCatalog as EnvAppTranslationShape,
};

export { enUS } from './en-US';

export function createTestI18nHelpers(locale: RedevenLocale): I18nHelpers {
  return createI18nHelpers(locale, dictionaries[locale]);
}
