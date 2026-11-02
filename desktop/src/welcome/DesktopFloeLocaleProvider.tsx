import { LocaleProvider, type FloeLocale } from '@floegence/floe-webapp-core';
import type { ParentProps } from 'solid-js';
import { getDesktopDictionary, REDEVEN_LOCALE_META, type RedevenLocale } from '../shared/i18n';

/** Keep shared control messages reactive without remounting the launcher. */
export function DesktopFloeLocaleProvider(props: ParentProps<{ locale: RedevenLocale }>) {
  const locale: FloeLocale = {
    get locale() { return props.locale; },
    get direction() { return REDEVEN_LOCALE_META[props.locale].direction; },
    get messages() { return getDesktopDictionary(props.locale).floeControls; },
  };
  return <LocaleProvider value={locale}>{props.children}</LocaleProvider>;
}
