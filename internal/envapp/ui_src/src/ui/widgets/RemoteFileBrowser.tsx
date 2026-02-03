import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Button, ConfirmDialog, Dialog, DirectoryPicker, FileBrowser, FileSavePicker, FloatingWindow, LoadingOverlay, useDeck, useNotification, useResolvedFloeConfig, type BuiltinContextMenuAction, type ContextMenuCallbacks, type FileItem } from '@floegence/floe-webapp-core';
import type { Client } from '@floegence/flowersec-core';
import { DEFAULT_MAX_JSON_FRAME_BYTES, readJsonFrame, writeJsonFrame } from '@floegence/flowersec-core/framing';
import { ByteReader, type YamuxStream } from '@floegence/flowersec-core/yamux';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { getExtDot, isLikelyTextContent, mimeFromExtDot, previewModeByName, type PreviewMode } from '../utils/filePreview';
import { useEnvContext } from '../pages/EnvContext';

type DirCache = Map<string, FileItem[]>;

type FsReadFileStreamMeta = {
  path: string;
  offset?: number;
  max_bytes?: number;
};

type FsReadFileStreamRespMeta = {
  ok: boolean;
  file_size?: number;
  content_len?: number;
  truncated?: boolean;
  error?: {
    code: number;
    message?: string;
  };
};

function InputDialog(props: {
  open: boolean;
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = createSignal(props.value);

  createEffect(() => {
    if (props.open) {
      setInputValue(props.value);
    }
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={props.title}
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.onCancel} disabled={props.loading}>
            {props.cancelText ?? 'Cancel'}
          </Button>
          <Button size="sm" variant="default" onClick={() => props.onConfirm(inputValue())} loading={props.loading}>
            {props.confirmText ?? 'Confirm'}
          </Button>
        </div>
      }
    >
      <div>
        <label class="block text-xs text-muted-foreground mb-1">{props.label}</label>
        <input
          type="text"
          class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={inputValue()}
          placeholder={props.placeholder}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !props.loading) {
              props.onConfirm(inputValue());
            } else if (e.key === 'Escape') {
              props.onCancel();
            }
          }}
          autofocus
        />
      </div>
    </Dialog>
  );
}

const JSON_FRAME_MAX_BYTES = DEFAULT_MAX_JSON_FRAME_BYTES;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;

export interface RemoteFileBrowserProps {
  widgetId?: string;
}

function extNoDot(name: string): string | undefined {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return undefined;
  return name.slice(idx + 1).toLowerCase();
}

function normalizePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  if (p === '/') return '/';
  return p.endsWith('/') ? p.replace(/\/+$/, '') || '/' : p;
}

function toFileItem(entry: FsFileInfo): FileItem {
  const isDir = !!entry.isDirectory;
  const name = String(entry.name ?? '');
  const p = String(entry.path ?? '');
  const modifiedAtMs = Number(entry.modifiedAt ?? 0);
  return {
    id: p,
    name,
    type: isDir ? 'folder' : 'file',
    path: p,
    size: Number.isFinite(entry.size) ? entry.size : undefined,
    modifiedAt: Number.isFinite(modifiedAtMs) && modifiedAtMs > 0 ? new Date(modifiedAtMs) : undefined,
    extension: isDir ? undefined : extNoDot(name),
  };
}

function sortFileItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
}

function rewriteSubtreePaths(item: FileItem, fromBase: string, toBase: string): FileItem {
  const from = normalizePath(fromBase);
  const to = normalizePath(toBase);

  const rewritePath = (p: string): string => {
    const n = normalizePath(p);
    if (n === from) return to;
    if (n.startsWith(from + '/')) return to + n.slice(from.length);
    return n;
  };

  const nextPath = rewritePath(item.path);
  const nextChildren = item.children?.map((c) => rewriteSubtreePaths(c, from, to));
  return {
    ...item,
    path: nextPath,
    id: nextPath,
    children: nextChildren,
  };
}

function withChildren(tree: FileItem[], folderPath: string, children: FileItem[]): FileItem[] {
  const target = folderPath.trim() || '/';
  if (target === '/' || target === '') {
    return children;
  }

  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((it) => {
      if (it.type !== 'folder') return it;
      if (it.path === target) {
        changed = true;
        return { ...it, children };
      }
      if (!it.children || it.children.length === 0) return it;
      const [nextChildren, hit] = visit(it.children);
      if (!hit) return it;
      changed = true;
      return { ...it, children: nextChildren };
    });
    return [changed ? next : items, changed];
  };

  const [next] = visit(tree);
  return next;
}

function removeItemsFromTree(tree: FileItem[], pathsToRemove: Set<string>): FileItem[] {
  const visit = (items: FileItem[]): FileItem[] => {
    return items
      .filter((it) => !pathsToRemove.has(normalizePath(it.path)))
      .map((it) => {
        if (it.type !== 'folder' || !it.children?.length) return it;
        const newChildren = visit(it.children);
        if (newChildren === it.children) return it;
        return { ...it, children: newChildren };
      });
  };
  return visit(tree);
}

function updateItemInTree(tree: FileItem[], oldPath: string, updates: Partial<FileItem>): FileItem[] {
  const targetPath = normalizePath(oldPath);
  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((it) => {
      if (normalizePath(it.path) === targetPath) {
        changed = true;
        return { ...it, ...updates };
      }
      if (it.type !== 'folder' || !it.children?.length) return it;
      const [newChildren, hit] = visit(it.children);
      if (!hit) return it;
      changed = true;
      return { ...it, children: newChildren };
    });
    return [changed ? next : items, changed];
  };
  const [next] = visit(tree);
  return next;
}

function insertItemToTree(tree: FileItem[], parentPath: string, item: FileItem): FileItem[] {
  const targetParent = normalizePath(parentPath);

  if (targetParent === '/') {
    if (tree.some((it) => normalizePath(it.path) === normalizePath(item.path))) {
      return tree;
    }
    return sortFileItems([...tree, item]);
  }

  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((it) => {
      if (it.type !== 'folder') return it;
      if (normalizePath(it.path) === targetParent) {
        const children = it.children ?? [];
        if (children.some((c) => normalizePath(c.path) === normalizePath(item.path))) {
          return it;
        }
        changed = true;
        return { ...it, children: sortFileItems([...children, item]) };
      }
      if (!it.children?.length) return it;
      const [newChildren, hit] = visit(it.children);
      if (!hit) return it;
      changed = true;
      return { ...it, children: newChildren };
    });
    return [changed ? next : items, changed];
  };
  const [next] = visit(tree);
  return next;
}

function downloadBlob(params: { name: string; blob: Blob }) {
  const url = URL.createObjectURL(params.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.name || 'download';
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function normalizeRespMeta(v: unknown): FsReadFileStreamRespMeta {
  if (v == null || typeof v !== 'object') throw new Error('Invalid response');
  const o = v as Record<string, unknown>;
  const ok = !!o.ok;
  const fileSize = typeof o.file_size === 'number' ? o.file_size : undefined;
  const contentLen = typeof o.content_len === 'number' ? o.content_len : undefined;
  const truncated = typeof o.truncated === 'boolean' ? o.truncated : undefined;
  const errRaw = o.error;
  const error =
    errRaw != null && typeof errRaw === 'object'
      ? {
          code: typeof (errRaw as any).code === 'number' ? (errRaw as any).code : 0,
          message: typeof (errRaw as any).message === 'string' ? (errRaw as any).message : undefined,
        }
      : undefined;
  return { ok, file_size: fileSize, content_len: contentLen, truncated, error };
}

function byteReaderFromStream(stream: YamuxStream): ByteReader {
  return new ByteReader(async () => {
    try {
      return await stream.read();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'eof') return null;
      throw e;
    }
  });
}

async function readFileBytesOnce(params: {
  client: Client;
  path: string;
  offset?: number;
  maxBytes?: number;
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: FsReadFileStreamRespMeta }> {
  const stream = await params.client.openStream('fs/read_file');
  const reader = byteReaderFromStream(stream);
  try {
    const req: FsReadFileStreamMeta = {
      path: params.path,
      offset: params.offset ?? 0,
      max_bytes: params.maxBytes ?? 0,
    };
    await writeJsonFrame((b) => stream.write(b), req);

    const metaRaw = await readJsonFrame((n) => reader.readExactly(n), JSON_FRAME_MAX_BYTES);
    const meta = normalizeRespMeta(metaRaw);
    if (!meta.ok) {
      const code = meta.error?.code ?? 0;
      const msg = meta.error?.message ?? 'Failed to read file';
      throw new Error(code ? `${msg} (${code})` : msg);
    }

    const want = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
    const out = new Uint8Array(new ArrayBuffer(want));
    let off = 0;
    while (off < want) {
      const take = Math.min(64 * 1024, want - off);
      const chunk = await reader.readExactly(take);
      out.set(chunk, off);
      off += chunk.length;
    }
    return { bytes: out, meta };
  } finally {
    try {
      await stream.close();
    } catch {
    }
  }
}

export function RemoteFileBrowser(props: RemoteFileBrowserProps = {}) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const ctx = useEnvContext();
  const deck = useDeck();
  const floe = useResolvedFloeConfig();
  const notification = useNotification();

  const envId = () => (ctx.env_id() ?? '').trim();

  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(false);

  let cache: DirCache = new Map();

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

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteDialogItems, setDeleteDialogItems] = createSignal<FileItem[]>([]);
  const [deleteLoading, setDeleteLoading] = createSignal(false);

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [renameDialogItem, setRenameDialogItem] = createSignal<FileItem | null>(null);
  const [renameLoading, setRenameLoading] = createSignal(false);

  const [moveToDialogOpen, setMoveToDialogOpen] = createSignal(false);
  const [moveToDialogItem, setMoveToDialogItem] = createSignal<FileItem | null>(null);
  const [moveToLoading, setMoveToLoading] = createSignal(false);

  const [duplicateLoading, setDuplicateLoading] = createSignal(false);

  const [dragMoveLoading, setDragMoveLoading] = createSignal(false);
  const [fileBrowserResetSeq, setFileBrowserResetSeq] = createSignal(0);

  const [copyToDialogOpen, setCopyToDialogOpen] = createSignal(false);
  const [copyToDialogItem, setCopyToDialogItem] = createSignal<FileItem | null>(null);
  const [copyToLoading, setCopyToLoading] = createSignal(false);

  const [currentBrowserPath, setCurrentBrowserPath] = createSignal('/');

  const [homePath, setHomePath] = createSignal<string | undefined>(undefined);

  let activePreviewStream: YamuxStream | null = null;
  let activeObjectUrl: string | null = null;
  let previewReqSeq = 0;
  let dirReqSeq = 0;
  let docxHost: HTMLDivElement | undefined;

  const cleanupPreview = () => {
    if (activePreviewStream) {
      try {
        activePreviewStream.reset(new Error('canceled'));
      } catch {
      }
      try {
        void activePreviewStream.close();
      } catch {
      }
      activePreviewStream = null;
    }
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {
      }
      activeObjectUrl = null;
    }
    if (docxHost) {
      docxHost.innerHTML = '';
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

  onCleanup(() => {
    previewReqSeq += 1;
    cleanupPreview();
  });

  const readPersistedLastPath = (id: string): string => {
    const eid = id.trim();
    if (!eid) return '/';

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).lastPathByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        const saved = (byEnv as any)[eid];
        if (typeof saved === 'string' && saved.trim()) return normalizePath(saved);
      }
      return '/';
    }

    return normalizePath(floe.persist.load<string>(`files:lastPath:${eid}`, '/'));
  };

  const writePersistedLastPath = (id: string, path: string) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizePath(path);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).lastPathByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, string>)
          : {};
      deck.updateWidgetState(props.widgetId, 'lastPathByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(`files:lastPath:${eid}`, next);
  };

  const readPersistedTargetPath = (id: string): string | null => {
    const eid = id.trim();
    if (!eid) return null;

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).lastTargetPathByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        const saved = (byEnv as any)[eid];
        if (typeof saved === 'string' && saved.trim()) return normalizePath(saved);
      }
      return null;
    }

    const saved = floe.persist.load<string>(`files:lastTargetPath:${eid}`, '');
    return saved ? normalizePath(saved) : null;
  };

  const writePersistedTargetPath = (id: string, path: string) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizePath(path);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).lastTargetPathByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, string>)
          : {};
      deck.updateWidgetState(props.widgetId, 'lastTargetPathByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(`files:lastTargetPath:${eid}`, next);
  };

  createEffect(() => {
    const _ = envId();
    dirReqSeq += 1;
    cache = new Map();
    setFiles([]);
    setLoading(false);
    setCurrentBrowserPath('/');
    setHomePath(undefined);
    setDragMoveLoading(false);
    setFileBrowserResetSeq(0);

    previewReqSeq += 1;
    cleanupPreview();
    setPreviewItem(null);
    setPreviewOpen(false);
  });

  const loadDirOnce = async (path: string, seq: number) => {
    const client = protocol.client();
    if (!client) return;
    if (seq !== dirReqSeq) return;

    const p = normalizePath(path);
    if (cache.has(p)) {
      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, cache.get(p)!));
      return;
    }

    const resp = await rpc.fs.list({ path: p, showHidden: false });
    if (seq !== dirReqSeq) return;

    const entries = resp?.entries ?? [];
    const items = entries
      .map(toFileItem)
      .sort((a: FileItem, b: FileItem) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    if (seq !== dirReqSeq) return;
    cache.set(p, items);

    if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, items));
  };

  const loadPathChain = async (path: string) => {
    if (!protocol.client()) return;

    const seq = ++dirReqSeq;
    const p = normalizePath(path);
    const parts = p.split('/').filter(Boolean);
    const chain: string[] = ['/'];
    for (let i = 0; i < parts.length; i += 1) {
      chain.push(`/${parts.slice(0, i + 1).join('/')}`);
    }

    setLoading(true);
    try {
      for (const dir of chain) {
        await loadDirOnce(dir, seq);
        if (seq !== dirReqSeq) return;
      }
    } catch (e) {
      if (seq !== dirReqSeq) return;
      notification.error('Failed to load directory', e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === dirReqSeq) setLoading(false);
    }
  };

  const openPreview = async (item: FileItem) => {
    if (item.type !== 'file') return;
    const client = protocol.client();
    if (!client) return;

    setPreviewOpen(true);
    setPreviewItem(item);
    cleanupPreview();

    const seq = (previewReqSeq += 1);
    setPreviewLoading(true);

    const baseMode = previewModeByName(item.name);
    setPreviewMode(baseMode);

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

      const stream = await client.openStream('fs/read_file');
      activePreviewStream = stream;
      const reader = byteReaderFromStream(stream);

      const req: FsReadFileStreamMeta = { path: item.path, offset: 0, max_bytes: wantBytes };
      await writeJsonFrame((b) => stream.write(b), req);
      const metaRaw = await readJsonFrame((n) => reader.readExactly(n), JSON_FRAME_MAX_BYTES);
      const meta = normalizeRespMeta(metaRaw);

      if (seq !== previewReqSeq) return;

      if (!meta.ok) {
        const code = meta.error?.code ?? 0;
        const msg = meta.error?.message ?? 'Failed to load file';
        throw new Error(code ? `${msg} (${code})` : msg);
      }

      const contentLen = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
      const out = new Uint8Array(new ArrayBuffer(contentLen));
      let off = 0;
      while (off < contentLen) {
        if (seq !== previewReqSeq) return;
        const take = Math.min(64 * 1024, contentLen - off);
        const chunk = await reader.readExactly(take);
        out.set(chunk, off);
        off += chunk.length;
      }

      try {
        await stream.close();
      } catch {
      } finally {
        if (activePreviewStream === stream) activePreviewStream = null;
      }

      if (seq !== previewReqSeq) return;

      const truncated = !!meta.truncated;
      setPreviewBytes(out);
      setPreviewTruncated(truncated);

      const extDot = getExtDot(item.name);
      const mime = mimeFromExtDot(extDot) ?? 'application/octet-stream';

      if (baseMode === 'text') {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
        setPreviewText(text);
        if (truncated) {
          setPreviewMessage('Showing partial content (truncated).');
        }
        return;
      }

      if (baseMode === 'image') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This image is too large to preview.');
          return;
        }
        const url = URL.createObjectURL(new Blob([out], { type: mime }));
        activeObjectUrl = url;
        setPreviewObjectUrl(url);
        return;
      }

      if (baseMode === 'pdf') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This PDF is too large to preview.');
          return;
        }
        const url = URL.createObjectURL(new Blob([out], { type: mime }));
        activeObjectUrl = url;
        setPreviewObjectUrl(url);
        return;
      }

      if (baseMode === 'docx') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This document is too large to preview.');
          return;
        }
        return;
      }

      if (baseMode === 'xlsx') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This spreadsheet is too large to preview.');
          return;
        }
        const mod = await import('exceljs');
        if (seq !== previewReqSeq) return;
        const ExcelJS: any = (mod as any).default ?? mod;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(out.buffer);
        if (seq !== previewReqSeq) return;

        const ws = workbook.worksheets?.[0] ?? workbook.getWorksheet?.(1);
        if (!ws) {
          setPreviewMode('unsupported');
          setPreviewMessage('No worksheet found in this file.');
          return;
        }

        const cellToText = (v: unknown): string => {
          if (v == null) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? 'true' : 'false';
          if (v instanceof Date) return v.toISOString();
          if (typeof v === 'object') {
            const o = v as any;
            if (typeof o.text === 'string') return o.text;
            if (Array.isArray(o.richText)) return o.richText.map((p: any) => String(p?.text ?? '')).join('');
            if (o.result != null) return cellToText(o.result);
            if (typeof o.formula === 'string' && o.result != null) return `${o.formula} = ${cellToText(o.result)}`;
            try {
              return JSON.stringify(o);
            } catch {
              return String(o);
            }
          }
          return String(v);
        };

        const maxRows = 200;
        const maxCols = 50;
        const rows: string[][] = [];
        const rowCount = typeof ws.rowCount === 'number' ? ws.rowCount : 0;
        const takeRows = Math.min(rowCount || maxRows, maxRows);
        for (let r = 1; r <= takeRows; r += 1) {
          const row = ws.getRow?.(r);
          if (!row) continue;
          const outRow: string[] = [];
          for (let c = 1; c <= maxCols; c += 1) {
            const cell = row.getCell?.(c);
            outRow.push(cellToText(cell?.value));
          }
          rows.push(outRow);
        }

        setXlsxSheetName(String(ws.name ?? 'Sheet1'));
        setXlsxRows(rows);
        return;
      }

      if (baseMode === 'binary') {
        if (isLikelyTextContent(out)) {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
          setPreviewMode('text');
          setPreviewText(text);
          if (truncated) {
            setPreviewMessage('Showing partial content (truncated).');
          }
          return;
        }
        setPreviewMessage('Preview is not available for this file type.');
        return;
      }
    } catch (e) {
      if (seq !== previewReqSeq) return;
      setPreviewError(e instanceof Error ? e.message : String(e));
      setPreviewMode('unsupported');
      setPreviewMessage('Failed to load file.');
    } finally {
      if (seq === previewReqSeq) setPreviewLoading(false);
    }
  };

  const downloadCurrent = async () => {
    const client = protocol.client();
    const it = previewItem();
    if (!client || !it) return;
    if (downloadLoading()) return;

    setDownloadLoading(true);
    try {
      const cached = previewBytes();
      const truncated = previewTruncated();
      if (cached && !truncated) {
        const mime = mimeFromExtDot(getExtDot(it.name)) ?? 'application/octet-stream';
        downloadBlob({ name: it.name, blob: new Blob([cached], { type: mime }) });
        return;
      }

      const size = typeof it.size === 'number' ? it.size : undefined;
      const { bytes } = await readFileBytesOnce({ client, path: it.path, maxBytes: size ?? 0 });
      const mime = mimeFromExtDot(getExtDot(it.name)) ?? 'application/octet-stream';
      downloadBlob({ name: it.name, blob: new Blob([bytes], { type: mime }) });
    } catch {
    } finally {
      setDownloadLoading(false);
    }
  };

  const invalidateDirCache = (dirPath: string) => {
    const p = normalizePath(dirPath);
    cache.delete(p);
  };

  const getParentDir = (filePath: string): string => {
    const p = normalizePath(filePath);
    const lastSlash = p.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return p.slice(0, lastSlash) || '/';
  };

  const refreshDir = async (dirPath: string) => {
    invalidateDirCache(dirPath);
    await loadPathChain(dirPath);
  };

  const rewriteCachePathPrefix = (fromPrefix: string, toPrefix: string) => {
    const from = normalizePath(fromPrefix);
    const to = normalizePath(toPrefix);
    if (from === to) return;

    const captured: Array<[string, FileItem[]]> = [];
    for (const [key, value] of cache.entries()) {
      const k = normalizePath(key);
      if (k === from || k.startsWith(from + '/')) {
        captured.push([k, value]);
      }
    }
    if (captured.length === 0) return;

    for (const [oldKey] of captured) {
      cache.delete(oldKey);
    }

    for (const [oldKey, items] of captured) {
      const newKey = oldKey === from ? to : to + oldKey.slice(from.length);
      const rewritten = items.map((it) => rewriteSubtreePaths(it, from, to));
      cache.set(newKey, sortFileItems(rewritten));
    }
  };

  const applyLocalMove = (item: FileItem, destDir: string) => {
    const from = normalizePath(item.path);
    const to = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;
    const movedItem = rewriteSubtreePaths(item, from, to);

    setFiles((prev) => {
      const removed = removeItemsFromTree(prev, new Set([from]));
      return insertItemToTree(removed, destDir, movedItem);
    });

    const srcDir = getParentDir(from);
    const srcCached = cache.get(srcDir);
    if (srcCached) {
      cache.set(srcDir, srcCached.filter((c) => normalizePath(c.path) !== from));
    }

    const destCached = cache.get(destDir);
    if (destCached) {
      const next = destCached.filter((c) => normalizePath(c.path) !== normalizePath(to));
      cache.set(destDir, sortFileItems([...next, movedItem]));
    }

    if (item.type === 'folder') {
      rewriteCachePathPrefix(from, to);
    }
  };

  const handleDragMove = async (items: FileItem[], targetPath: string) => {
    if (items.length === 0) return;

    const client = protocol.client();
    if (!client) {
      setFileBrowserResetSeq((v) => v + 1);
      notification.error('Move failed', 'Connection is not ready.');
      return;
    }

    if (dragMoveLoading()) return;

    const destDir = normalizePath(targetPath);
    setDragMoveLoading(true);

    let okCount = 0;
    const failures: string[] = [];

    try {
      for (const item of items) {
        const from = normalizePath(item.path);
        const to = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;
        if (normalizePath(to) === from) continue;

        try {
          await rpc.fs.rename({ oldPath: from, newPath: to });

          applyLocalMove(item, destDir);
          okCount += 1;
        } catch (e) {
          failures.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (okCount > 0) {
        writePersistedTargetPath(envId(), destDir);
      }

      if (failures.length > 0) {
        // FileBrowser drag uses optimistic UI updates; when the RPC fails we need to remount
        // the FileBrowser to clear those optimistic ops and show the real state again.
        setFileBrowserResetSeq((v) => v + 1);

        const prefix = okCount > 0
          ? `${okCount} moved, ${failures.length} failed.`
          : `${failures.length} failed.`;
        notification.error('Move failed', `${prefix} ${failures[0] ?? ''}`.trim());
        return;
      }

      if (okCount > 0) {
        notification.success('Moved', okCount === 1 ? '1 item moved.' : `${okCount} items moved.`);
      }
    } finally {
      setDragMoveLoading(false);
    }
  };

  const handleDelete = async (items: FileItem[]) => {
    const client = protocol.client();
    if (!client || items.length === 0) return;

    setDeleteLoading(true);
    setDeleteDialogOpen(false);

    try {
      for (const item of items) {
        const isDir = item.type === 'folder';
        await rpc.fs.delete({ path: item.path, recursive: isDir });
      }
      const pathsToRemove = new Set(items.map((i) => normalizePath(i.path)));
      setFiles((prev) => removeItemsFromTree(prev, pathsToRemove));
      for (const item of items) {
        const parentDir = getParentDir(item.path);
        const cached = cache.get(parentDir);
        if (cached) {
          cache.set(parentDir, cached.filter((c) => !pathsToRemove.has(normalizePath(c.path))));
        }
      }

      notification.success(
        items.length === 1 ? 'Deleted' : 'Delete completed',
        items.length === 1 ? `"${items[0]!.name}" deleted.` : `${items.length} items deleted.`
      );
    } catch (e) {
      notification.error('Delete failed', e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRename = async (item: FileItem, newName: string) => {
    const client = protocol.client();
    if (!client || !newName.trim()) return;

    const newNameTrimmed = newName.trim();
    if (newNameTrimmed === item.name) {
      setRenameDialogOpen(false);
      return;
    }

    const parentDir = getParentDir(item.path);
    const newPath = parentDir === '/' ? `/${newNameTrimmed}` : `${parentDir}/${newNameTrimmed}`;
    const newExt = item.type === 'file' ? extNoDot(newNameTrimmed) : undefined;

    setRenameLoading(true);
    setRenameDialogOpen(false);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath });
      const updates: Partial<FileItem> = {
        name: newNameTrimmed,
        path: newPath,
        id: newPath,
        extension: newExt,
      };
      setFiles((prev) => updateItemInTree(prev, item.path, updates));
      const cached = cache.get(parentDir);
      if (cached) {
        cache.set(
          parentDir,
          cached.map((c) => (normalizePath(c.path) === normalizePath(item.path) ? { ...c, ...updates } : c))
        );
      }

      notification.success('Renamed', `"${item.name}" renamed to "${newNameTrimmed}".`);
    } catch (e) {
      notification.error('Rename failed', e instanceof Error ? e.message : String(e));
    } finally {
      setRenameLoading(false);
    }
  };

  const duplicateOne = async (
    item: FileItem
  ): Promise<{ ok: true; newName: string } | { ok: false }> => {
    const client = protocol.client();
    if (!client) return { ok: false };

    const parentDir = getParentDir(item.path);
    const baseName = item.name;
    const ext = baseName.includes('.')
      ? baseName.slice(baseName.lastIndexOf('.'))
      : '';
    const nameWithoutExt = ext
      ? baseName.slice(0, baseName.lastIndexOf('.'))
      : baseName;
    const newName = `${nameWithoutExt} (copy)${ext}`;
    const destPath = parentDir === '/' ? `/${newName}` : `${parentDir}/${newName}`;

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath });
      const newItem: FileItem = {
        ...item,
        id: destPath,
        name: newName,
        path: destPath,
        extension: item.type === 'file' ? extNoDot(newName) : undefined,
      };
      setFiles((prev) => insertItemToTree(prev, parentDir, newItem));
      const cached = cache.get(parentDir);
      if (cached && !cached.some((c) => normalizePath(c.path) === normalizePath(destPath))) {
        cache.set(parentDir, sortFileItems([...cached, newItem]));
      }
      return { ok: true, newName };
    } catch (e) {
      notification.error('Duplicate failed', e instanceof Error ? e.message : String(e));
      return { ok: false };
    }
  };

  const handleMoveTo = async (item: FileItem, destDirPath: string) => {
    const client = protocol.client();
    if (!client || !destDirPath.trim()) return;

    const destDir = normalizePath(destDirPath.trim());
    const finalDestPath = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;

    if (finalDestPath === item.path) {
      setMoveToDialogOpen(false);
      return;
    }

    setMoveToLoading(true);
    setMoveToDialogOpen(false);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath: finalDestPath });
      const srcDir = getParentDir(item.path);
      const pathsToRemove = new Set([normalizePath(item.path)]);
      setFiles((prev) => removeItemsFromTree(prev, pathsToRemove));
      const srcCached = cache.get(srcDir);
      if (srcCached) {
        cache.set(srcDir, srcCached.filter((c) => normalizePath(c.path) !== normalizePath(item.path)));
      }
      writePersistedTargetPath(envId(), destDir);

      notification.success('Moved', `"${item.name}" moved to "${finalDestPath}".`);
    } catch (e) {
      notification.error('Move failed', e instanceof Error ? e.message : String(e));
    } finally {
      setMoveToLoading(false);
    }
  };

  const handleCopyTo = async (item: FileItem, destDirPath: string, destFileName: string) => {
    const client = protocol.client();
    if (!client || !destDirPath.trim() || !destFileName.trim()) return;

    const destDir = normalizePath(destDirPath.trim());
    const finalDestPath = destDir === '/' ? `/${destFileName.trim()}` : `${destDir}/${destFileName.trim()}`;

    if (finalDestPath === item.path) {
      setCopyToDialogOpen(false);
      return;
    }

    setCopyToLoading(true);
    setCopyToDialogOpen(false);

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath: finalDestPath });
      const destDir = getParentDir(finalDestPath);
      const newName = finalDestPath.split('/').pop() ?? item.name;
      const newItem: FileItem = {
        ...item,
        id: finalDestPath,
        name: newName,
        path: finalDestPath,
        extension: item.type === 'file' ? extNoDot(newName) : undefined,
      };
      const destCached = cache.get(destDir);
      if (destCached) {
        if (!destCached.some((c) => normalizePath(c.path) === normalizePath(finalDestPath))) {
          cache.set(destDir, sortFileItems([...destCached, newItem]));
          setFiles((prev) => insertItemToTree(prev, destDir, newItem));
        }
      }
      writePersistedTargetPath(envId(), destDir);

      notification.success('Copied', `"${item.name}" copied to "${finalDestPath}".`);
    } catch (e) {
      notification.error('Copy failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCopyToLoading(false);
    }
  };

  createEffect(() => {
    if (!protocol.client()) return;
    const id = envId();
    if (!id) return;
    void loadPathChain(readPersistedLastPath(id));

    void (async () => {
      const client = protocol.client();
      if (!client) return;
      try {
        const resp = await rpc.fs.getHome();
        const home = String(resp?.path ?? '').trim();
        if (home) setHomePath(home);
      } catch {
      }
    })();
  });

  createEffect(() => {
    if (previewMode() !== 'docx') return;
    const it = previewItem();
    const bytes = previewBytes();
    if (!it || !bytes || !docxHost) return;

    const seq = previewReqSeq;
    void (async () => {
      try {
        docxHost!.innerHTML = '';
        const mod = await import('docx-preview');
        if (seq !== previewReqSeq) return;
        const renderAsync = (mod as any).renderAsync as ((buf: ArrayBuffer, container: HTMLElement, styleContainer?: HTMLElement, options?: any) => Promise<void>) | undefined;
        if (!renderAsync) throw new Error('renderAsync not found');
        await renderAsync(bytes.buffer, docxHost!, undefined, {
          className: 'docx-preview-container',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: false,
        });
      } catch (e) {
        if (seq !== previewReqSeq) return;
        setPreviewError(e instanceof Error ? e.message : String(e));
        setPreviewMode('unsupported');
        setPreviewMessage('Failed to render DOCX document.');
      }
    })();
  });

  const ctxMenu: ContextMenuCallbacks = {
    onDelete: (items: FileItem[]) => {
      setDeleteDialogItems(items);
      setDeleteDialogOpen(true);
    },
    onRename: (item: FileItem) => {
      setRenameDialogItem(item);
      setRenameDialogOpen(true);
    },
    onDuplicate: (items: FileItem[]) => {
      void (async () => {
        if (duplicateLoading()) return;
        setDuplicateLoading(true);
        try {
          let okCount = 0;
          let lastNewName: string | null = null;

          for (const item of items) {
            const ret = await duplicateOne(item);
            if (ret.ok) {
              okCount += 1;
              lastNewName = ret.newName;
            }
          }

          if (okCount <= 0) return;
          if (okCount === 1) {
            notification.success('Duplicated', lastNewName ? `Created "${lastNewName}".` : 'Duplicate completed.');
            return;
          }
          notification.success('Duplicate completed', `${okCount} items duplicated.`);
        } finally {
          setDuplicateLoading(false);
        }
      })();
    },
    onMoveTo: (items: FileItem[]) => {
      if (items.length > 0) {
        setMoveToDialogItem(items[0]);
        setMoveToDialogOpen(true);
      }
    },
    onCopyTo: (items: FileItem[]) => {
      if (items.length > 0) {
        setCopyToDialogItem(items[0]);
        setCopyToDialogOpen(true);
      }
    },
  };

  return (
    <div class="h-full relative">
      <Show
        when={envId()}
        keyed
        fallback={<div class="h-full" />}
      >
        {(id) => (
          <Show when={fileBrowserResetSeq() + 1} keyed>
            {(_seq) => (
              <FileBrowser
                files={files()}
                initialPath={readPersistedLastPath(id)}
                initialViewMode="list"
                homeLabel="Home"
                sidebarWidth={240}
                persistenceKey={`files:${id}`}
                instanceId={props.widgetId ? `redeven-files:${id}:${props.widgetId}` : `redeven-files:${id}`}
                onNavigate={(path) => {
                  writePersistedLastPath(id, path);
                  setCurrentBrowserPath(path);
                  void loadPathChain(path);
                }}
                onOpen={(item) => void openPreview(item)}
                onDragMove={(items, targetPath) => void handleDragMove(items, targetPath)}
                contextMenuCallbacks={ctxMenu}
                hideContextMenuItems={(items: FileItem[]): BuiltinContextMenuAction[] => {
                  const hidden: BuiltinContextMenuAction[] = ['ask-agent'];
                  if (items.some((i) => i.type === 'folder')) {
                    hidden.push('duplicate', 'copy-to');
                  }
                  return hidden;
                }}
                class="h-full border-0 rounded-none shadow-none"
              />
            )}
          </Show>
        )}
      </Show>

      <LoadingOverlay visible={loading()} message="Loading files..." />
      <LoadingOverlay visible={dragMoveLoading()} message="Moving..." />

      <FloatingWindow
        open={previewOpen()}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) {
            previewReqSeq += 1;
            cleanupPreview();
            setPreviewItem(null);
          }
        }}
        title={previewItem()?.name ?? 'File preview'}
        defaultSize={{ width: 920, height: 620 }}
        minSize={{ width: 520, height: 320 }}
      >
        <div class="h-full flex flex-col min-h-0">
          <div class="px-3 py-2 border-b border-border text-[11px] text-muted-foreground font-mono truncate">
            {previewItem()?.path}
          </div>

          <div class="flex-1 min-h-0 overflow-auto relative bg-background">
            <Show when={previewMode() === 'text' && !previewError()}>
              <pre class="p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-text">
                {previewText()}
              </pre>
            </Show>

            <Show when={previewMode() === 'image' && !previewError()}>
              <div class="p-3 h-full flex items-center justify-center">
                <img src={previewObjectUrl()} alt={previewItem()?.name ?? 'Preview'} class="max-w-full max-h-full object-contain" />
              </div>
            </Show>

            <Show when={previewMode() === 'pdf' && !previewError()}>
              <iframe src={previewObjectUrl()} class="w-full h-full border-0" title="PDF preview" />
            </Show>

            <Show when={previewMode() === 'docx' && !previewError()}>
              <div ref={docxHost} class="p-3" />
            </Show>

            <Show when={previewMode() === 'xlsx' && !previewError()}>
              <div class="p-3">
                <Show when={xlsxSheetName()}>
                  <div class="text-[11px] text-muted-foreground mb-2">Sheet: {xlsxSheetName()}</div>
                </Show>
                <div class="overflow-auto border border-border rounded-md">
                  <table class="w-full text-xs">
                    <tbody>
                      <For each={xlsxRows()}>
                        {(row) => (
                          <tr class="border-b border-border last:border-b-0">
                            <For each={row}>
                              {(cell) => (
                                <td class="px-2 py-1 border-r border-border last:border-r-0 align-top whitespace-pre-wrap break-words">
                                  {cell}
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </Show>

            <Show when={(previewMode() === 'binary' || previewMode() === 'unsupported') && !previewError()}>
              <div class="p-4 text-sm text-muted-foreground">
                <div class="font-medium text-foreground mb-1">
                  {previewMode() === 'binary' ? 'Binary file' : 'Preview not available'}
                </div>
                <div class="text-xs">{previewMessage() || 'Preview is not available.'}</div>
              </div>
            </Show>

            <Show when={previewError()}>
              <div class="p-4 text-sm text-error">
                <div class="font-medium mb-1">Failed to load file</div>
                <div class="text-xs text-muted-foreground">{previewError()}</div>
              </div>
            </Show>

            <LoadingOverlay visible={previewLoading()} message="Loading file..." />
          </div>

          <div class="px-3 py-2 border-t border-border flex items-center justify-between gap-2">
            <div class="min-w-0">
              <Show when={previewTruncated()}>
                <div class="text-[11px] text-muted-foreground truncate">Truncated preview</div>
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" loading={downloadLoading()} disabled={!previewItem() || previewLoading() || !!previewError()} onClick={downloadCurrent}>
                Download
              </Button>
            </div>
          </div>
        </div>
      </FloatingWindow>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogOpen(false);
        }}
        title="Delete"
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading()}
        onConfirm={() => void handleDelete(deleteDialogItems())}
      >
        <div class="text-sm text-foreground">
          <Show
            when={deleteDialogItems().length === 1}
            fallback={<>Are you sure you want to delete <span class="font-semibold">{deleteDialogItems().length} items</span>?</>}
          >
            Are you sure you want to delete <span class="font-semibold">"{deleteDialogItems()[0]?.name}"</span>?
          </Show>
        </div>
      </ConfirmDialog>

      {/* Rename Dialog */}
      <InputDialog
        open={renameDialogOpen()}
        title="Rename"
        label="New name"
        value={renameDialogItem()?.name ?? ''}
        loading={renameLoading()}
        onConfirm={(newName) => {
          const item = renameDialogItem();
          if (item) void handleRename(item, newName);
        }}
        onCancel={() => setRenameDialogOpen(false)}
      />

      {/* Move To Directory Picker */}
      <DirectoryPicker
        open={moveToDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setMoveToDialogOpen(false);
        }}
        files={files()}
        initialPath={readPersistedTargetPath(envId()) ?? currentBrowserPath()}
        homeLabel="Home"
        homePath={homePath()}
        title="Move To"
        confirmText="Move"
        onSelect={(dirPath) => {
          const item = moveToDialogItem();
          if (item) void handleMoveTo(item, dirPath);
        }}
      />

      {/* Copy To File Save Picker */}
      <FileSavePicker
        open={copyToDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setCopyToDialogOpen(false);
        }}
        files={files()}
        initialPath={readPersistedTargetPath(envId()) ?? currentBrowserPath()}
        homeLabel="Home"
        homePath={homePath()}
        initialFileName={copyToDialogItem()?.name ?? ''}
        title="Copy To"
        confirmText="Copy"
        onSave={(dirPath, fileName) => {
          const item = copyToDialogItem();
          if (item) void handleCopyTo(item, dirPath, fileName);
        }}
      />

      {/* Duplicate Loading Overlay */}
      <Show when={duplicateLoading()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div class="bg-background border border-border rounded-lg shadow-lg px-4 py-3 text-sm">
            Duplicating...
          </div>
        </div>
      </Show>
    </div>
  );
}
