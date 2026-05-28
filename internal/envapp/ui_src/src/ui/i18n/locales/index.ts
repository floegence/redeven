import type { RedevenLocale } from '../localeMeta';
import type { EnvAppTranslationShape } from './en-US';
import { enUS } from './en-US';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { jaJP } from './ja-JP';
import { koKR } from './ko-KR';
import { deDE } from './de-DE';
import { frFR } from './fr-FR';
import { esES } from './es-ES';
import { ptBR } from './pt-BR';
import { ruRU } from './ru-RU';

export { enUS } from './en-US';
export type { EnvAppTranslationKey, EnvAppTranslationShape } from './en-US';

export const dictionaries: Readonly<Record<RedevenLocale, EnvAppTranslationShape>> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'de-DE': deDE,
  'fr-FR': frFR,
  'es-ES': esES,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
};
