import { createContext, useContext } from 'solid-js';
import type { FlowerExtensionsAdapter } from './types';
import { skillsMessages } from './skillsMessages';
import { extensionMessages } from './messages';

export type ExtensionI18n = Readonly<{
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string;
  tn: (key: string, count: number) => string;
  dateTime: (timestamp: number) => string;
}>;
export function extensionI18n(locale = 'en-US'): ExtensionI18n {
  const key = locale as keyof typeof skillsMessages;
  const messages: Record<string, string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>> = {
    ...(skillsMessages[key] ?? skillsMessages['en-US']),
    ...(extensionMessages[key] ?? extensionMessages['en-US']),
  };
  const format = (value: string, params: Readonly<Record<string, string | number>> = {}) => value.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match));
  return {
    dateTime: timestamp => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp),
    t: (name, params) => { const value = messages[name]; return format(typeof value === 'string' ? value : value?.other ?? name, params); },
    tn: (name, count) => { const value = messages[name]; return format(typeof value === 'string' ? value : value?.[new Intl.PluralRules(locale).select(count)] ?? value?.other ?? name, { count }); },
  };
}
export const FlowerExtensionsContext = createContext<FlowerExtensionsAdapter & { i18n: ExtensionI18n }>();
export function useFlowerExtensions() {
  const context = useContext(FlowerExtensionsContext);
  if (!context) throw new Error('Flower extensions context is unavailable');
  return context;
}
