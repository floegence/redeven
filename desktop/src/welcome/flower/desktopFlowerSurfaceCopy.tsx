import {
  createLocalizedFlowerSurfaceCopy,
  type FlowerSurfaceTranslator,
} from '../../../../internal/flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { DesktopI18n, DesktopPluralTranslationKey, DesktopTranslationKey } from '../../shared/i18n';

export function createDesktopFlowerSurfaceCopy(i18n: DesktopI18n) {
  const translator: FlowerSurfaceTranslator = {
    locale: i18n.locale,
    t: (key, params) => i18n.t(key as DesktopTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as DesktopPluralTranslationKey, count, params),
  };
  return createLocalizedFlowerSurfaceCopy(translator);
}
