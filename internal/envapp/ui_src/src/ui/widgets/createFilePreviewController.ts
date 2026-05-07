import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { Client } from '@floegence/flowersec-core';
import type { JsonFrameChannel } from '@floegence/flowersec-core/streamio';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import {
  getRedevenFilePreviewOversizedMessage,
  getRedevenFilePreviewReadPlan,
} from '../file-preview/readPlan';
import {
  describeFilePreview,
  FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
  getExtDot,
  isLikelyTextContent,
  mimeFromExtDot,
  type FilePreviewDescriptor,
} from '../utils/filePreview';
import { openReadFileStreamChannel, readFileBytesOnce } from '../utils/fileStreamReader';
import { getFilePreviewBlockReason } from './FileBrowserShared';

type PendingPreviewAction =
  | { type: 'close' }
  | { type: 'open'; item: FileItem }
  | null;

function emptyBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(0));
}

function encodeUtf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return String(error.message || '').trim();
  return String(error ?? '').trim();
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
  descriptor: Accessor<FilePreviewDescriptor>;
  text: Accessor<string>;
  draftText: Accessor<string>;
  editing: Accessor<boolean>;
  dirty: Accessor<boolean>;
  saving: Accessor<boolean>;
  saveError: Accessor<string | null>;
  selectedText: Accessor<string>;
  canEdit: Accessor<boolean>;
  closeConfirmOpen: Accessor<boolean>;
  closeConfirmMessage: Accessor<string>;
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
  cancelPendingAction: () => void;
  confirmDiscardAndContinue: () => Promise<void>;
  beginEditing: () => void;
  updateDraft: (value: string) => void;
  updateSelection: (selectionText: string) => void;
  saveCurrent: () => Promise<boolean>;
  revertCurrent: () => void;
  downloadCurrent: () => Promise<void>;
}

export function createFilePreviewController(params: {
  client: Accessor<Client | null | undefined>;
  rpc: Accessor<RedevenV1Rpc | null | undefined>;
  canWrite: Accessor<boolean>;
  onSaved?: (path: string) => void;
  onSaveError?: (path: string, message: string) => void;
}): FilePreviewController {
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewItem, setPreviewItem] = createSignal<FileItem | null>(null);
  const [previewDescriptor, setPreviewDescriptor] = createSignal<FilePreviewDescriptor>(FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR);
  const [previewText, setPreviewText] = createSignal('');
  const [previewDraftText, setPreviewDraftText] = createSignal('');
  const [previewEditing, setPreviewEditing] = createSignal(false);
  const [previewDirty, setPreviewDirty] = createSignal(false);
  const [previewSaving, setPreviewSaving] = createSignal(false);
  const [previewSaveError, setPreviewSaveError] = createSignal<string | null>(null);
  const [previewSelectedText, setPreviewSelectedText] = createSignal('');
  const [closeConfirmOpen, setCloseConfirmOpen] = createSignal(false);
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
  let saveReqSeq = 0;
  let pendingAction: PendingPreviewAction = null;

  const resetEditorState = (value = '') => {
    setPreviewDraftText(value);
    setPreviewEditing(false);
    setPreviewDirty(false);
    setPreviewSaving(false);
    setPreviewSaveError(null);
    setPreviewSelectedText('');
  };

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
    resetEditorState();
  };

  const clearPendingAction = () => {
    pendingAction = null;
    setCloseConfirmOpen(false);
  };

  const forceClosePreview = () => {
    previewReqSeq += 1;
    saveReqSeq += 1;
    clearPendingAction();
    cleanupPreviewContent();
    setPreviewItem(null);
    setPreviewOpen(false);
    setDownloadLoading(false);
  };

  const hasUnsavedChanges = () => previewOpen() && previewDescriptor().mode === 'text' && previewDirty();

  const canEdit = () => (
    Boolean(
      params.canWrite()
      && previewItem()?.type === 'file'
      && previewDescriptor().mode === 'text'
      && !previewLoading()
      && !previewError()
      && !previewTruncated(),
    )
  );

  const closeConfirmMessage = () => {
    const currentName = previewItem()?.name ?? 'this file';
    if (pendingAction?.type === 'open') {
      return `Discard unsaved changes in ${currentName} and open ${pendingAction.item.name}?`;
    }
    return `Discard unsaved changes in ${currentName} and close the preview?`;
  };

  const queuePendingAction = (action: Exclude<PendingPreviewAction, null>) => {
    pendingAction = action;
    setCloseConfirmOpen(true);
  };

  const loadPreview = async (item: FileItem) => {
    const blockedReason = getFilePreviewBlockReason(item);
    if (blockedReason) {
      clearPendingAction();
      cleanupPreviewContent();
      setPreviewItem(item);
      setPreviewOpen(true);
      setPreviewDescriptor({ mode: 'unsupported' });
      setPreviewError(blockedReason);
      setPreviewMessage(blockedReason);
      return;
    }
    if (item.type !== 'file') return;

    const seq = (previewReqSeq += 1);
    saveReqSeq += 1;
    clearPendingAction();
    cleanupPreviewContent();
    setPreviewItem(item);
    setPreviewOpen(true);
    setPreviewLoading(true);

    const baseDescriptor = describeFilePreview(item.name);
    setPreviewDescriptor(baseDescriptor);

    const client = params.client();
    if (!client) {
      setPreviewLoading(false);
      setPreviewError('Connection is not ready.');
      return;
    }

    const fileSize = typeof item.size === 'number' ? item.size : undefined;
    const readPlan = getRedevenFilePreviewReadPlan(baseDescriptor);
    if (fileSize != null && readPlan.rejectOversizedBeforeRead && fileSize > readPlan.maxBytes) {
      setPreviewDescriptor({ mode: 'unsupported' });
      setPreviewMessage(readPlan.oversizedMessage);
      setPreviewLoading(false);
      return;
    }

    try {
      const wantBytes = readPlan.readBytes;
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

        truncated = Boolean(meta.truncated);
        setPreviewBytes(bytes);
        setPreviewTruncated(truncated);

        const extDot = getExtDot(item.name);
        mime = mimeFromExtDot(extDot) ?? 'application/octet-stream';

        if (baseDescriptor.mode === 'text') {
          const decodedText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          setPreviewText(decodedText);
          resetEditorState(decodedText);
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

      if (baseDescriptor.mode === 'image') {
        if (truncated) {
          setPreviewDescriptor({ mode: 'unsupported' });
          setPreviewMessage(getRedevenFilePreviewOversizedMessage('image'));
          return;
        }

        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        activeObjectUrl = url;
        setPreviewObjectUrl(url);
        return;
      }

      if (baseDescriptor.mode === 'pdf') {
        if (truncated) {
          setPreviewDescriptor({ mode: 'unsupported' });
          setPreviewMessage(getRedevenFilePreviewOversizedMessage('pdf'));
        }
        return;
      }

      if (baseDescriptor.mode === 'docx') {
        if (truncated) {
          setPreviewDescriptor({ mode: 'unsupported' });
          setPreviewMessage(getRedevenFilePreviewOversizedMessage('docx'));
        }
        return;
      }

      if (baseDescriptor.mode === 'xlsx') {
        if (truncated) {
          setPreviewDescriptor({ mode: 'unsupported' });
          setPreviewMessage(getRedevenFilePreviewOversizedMessage('xlsx'));
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
          setPreviewDescriptor({ mode: 'unsupported' });
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

      if (baseDescriptor.mode === 'binary') {
        if (isLikelyTextContent(bytes)) {
          const decodedText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          setPreviewDescriptor(FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR);
          setPreviewText(decodedText);
          resetEditorState(decodedText);
          if (truncated) {
            setPreviewMessage('Showing partial content (truncated).');
          }
          return;
        }

        setPreviewMessage('Preview is not available for this file type.');
      }
    } catch (error) {
      if (seq !== previewReqSeq) return;
      setPreviewError(getErrorMessage(error) || 'Failed to load file.');
      setPreviewDescriptor({ mode: 'unsupported' });
      setPreviewMessage('Failed to load file.');
    } finally {
      if (seq === previewReqSeq) {
        setPreviewLoading(false);
      }
    }
  };

  const openPreview = async (item: FileItem) => {
    if (item.type !== 'file') return;
    if (hasUnsavedChanges()) {
      queuePendingAction({ type: 'open', item });
      return;
    }
    await loadPreview(item);
  };

  const closePreview = () => {
    if (!previewOpen()) return;
    if (hasUnsavedChanges()) {
      queuePendingAction({ type: 'close' });
      return;
    }
    forceClosePreview();
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setPreviewOpen(true);
      return;
    }
    closePreview();
  };

  const cancelPendingAction = () => {
    clearPendingAction();
  };

  const confirmDiscardAndContinue = async () => {
    const action = pendingAction;
    clearPendingAction();
    if (!action) return;

    if (action.type === 'close') {
      forceClosePreview();
      return;
    }

    await loadPreview(action.item);
  };

  const beginEditing = () => {
    if (!canEdit()) return;
    setPreviewEditing(true);
    setPreviewSaveError(null);
  };

  const updateDraft = (value: string) => {
    if (previewDescriptor().mode !== 'text') return;
    setPreviewDraftText(value);
    setPreviewDirty(value !== previewText());
    if (previewSaveError()) {
      setPreviewSaveError(null);
    }
  };

  const updateSelection = (selectionText: string) => {
    setPreviewSelectedText(String(selectionText ?? '').trim());
  };

  const saveCurrent = async (): Promise<boolean> => {
    if (!canEdit() || !previewDirty() || previewSaving()) return false;

    const rpc = params.rpc();
    const item = previewItem();
    if (!rpc || !item || previewDescriptor().mode !== 'text') return false;

    const content = previewDraftText();
    const requestSeq = ++saveReqSeq;
    setPreviewSaving(true);
    setPreviewSaveError(null);

    try {
      await rpc.fs.writeFile({
        path: item.path,
        content,
        encoding: 'utf8',
        createDirs: false,
      });

      if (requestSeq !== saveReqSeq || previewItem()?.path !== item.path) return false;

      setPreviewText(content);
      setPreviewDraftText(content);
      setPreviewBytes(encodeUtf8Bytes(content));
      setPreviewTruncated(false);
      setPreviewDirty(false);
      setPreviewSaveError(null);
      params.onSaved?.(item.path);
      return true;
    } catch (error) {
      if (requestSeq !== saveReqSeq) return false;
      const message = getErrorMessage(error) || 'Failed to save file.';
      setPreviewSaveError(message);
      params.onSaveError?.(item.path, message);
      return false;
    } finally {
      if (requestSeq === saveReqSeq) {
        setPreviewSaving(false);
      }
    }
  };

  const revertCurrent = () => {
    if (previewDescriptor().mode !== 'text') return;
    resetEditorState(previewText());
  };

  const downloadCurrent = async () => {
    const client = params.client();
    const item = previewItem();
    if (!client || !item || downloadLoading()) return;

    setDownloadLoading(true);
    try {
      if (previewDescriptor().mode === 'text' && previewDirty()) {
        const mime = mimeFromExtDot(getExtDot(item.name)) ?? 'text/plain;charset=utf-8';
        downloadBlob({ name: item.name, blob: new Blob([previewDraftText()], { type: mime }) });
        return;
      }

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

  onCleanup(() => {
    forceClosePreview();
  });

  return {
    open: previewOpen,
    item: previewItem,
    descriptor: previewDescriptor,
    text: previewText,
    draftText: previewDraftText,
    editing: previewEditing,
    dirty: previewDirty,
    saving: previewSaving,
    saveError: previewSaveError,
    selectedText: previewSelectedText,
    canEdit,
    closeConfirmOpen,
    closeConfirmMessage,
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
    cancelPendingAction,
    confirmDiscardAndContinue,
    beginEditing,
    updateDraft,
    updateSelection,
    saveCurrent,
    revertCurrent,
    downloadCurrent,
  };
}
