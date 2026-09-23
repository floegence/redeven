import type { BrowserMessageKey, BrowserMessages } from '@floegence/floebrowser/viewer';
import type { I18nHelpers } from './createI18n';
import { enUS, type EnvAppTranslationKey } from './locales';

// Derive keys from the maintained catalog without loading the browser engine in
// the environment shell. Contract tests compare them with the released engine.
const keys = Object.entries(enUS.browserEngine).flatMap(([group, messages]) => Object.keys(messages).map(key => `${group}.${key}` as BrowserMessageKey));

// Every value is explicit in the selected locale; interpolation stays upstream.
export function browserMessages(i18n: I18nHelpers): BrowserMessages {
  return Object.fromEntries(keys.map(key => [key, i18n.t(`browserEngine.${key}` as EnvAppTranslationKey)])) as BrowserMessages;
}
