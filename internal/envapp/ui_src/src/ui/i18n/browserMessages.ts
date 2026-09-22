import { englishMessages, type BrowserMessageKey, type BrowserMessages } from '@floegence/floebrowser/viewer';
import type { I18nHelpers } from './createI18n';
import type { EnvAppTranslationKey } from './locales';

// Use the released engine's key set, with every value explicitly maintained in
// Redeven's complete locale catalogs. Interpolation remains owned by the engine.
export function browserMessages(i18n: I18nHelpers): BrowserMessages {
  return Object.fromEntries((Object.keys(englishMessages) as BrowserMessageKey[]).map(key => [key, i18n.t(`browserEngine.${key}` as EnvAppTranslationKey)])) as BrowserMessages;
}
