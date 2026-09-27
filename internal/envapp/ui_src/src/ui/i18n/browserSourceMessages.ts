import { localizedComputerCopy } from '../../../../../flower_ui/src/computerUseCopy';
import type { EnvAppI18nContext, EnvAppTranslationKey } from './index';

const keys = ['recommended', 'previouslyUsed', 'moreActions', 'openWindow', 'windowUnavailable', 'windowBlocked', 'defaultProfile', 'sources', 'sourceHint', 'openSelection', 'managedSource', 'profileName', 'createProfile', 'chromeSource', 'profile', 'searchPages', 'noPages', 'selectionHint', 'installTitle', 'installOpen', 'recoverTitle', 'recover', 'recoveryDescription', 'sourceUnavailable', 'disconnected', 'openFailed', 'openTimeout', 'recoveryBlocked', 'outcomeUnknown', 'retry'] as const;
export function browserSourceMessages(i18n: Pick<EnvAppI18nContext, 't'>) {
  return {
    product: Object.fromEntries(keys.map(key => [key, i18n.t(`browserProduct.${key}`)])) as Record<typeof keys[number], string>,
    computer: { ...localizedComputerCopy(key => i18n.t(key as EnvAppTranslationKey)),
      setupConfirmHint: i18n.t('browserProduct.chromeConfirmHint'), pairingConfirmHint: i18n.t('browserProduct.chromeConfirmHint'),
      setupConnected: i18n.t('flowerSurface.computer.connected'), chromeContinueFailed: i18n.t('shell.notifications.remoteBrowserUnavailable'),
    },
  };
}
export type BrowserSourceMessages = ReturnType<typeof browserSourceMessages>;
