import { type Accessor, batch, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { Session } from '@floegence/flowersec-core';
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
  isTextFilePreview,
  mimeFromExtDot,
  type FilePreviewDescriptor,
} from '../utils/filePreview';
import { buildRedevenFileResourceUrl } from '../utils/filePreviewResource';
import { openReadFileStreamChannel, type ReadFileStreamChannel } from '../utils/fileStreamReader';
import { getFilePreviewBlockReason } from './FileBrowserShared';
import { createWorkspaceEffectRpc } from '../services/workspaceEffects';
import { bytesToBase64 } from '../protocol/redeven_v1/codec/base64';
import { prepareLocalApiRequestInit } from '../services/localApi';
import { classifyFilePreviewError, type FilePreviewErrorType } from './filePreviewErrorUtils';
import type { BindPdfPreviewEditor, PdfPreviewEditor } from './pdfPreviewEditor';

type PendingPreviewAction =
  | { type: 'close' }
  | { type: 'open'; item: FileItem }
  | null;

type PendingConnectionPreviewLoad = Readonly<{
  item: FileItem;
  seq: number;
}>;

const CONNECTION_WAITING_MESSAGE = 'Waiting for connection...';

function emptyBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(0));
}

function encodeUtf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message || '').trim();
  return String(error ?? '').trim();
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
  resourceUrl: Accessor<string>;
  bytes: Accessor<Uint8Array<ArrayBuffer> | null>;
  truncated: Accessor<boolean>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  errorType: Accessor<FilePreviewErrorType | undefined>;
  retry: () => Promise<void>;
  reportResourceError: (path: string, source: string) => Promise<void>;
  reportRenderError: (path: string, message?: string) => void;
  xlsxSheetName: Accessor<string>;
  xlsxRows: Accessor<string[][]>;
  openPreview: (item: FileItem) => Promise<void>;
  closePreview: () => void;
  retainContent: () => () => void;
  handleOpenChange: (open: boolean) => void;
  cancelPendingAction: () => void;
  confirmDiscardAndContinue: () => Promise<void>;
  beginEditing: () => void;
  updateDraft: (value: string) => void;
  updateSelection: (selectionText: string) => void;
  saveCurrent: () => Promise<boolean>;
  revertCurrent: () => void;
  bindPdfEditor: BindPdfPreviewEditor;
  exportPdfDraft: () => Promise<Uint8Array<ArrayBuffer>>;
}

export function createFilePreviewController(params: {
  client: Accessor<Session | null | undefined>;
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
  const [previewResourceUrl, setPreviewResourceUrl] = createSignal('');
  const [previewBytes, setPreviewBytes] = createSignal<Uint8Array<ArrayBuffer> | null>(null);
  const [previewTruncated, setPreviewTruncated] = createSignal(false);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewErrorType, setPreviewErrorType] = createSignal<FilePreviewErrorType>();
  let mediaErrorController: AbortController | undefined;
  const [xlsxSheetName, setXlsxSheetName] = createSignal('');
  const [xlsxRows, setXlsxRows] = createSignal<string[][]>([]);
  const [pendingConnectionLoad, setPendingConnectionLoad] = createSignal<PendingConnectionPreviewLoad | null>(null);

  const presentations = new Set<symbol>();
  let activePreviewChannel: ReadFileStreamChannel | null = null;
  let activeObjectUrl: string | null = null;
  let previewReqSeq = 0;
  let saveReqSeq = 0;
  let pendingAction: PendingPreviewAction = null;
  let pdfEditor: PdfPreviewEditor | null = null;
  let savedPdfBytes: Uint8Array<ArrayBuffer> | null = null;
  let pdfEditRevision = 0;

  const resetEditorState = (value = '') => {
    setPreviewDraftText(value);
    setPreviewEditing(false);
    setPreviewDirty(false);
    setPreviewSaving(false);
    setPreviewSaveError(null);
    setPreviewSelectedText('');
    pdfEditor = null;
    savedPdfBytes = null;
    pdfEditRevision++;
  };

  const cancelPreviewLoad = () => {
    mediaErrorController?.abort();
    mediaErrorController=undefined;
    if (activePreviewChannel) {
      try {
		void Promise.resolve(activePreviewChannel.stream.reset()).catch(() => undefined);
      } catch {
      }
      try {
        void Promise.resolve(activePreviewChannel.close()).catch(() => undefined);
      } catch {
      }
      activePreviewChannel = null;
    }
  };

  const cleanupPreviewContent = () => {
    cancelPreviewLoad();
    setPreviewErrorType(undefined);
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {
      }
      activeObjectUrl = null;
    }

    setPreviewObjectUrl('');
    setPreviewResourceUrl('');
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

  const releaseClosedContent = () => {
    if (previewOpen() || presentations.size > 0) return;
    batch(() => {
      cleanupPreviewContent();
      setPreviewItem(null);
    });
  };

  // The mounted preview owns its content through Floe's existing exit presence.
  const retainContent = () => {
    const presentation = Symbol();
    presentations.add(presentation);
    return () => {
      if (!presentations.delete(presentation)) return;
      releaseClosedContent();
    };
  };

  const forceClosePreview = () => {
    previewReqSeq += 1;
    saveReqSeq += 1;
    batch(() => {
      setPendingConnectionLoad(null);
      clearPendingAction();
      setPreviewOpen(false);
      cancelPreviewLoad();
      releaseClosedContent();
    });
  };

  const hasUnsavedChanges = () => previewOpen() && previewDirty();

  const canEdit = () => (
    Boolean(
      params.canWrite()
      && previewItem()?.type === 'file'
      && (isTextFilePreview(previewDescriptor()) || previewDescriptor().mode === 'pdf')
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

  const loadPreview = async (item: FileItem, retrying = false) => {
    const retainedError = retrying ? previewError() : null;
    const retainedType = retrying ? previewErrorType() : undefined;
    if (item.type !== 'file') return;

    const seq = (previewReqSeq += 1);
    saveReqSeq += 1;
    setPendingConnectionLoad(null);
    clearPendingAction();

    const blockedReason = getFilePreviewBlockReason(item);
    if (blockedReason) {
      cleanupPreviewContent();
      setPreviewItem(item);
      setPreviewOpen(true);
      setPreviewDescriptor({ mode: 'unsupported' });
      setPreviewError(blockedReason);
      setPreviewMessage(blockedReason);
      return;
    }

    batch(() => {
      cleanupPreviewContent();
      setPreviewItem(item);
      setPreviewOpen(true);
      setPreviewLoading(true);
      setPreviewError(retainedError);
      setPreviewErrorType(retainedType);
    });

    const baseDescriptor = describeFilePreview(item.name);
    setPreviewDescriptor(baseDescriptor);

    const fileSize = typeof item.size === 'number' ? item.size : undefined;
    const readPlan = getRedevenFilePreviewReadPlan(baseDescriptor);
    if (fileSize != null && readPlan.rejectOversizedBeforeRead && fileSize > readPlan.maxBytes) {
      setPreviewDescriptor({ mode: 'unsupported' });
      setPreviewMessage(readPlan.oversizedMessage);
      setPreviewError(null);
      setPreviewErrorType(undefined);
      setPreviewLoading(false);
      return;
    }

    if (readPlan.strategy === 'resource') {
      const resourceUrl = buildRedevenFileResourceUrl(item.path);
      if (!resourceUrl) {
        setPreviewDescriptor({ mode: 'unsupported' });
        setPreviewMessage('Preview is not available for this file path.');
        setPreviewLoading(false);
        return;
      }
      if (retrying) {
        const controller = new AbortController();
        mediaErrorController = controller;
        try {
          const response = await fetch(resourceUrl, await prepareLocalApiRequestInit({ method: 'HEAD', cache: 'no-store', signal: controller.signal }));
          if (!response.ok) throw Object.assign(new Error(response.statusText), { status: response.status });
          if (controller.signal.aborted || seq !== previewReqSeq) return;
        } catch (error) {
          if (controller.signal.aborted || seq !== previewReqSeq) return;
          setPreviewError(getErrorMessage(error) || 'Failed to fetch media.');
          setPreviewErrorType(classifyFilePreviewError(error));
          setPreviewLoading(false);
          return;
        } finally {
          if (mediaErrorController === controller) mediaErrorController = undefined;
        }
      }
      batch(() => {
        setPreviewResourceUrl(resourceUrl);
        setPreviewError(null);
        setPreviewErrorType(undefined);
        setPreviewLoading(false);
      });
      return;
    }

    const client = params.client();
    if (!client) {
      setPendingConnectionLoad({ item, seq });
      setPreviewError(CONNECTION_WAITING_MESSAGE);
      setPreviewErrorType('connection_error');
      setPreviewMessage(CONNECTION_WAITING_MESSAGE);
      setPreviewLoading(false);
      return;
    }

    let failed = false;
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
      if (seq === previewReqSeq) activePreviewChannel = channel;

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

        if (isTextFilePreview(baseDescriptor)) {
          if (baseDescriptor.mode === 'html' && truncated) {
            setPreviewDescriptor({ mode: 'unsupported' });
            setPreviewMessage(readPlan.oversizedMessage);
            return;
          }
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

      if (seq !== previewReqSeq) return;

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

      if (baseDescriptor.mode === 'docx' || baseDescriptor.mode === 'pptx') {
        if (truncated) {
          setPreviewDescriptor({ mode: 'unsupported' });
          setPreviewMessage(getRedevenFilePreviewOversizedMessage(baseDescriptor.mode));
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
      failed = true;
      setPreviewError(getErrorMessage(error) || 'Failed to load file.');
      setPreviewErrorType(classifyFilePreviewError(error));
      setPreviewDescriptor({ mode: 'unsupported' });
      setPreviewMessage('Failed to load file.');
    } finally {
      if (seq === previewReqSeq) {
        if (!failed) { setPreviewError(null); setPreviewErrorType(undefined); }
        setPreviewLoading(false);
      }
    }
  };

  const retry = async () => {
    const item = previewItem();
    if (!previewOpen() || !item || previewLoading() || previewDirty()) return;
    await loadPreview(item, true);
  };

  const reportRenderError = (path: string, message = 'Failed to render preview') => {
    if (previewItem()?.path !== path || !previewOpen() || previewDirty()) return;
    batch(() => {
      setPreviewError(message);
      setPreviewErrorType('render_error');
      setPreviewLoading(false);
    });
  };

  const reportResourceError = async (path: string, source: string) => {
    if (!previewOpen() || previewItem()?.path !== path || previewResourceUrl() !== source || mediaErrorController) return;
    const seq = previewReqSeq;
    const controller = new AbortController();
    mediaErrorController = controller;
    let error: unknown = new Error('Failed to render media preview');
    try {
      const response = await fetch(source, await prepareLocalApiRequestInit({ method: 'HEAD', cache: 'no-store', signal: controller.signal }));
      if (!response.ok) error = Object.assign(new Error(response.statusText), { status: response.status });
    } catch (failure) {
      error = failure;
    }
    if (controller.signal.aborted || seq !== previewReqSeq || previewItem()?.path !== path) return;
    mediaErrorController = undefined;
    batch(() => {
      setPreviewError(getErrorMessage(error) || 'Failed to load file.');
      setPreviewErrorType(classifyFilePreviewError(error));
      setPreviewLoading(false);
    });
  };

  const openPreview = async (item: FileItem) => {
    if (item.type !== 'file') return;
    if (hasUnsavedChanges()) {
      queuePendingAction({ type: 'open', item });
      return;
    }
    await loadPreview(item);
  };

  createEffect(() => {
    const client = params.client();
    const pending = pendingConnectionLoad();
    if (!client || !pending) return;

    untrack(() => {
      if (pending.seq !== previewReqSeq || !previewOpen()) {
        setPendingConnectionLoad(null);
        return;
      }
      setPendingConnectionLoad(null);
      void loadPreview(pending.item, true);
    });
  });

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
    if (previewSaving()) return;
    const action = pendingAction;
    if (!action) return;

    if (action.type === 'close') {
      // The owning window must observe confirmation dismissal and closure together.
      batch(() => {
        clearPendingAction();
        forceClosePreview();
      });
      return;
    }

    clearPendingAction();
    await loadPreview(action.item);
  };

  const beginEditing = () => {
    if (!previewOpen() || !canEdit()) return;
    setPreviewEditing(true);
    setPreviewSaveError(null);
  };

  const updateDraft = (value: string) => {
    if (!previewOpen() || !isTextFilePreview(previewDescriptor())) return;
    setPreviewDraftText(value);
    setPreviewDirty(value !== previewText());
    if (previewSaveError()) {
      setPreviewSaveError(null);
    }
  };

  const updateSelection = (selectionText: string) => {
    setPreviewSelectedText(String(selectionText ?? '').trim());
  };

  const bindPdfEditor: BindPdfPreviewEditor = (editor) => {
    if (previewDescriptor().mode === 'pdf' && editor.sourceBytes === previewBytes()) pdfEditor = editor;
    return {
      markDirty: () => {
        if (pdfEditor !== editor || !previewEditing()) return;
        pdfEditRevision++;
        setPreviewDirty(true);
        setPreviewSaveError(null);
      },
      dispose: () => { if (pdfEditor === editor) pdfEditor = null; },
    };
  };

  const exportPdfDraft = async () => {
    const editor = pdfEditor;
    if (previewDescriptor().mode !== 'pdf' || !editor) throw new Error('PDF editor is unavailable.');
    const bytes = await editor.save();
    if (pdfEditor !== editor) throw new Error('The PDF preview changed during export.');
    return bytes;
  };

  const saveCurrent = async (): Promise<boolean> => {
    if (!previewOpen() || !canEdit() || !previewDirty() || previewSaving()) return false;

    const rpc = params.rpc();
    const item = previewItem();
    if (!rpc || !item) return false;

    const content = previewDraftText();
    const isPdf = previewDescriptor().mode === 'pdf';
    const editor = pdfEditor;
    if (isPdf && !editor) return false;
    const editRevision = pdfEditRevision;
    const requestSeq = ++saveReqSeq;
    setPreviewSaving(true);
    setPreviewSaveError(null);

    try {
      const client = params.client();
      if (!client) return false;
      const pdfBytes = isPdf ? await editor!.save() : null;
      if (requestSeq !== saveReqSeq || previewItem()?.path !== item.path || !canEdit() || (isPdf && pdfEditor !== editor)) return false;
      await createWorkspaceEffectRpc(client, rpc).fs.writeFile({
        path: item.path,
        content: pdfBytes ? bytesToBase64(pdfBytes) : content,
        encoding: pdfBytes ? 'base64' : 'utf8',
        createDirs: false,
      });

      if (requestSeq !== saveReqSeq || previewItem()?.path !== item.path) return false;

      if (pdfBytes) {
        // Keep the live document and reading position. Discard uses the last
        // acknowledged binary snapshot, not the file's original open bytes.
        savedPdfBytes = pdfBytes;
      } else {
        setPreviewText(content);
        setPreviewDraftText(content);
        setPreviewBytes(encodeUtf8Bytes(content));
      }
      setPreviewTruncated(false);
      setPreviewDirty(isPdf && pdfEditRevision !== editRevision);
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
    if (previewSaving()) return;
    if (previewDescriptor().mode === 'pdf') {
      const bytes = savedPdfBytes ?? previewBytes();
      resetEditorState();
      setPreviewBytes(bytes?.slice() ?? null);
      return;
    }
    if (!isTextFilePreview(previewDescriptor())) return;
    resetEditorState(previewText());
  };

  onCleanup(() => {
    presentations.clear();
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
    resourceUrl: previewResourceUrl,
    bytes: previewBytes,
    truncated: previewTruncated,
    loading: previewLoading,
    error: previewError,
    errorType: previewErrorType,
    retry,
    reportResourceError,
    reportRenderError,
    xlsxSheetName,
    xlsxRows,
    openPreview,
    closePreview,
    retainContent,
    handleOpenChange,
    cancelPendingAction,
    confirmDiscardAndContinue,
    beginEditing,
    updateDraft,
    updateSelection,
    saveCurrent,
    revertCurrent,
    bindPdfEditor,
    exportPdfDraft,
  };
}
