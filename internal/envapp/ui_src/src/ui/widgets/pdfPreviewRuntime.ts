import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerURL from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api';

let workerConfigured = false;

function ensurePDFWorkerConfigured() {
  if (workerConfigured) return;
  GlobalWorkerOptions.workerSrc = workerURL;
  workerConfigured = true;
}

export function loadPDFDocument(bytes: Uint8Array<ArrayBuffer>): PDFDocumentLoadingTask {
  ensurePDFWorkerConfigured();
  return getDocument({
    data: bytes,
  });
}

export function isPDFRenderCancelled(error: unknown): boolean {
  const name = String((error as { name?: unknown } | null | undefined)?.name ?? '').trim();
  if (name === 'RenderingCancelledException') return true;
  return /rendering cancelled/i.test(String(error ?? ''));
}

export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
};
