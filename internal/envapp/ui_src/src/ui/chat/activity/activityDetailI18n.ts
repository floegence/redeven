import type { I18nHelpers } from '../../i18n';
import type { TranslationParams } from '../../i18n/dictionaryTypes';
import type { EnvAppTranslationKey } from '../../i18n/locales';
import type {
  ActivityDetailChip,
  ActivityDetailLocalizedText,
} from './activityDetailTypes';

type ActivityDetailTextSource = ActivityDetailLocalizedText & Readonly<{
  title?: string;
  titleKey?: EnvAppTranslationKey;
  titleParams?: TranslationParams;
}>;

export function localizedActivityText(
  i18n: I18nHelpers,
  source: ActivityDetailTextSource,
  fallback = '',
): string {
  const labelKey = source.labelKey ?? source.titleKey;
  const labelParams = source.labelParams ?? source.titleParams;
  if (labelKey) {
    return typeof source.labelCount === 'number'
      ? i18n.tn(labelKey, source.labelCount, labelParams)
      : i18n.t(labelKey, labelParams);
  }
  return source.label ?? source.title ?? fallback;
}

export function localizedActivityValue(
  i18n: I18nHelpers,
  source: Pick<ActivityDetailChip, 'value' | 'valueKey' | 'valueParams' | 'valueCount'>,
  fallback = '',
): string {
  if (source.valueKey) {
    return typeof source.valueCount === 'number'
      ? i18n.tn(source.valueKey, source.valueCount, source.valueParams)
      : i18n.t(source.valueKey, source.valueParams);
  }
  return source.value ?? fallback;
}
