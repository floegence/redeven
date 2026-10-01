import { expect, it } from 'vitest';
import { buildFilePreviewDownloadCommand } from './downloadCommands';
import { createRuntimeDownloadSource } from './runtimeDownloadSource';
import { describeFilePreview } from '../utils/filePreview';

it('downloads the current HTML draft as HTML instead of the older runtime file', async () => {
  const text = '<!doctype html><h1>Edited report</h1>';
  const command = buildFilePreviewDownloadCommand({
    item: { id: 'html', path: '/workspace/report.html', name: 'report.html', type: 'file' },
    descriptor: describeFilePreview('report.html'), dirty: true, draftText: text, origin: 'file_preview',
  })!;
  expect(command.source).toMatchObject({ kind: 'draft_text', text, mime: 'text/html' });
  const source = createRuntimeDownloadSource(() => undefined);
  const stream = await source.open(command, new AbortController().signal);
  const chunks = [];
  for await (const chunk of stream.chunks) chunks.push(...chunk);
  expect(new TextDecoder().decode(new Uint8Array(chunks))).toBe(text);
});

it('exports a PDF draft byte-for-byte without requiring a runtime connection', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 128]);
  const command = buildFilePreviewDownloadCommand({
    item: { id: 'pdf', path: '/workspace/report.pdf', name: 'report.pdf', type: 'file' },
    descriptor: { mode: 'pdf' }, dirty: true, draftText: '', pdfDraftBytes: bytes, origin: 'file_preview',
  })!;
  expect(command.source.kind).toBe('pdf_draft');
  const source = createRuntimeDownloadSource(() => undefined);
  const controller = new AbortController();
  const stream = await source.open(command, controller.signal);
  expect(stream.totalBytes).toBe(bytes.length);
  const chunks = [];
  for await (const chunk of stream.chunks) chunks.push(...chunk);
  expect(chunks).toEqual([...bytes]);
  controller.abort();
  const canceled = await source.open(command, controller.signal);
  await expect(canceled.chunks[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: 'AbortError' });
});
