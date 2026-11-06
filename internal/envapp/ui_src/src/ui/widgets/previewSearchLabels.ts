import type { TextSearchLabels } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';

export function usePreviewSearchLabels(): TextSearchLabels {
  const i18n = useI18n();
  return {
    get find() { return i18n.t('filePreview.findInFile'); },
    get previous() { return i18n.t('filePreview.pdf.previous'); },
    get next() { return i18n.t('filePreview.pdf.next'); },
    get close() { return i18n.t('common.actions.close'); },
    get noMatches() { return i18n.t('filePreview.pdf.noMatches'); },
    matches: (current, total) => i18n.t('filePreview.pdf.matches', { current, total }),
  };
}
