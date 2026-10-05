import deDE from './locales/de-DE.json';
import esES from './locales/es-ES.json';
import frFR from './locales/fr-FR.json';
import jaJP from './locales/ja-JP.json';
import koKR from './locales/ko-KR.json';
import ptBR from './locales/pt-BR.json';
import ruRU from './locales/ru-RU.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import enUS from './locales/en-US.json';
import type { TessivenText } from './types';
export type TessivenMessages = { [K in keyof typeof enUS]: string };
const catalogs: Record<string, TessivenMessages> = {
  'en-US': enUS,
  'de-DE': deDE,
  'es-ES': esES,
  'fr-FR': frFR,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};
export function tessivenText(locale: string): TessivenText {
  const catalog = catalogs[locale] ?? enUS;
  return (key, values) => {
    const template = catalog[key as keyof TessivenMessages];
    if (template === undefined)
      throw new Error(`Unknown Tessiven message: ${key}`);
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      values?.[name] === undefined ? match : String(values[name]),
    );
  };
}
