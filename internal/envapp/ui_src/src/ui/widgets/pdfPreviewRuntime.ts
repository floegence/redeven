import { openPdfDocument } from '@floegence/floe-webapp-core/pdf';
import pdfAssetsUrl from 'virtual:floe-pdf-assets';

export { pdfAssetsUrl };
export type { PDFDocumentProxy } from '@floegence/floe-webapp-core/pdf';

export function loadPDFDocument(bytes: Uint8Array<ArrayBuffer>) {
  return openPdfDocument(bytes, pdfAssetsUrl);
}
