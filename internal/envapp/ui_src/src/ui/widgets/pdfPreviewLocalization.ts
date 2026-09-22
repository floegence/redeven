import { PdfLocalization } from '@floegence/floe-webapp-core/pdf';
import type { EnvAppI18nContext, EnvAppTranslationKey } from '../i18n';

export function createPdfPreviewLocalization(viewer: HTMLElement, i18n: EnvAppI18nContext) {
  const labels: Record<string, EnvAppTranslationKey> = {
    'pdfjs-editor-highlight-editor': 'filePreview.pdf.highlightAnnotation',
    'pdfjs-editor-remove-highlight-button': 'filePreview.pdf.removeHighlight',
    'pdfjs-editor-colorpicker-button': 'filePreview.pdf.color',
    'pdfjs-editor-colorpicker-dropdown': 'filePreview.pdf.colors',
    'pdfjs-editor-colorpicker-yellow': 'filePreview.pdf.yellow',
  };
  return new PdfLocalization(viewer, (id, args) => {
    if (id === 'pdfjs-page-landmark') return {
      attributes: { 'aria-label': i18n.t('uiCopy.preview.pageLabel', { number: Number(args.page) }) },
    };
    if (id === 'pdfjs-annotation-date-time-string' && args.dateObj instanceof Date) return {
      text: new Intl.DateTimeFormat(i18n.locale(), { dateStyle: 'short', timeStyle: 'medium' }).format(args.dateObj),
    };
    if (id === 'pdfjs-annotation-date-string') return { text: `${args.date ?? ''} ${args.time ?? ''}`.trim() };
    const label = i18n.t(labels[id] ?? 'filePreview.pdf.annotation');
    return { attributes: { 'aria-label': label, title: label, ...(id === 'pdfjs-text-annotation-type' ? { alt: label } : {}) } };
  }, i18n.locale());
}
