import { createSignal, onCleanup, type Accessor } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { Client } from '@floegence/flowersec-core';
import type { JsonFrameChannel } from '@floegence/flowersec-core/streamio';
import { getExtDot, isLikelyTextContent, mimeFromExtDot, previewModeByName, type PreviewMode } from '../utils/filePreview';
import { readFileBytesOnce, openReadFileStreamChannel } from '../utils/fileStreamReader';

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;

function emptyBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(0));
}

function downloadBlob(params: { name: string; blob: Blob }) {
  const url = URL.createObjectURL(params.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = params.name || 'download';
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface FilePreviewController {
  open: Accessor<boolean>;
  item: Accessor<FileItem | null>;
  mode: Accessor<PreviewMode>;
  text: Accessor<string>;
  message: Accessor<string>;
  objectUrl: Accessor<string>;
  bytes: Accessor<Uint8Array<ArrayBuffer> | null>;
  truncated: Accessor<boolean>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  xlsxSheetName: Accessor<string>;
  xlsxRows: Accessor<string[][]>;
  downloadLoading: Accessor<boolean>;
  openPreview: (item: FileItem) => Promise<void>;
  closePreview: () => void;
  handleOpenChange: (open: boolean) => void;
  downloadCurrent: () => Promise<void>;
}

export function createFilePreviewController(params: {
  client: Accessor<Client | null | undefined>;
}): FilePreviewController {
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewItem, setPreviewItem] = createSignal<FileItem | null>(null);
  const [previewMode, setPreviewMode] = createSignal<PreviewMode>('text');
  const [previewText, setPreviewText] = createSignal('');
  const [previewMessage, setPreviewMessage] = createSignal('');
  const [previewObjectUrl, setPreviewObjectUrl] = createSignal('');
  const [previewBytes, setPreviewBytes] = createSignal<Uint8Array<ArrayBuffer> | null>(null);
  const [previewTruncated, setPreviewTruncated] = createSignal(false);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [xlsxSheetName, setXlsxSheetName] = createSignal('');
  const [xlsxRows, setXlsxRows] = createSignal<string[][]>([]);
  const [downloadLoading, setDownloadLoading] = createSignal(false);

  let activePreviewChannel: JsonFrameChannel | null = null;
  let activeObjectUrl: string | null = null;
  let previewReqSeq = 0;

  const cleanupPreviewContent = () => {
    if (activePreviewChannel) {
      try {
        activePreviewChannel.stream.reset(new Error('canceled'));
      } catch {
      }
      try {
        void activePreviewChannel.close();
      } catch {
      }
      activePreviewChannel = null;
    }

    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {
      }
      activeObjectUrl = null;
    }

    setPreviewObjectUrl('');
    setPreviewBytes(null);
    setPreviewText('');
    setPreviewMessage('');
    setPreviewTruncated(false);
    setPreviewError(null);
    setXlsxRows([]);
    setXlsxSheetName('');
    setPreviewLoading(false);
  };

  const closePreview = () => {
    previewReqSeq += 1;
    cleanupPreviewContent();
    setPreviewItem(null);
    setPreviewOpen(false);
    setDownloadLoading(false);
  };

  onCleanup(() => {
    closePreview();
  });

  const openPreview = async (item: FileItem) => {
    if (item.type !== 'file') return;

    const seq = (previewReqSeq += 1);
    cleanupPreviewContent();
    setPreviewItem(item);
    setPreviewOpen(true);
    setPreviewLoading(true);

    const baseMode = previewModeByName(item.name);
    setPreviewMode(baseMode);

    const client = params.client();
    if (!client) {
      setPreviewLoading(false);
      setPreviewError('Connection is not ready.');
      return;
    }

    const fileSize = typeof item.size === 'number' ? item.size : undefined;
    const maxBytes = baseMode === 'text' ? MAX_TEXT_PREVIEW_BYTES : MAX_PREVIEW_BYTES;
    if (fileSize != null && fileSize > maxBytes && baseMode !== 'text') {
      setPreviewMode('unsupported');
      setPreviewMessage('This file is too large to preview.');
      setPreviewLoading(false);
      return;
    }

    try {
      const wantBytes = baseMode === 'binary' ? SNIFF_BYTES : maxBytes;
      let bytes = emptyBytes();
      let truncated = false;
      let mime = 'application/octet-stream';

      const { channel, meta } = await openReadFileStreamChannel({
        client,
        path: item.path,
        offset: 0,
        maxBytes: wantBytes,
      });
      activePreviewChannel = channel;

      try {
        if (seq !== previewReqSeq) return;

        const contentLength = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
        bytes = new Uint8Array(new ArrayBuffer(contentLength));
        let offset = 0;
        while (offset < contentLength) {
          if (seq !== previewReqSeq) return;
          const take = Math.min(64 * 1024, contentLength - offset);
          const chunk = await channel.reader.readExactly(take);
          bytes.set(chunk, offset);
          offset += chunk.length;
        }

        if (seq !== previewReqSeq) return;

        truncated = !!meta.truncated;
        setPreviewBytes(bytes);
        setPreviewTruncated(truncated);

        const extDot = getExtDot(item.name);
        mime = mimeFromExtDot(extDot) ?? 'application/octet-stream';

        if (baseMode === 'text') {
          setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
          if (truncated) {
            setPreviewMessage('Showing partial content (truncated).');
          }
          return;
        }
      } finally {
        try {
          await channel.close();
        } catch {
        }
        if (activePreviewChannel === channel) {
          activePreviewChannel = null;
        }
      }

      if (baseMode === 'image' || baseMode === 'pdf') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage(baseMode === 'image' ? 'This image is too large to preview.' : 'This PDF is too large to preview.');
          return;
        }

        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        activeObjectUrl = url;
        setPreviewObjectUrl(url);
        return;
      }

      if (baseMode === 'docx') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This document is too large to preview.');
        }
        return;
      }

      if (baseMode === 'xlsx') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This spreadsheet is too large to preview.');
          return;
        }

        const module = await import('exceljs');
        if (seq !== previewReqSeq) return;

        const ExcelJS: any = module.default ?? module;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes.buffer);
        if (seq !== previewReqSeq) return;

        const worksheet = workbook.worksheets?.[0] ?? workbook.getWorksheet?.(1);
        if (!worksheet) {
          setPreviewMode('unsupported');
          setPreviewMessage('No worksheet found in this file.');
          return;
        }

        const cellToText = (value: unknown): string => {
          if (value == null) return '';
          if (typeof value === 'string') return value;
          if (typeof value === 'number') return String(value);
          if (typeof value === 'boolean') return value ? 'true' : 'false';
          if (value instanceof Date) return value.toISOString();
          if (typeof value === 'object') {
            const maybeCell = value as any;
            if (typeof maybeCell.text === 'string') return maybeCell.text;
            if (Array.isArray(maybeCell.richText)) {
              return maybeCell.richText.map((part: any) => String(part?.text ?? '')).join('');
            }
            if (maybeCell.result != null) return cellToText(maybeCell.result);
            if (typeof maybeCell.formula === 'string' && maybeCell.result != null) {
              return `${maybeCell.formula} = ${cellToText(maybeCell.result)}`;
            }
            try {
              return JSON.stringify(maybeCell);
            } catch {
              return String(maybeCell);
            }
          }
          return String(value);
        };

        const rows: string[][] = [];
        const maxRows = 200;
        const maxCols = 50;
        const rowCount = typeof worksheet.rowCount === 'number' ? worksheet.rowCount : 0;
        const takeRows = Math.min(rowCount || maxRows, maxRows);

        for (let rowIndex = 1; rowIndex <= takeRows; rowIndex += 1) {
          const row = worksheet.getRow?.(rowIndex);
          if (!row) continue;
          const nextRow: string[] = [];
          for (let colIndex = 1; colIndex <= maxCols; colIndex += 1) {
            const cell = row.getCell?.(colIndex);
            nextRow.push(cellToText(cell?.value));
          }
          rows.push(nextRow);
        }

        setXlsxSheetName(String(worksheet.name ?? 'Sheet1'));
        setXlsxRows(rows);
        return;
      }

      if (baseMode === 'binary') {
        if (isLikelyTextContent(bytes)) {
          setPreviewMode('text');
          setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
          if (truncated) {
            setPreviewMessage('Showing partial content (truncated).');
          }
          return;
        }

        setPreviewMessage('Preview is not available for this file type.');
      }
    } catch (error) {
      if (seq !== previewReqSeq) return;
      setPreviewError(error instanceof Error ? error.message : String(error));
      setPreviewMode('unsupported');
      setPreviewMessage('Failed to load file.');
    } finally {
      if (seq === previewReqSeq) {
        setPreviewLoading(false);
      }
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setPreviewOpen(true);
      return;
    }
    closePreview();
  };

  const downloadCurrent = async () => {
    const client = params.client();
    const item = previewItem();
    if (!client || !item || downloadLoading()) return;

    setDownloadLoading(true);
    try {
      const cached = previewBytes();
      const truncated = previewTruncated();
      if (cached && !truncated) {
        const mime = mimeFromExtDot(getExtDot(item.name)) ?? 'application/octet-stream';
        downloadBlob({ name: item.name, blob: new Blob([cached], { type: mime }) });
        return;
      }

      const size = typeof item.size === 'number' ? item.size : undefined;
      const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: size ?? 0 });
      const mime = mimeFromExtDot(getExtDot(item.name)) ?? 'application/octet-stream';
      downloadBlob({ name: item.name, blob: new Blob([bytes], { type: mime }) });
    } finally {
      setDownloadLoading(false);
    }
  };

  return {
    open: previewOpen,
    item: previewItem,
    mode: previewMode,
    text: previewText,
    message: previewMessage,
    objectUrl: previewObjectUrl,
    bytes: previewBytes,
    truncated: previewTruncated,
    loading: previewLoading,
    error: previewError,
    xlsxSheetName,
    xlsxRows,
    downloadLoading,
    openPreview,
    closePreview,
    handleOpenChange,
    downloadCurrent,
  };
}
