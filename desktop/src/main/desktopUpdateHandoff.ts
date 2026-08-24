import type { MessageBoxOptions } from 'electron';

import type { DesktopI18n } from '../shared/i18n/desktopI18n';

export function buildDesktopUpdateHandoffMessageBoxOptions(i18n: DesktopI18n): MessageBoxOptions {
  return {
    type: 'info',
    buttons: [i18n.t('desktopUpdateHandoff.openReleasePage'), i18n.t('desktopUpdateHandoff.later')],
    defaultId: 0,
    cancelId: 1,
    title: i18n.t('desktopUpdateHandoff.title'),
    message: i18n.t('desktopUpdateHandoff.restartMessage'),
    detail: i18n.t('desktopUpdateHandoff.interruptionDetail'),
  };
}
