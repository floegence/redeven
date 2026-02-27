// Floating file browser FAB for the chat page.
// The FAB lives inside the message area and can be dragged to any edge.
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Motion } from 'solid-motionone';
import { Folder } from '@floegence/floe-webapp-core/icons';
import { FileBrowser, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { previewModeByName, isLikelyTextContent, getExtDot, mimeFromExtDot } from '../utils/filePreview';

export interface ChatFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  enabled?: boolean;
  /** Ref to the container element that bounds the FAB drag area. */
  containerRef?: HTMLElement;
}

// ---- helpers ----

function normalizePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  if (p === '/') return '/';
  return p.endsWith('/') ? p.replace(/\/+$/, '') || '/' : p;
}

function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  return normalizePath(raw);
}

function toVirtualWorkingDirPath(workingDir: string, homePath?: string): string {
  const normalized = normalizePath(workingDir);
  const fsRoot = normalizeAbsolutePath(homePath ?? '');
  if (!fsRoot || fsRoot === '/') return normalized;

  const normalizedWorkingDirAbs = normalizeAbsolutePath(workingDir);
  if (!normalizedWorkingDirAbs) return normalized;
  if (normalizedWorkingDirAbs === fsRoot) return '/';
  if (normalizedWorkingDirAbs.startsWith(`${fsRoot}/`)) {
    return normalizePath(normalizedWorkingDirAbs.slice(fsRoot.length));
  }
  return normalized;
}

function extNoDot(name: string): string | undefined {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return undefined;
  return name.slice(idx + 1).toLowerCase();
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
  return [...items].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1,
  );
}

/** Recursively set children of a folder node inside a file tree. */
function withChildren(tree: FileItem[], folderPath: string, children: FileItem[]): FileItem[] {
  const target = folderPath.trim() || '/';
  if (target === '/' || target === '') return children;

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

  const [result] = visit(tree);
  return result;
}

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;
const FAB_SIZE = 44;
const EDGE_MARGIN = 12;

// ---- component ----

export function ChatFileBrowserFAB(props: ChatFileBrowserFABProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();

  // -- browser state --
  const [browserOpen, setBrowserOpen] = createSignal(false);
  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [resetSeq, setResetSeq] = createSignal(0);

  // -- preview state --
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewItem, setPreviewItem] = createSignal<FileItem | null>(null);
  const [previewText, setPreviewText] = createSignal<string | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = createSignal<string | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewMode, setPreviewMode] = createSignal<'text' | 'image' | 'binary' | 'unsupported'>('unsupported');

  // -- FAB position (px from container top-left) --
  // null = use default CSS position (bottom-right)
  const [fabLeft, setFabLeft] = createSignal<number | null>(null);
  const [fabTop, setFabTop] = createSignal<number | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isSnapping, setIsSnapping] = createSignal(false);
  let dragStart: { px: number; py: number; fabLeft: number; fabTop: number } | null = null;

  // -- dir loading plumbing --
  let cache = new Map<string, FileItem[]>();
  let dirReqSeq = 0;
  let lastLoadedPath = '/';

  const initialPath = createMemo(() => toVirtualWorkingDirPath(props.workingDir, props.homePath));

  createEffect(() => {
    const wd = initialPath();
    const enabled = props.enabled ?? true;
    if (!enabled || !wd) return;
    cache = new Map();
    setFiles([]);
    setResetSeq((n) => n + 1);
    void loadPathChain(wd);
  });

  async function loadDirOnce(path: string, seq: number): Promise<'ok' | 'error'> {
    if (seq !== dirReqSeq) return 'ok';
    const p = normalizePath(path);

    if (cache.has(p)) {
      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, cache.get(p)!));
      return 'ok';
    }

    if (!protocol.client()) return 'error';

    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      if (seq !== dirReqSeq) return 'ok';
      const entries = resp?.entries ?? [];
      const items = sortFileItems(entries.map(toFileItem));
      if (seq !== dirReqSeq) return 'ok';
      cache.set(p, items);
      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, items));
      return 'ok';
    } catch {
      return 'error';
    }
  }

  async function loadPathChain(path: string) {
    if (!protocol.client()) return;
    const seq = ++dirReqSeq;
    const p = normalizePath(path);
    const parts = p.split('/').filter(Boolean);
    const chain: string[] = ['/'];
    let reachedTarget = p === '/';
    for (let i = 0; i < parts.length; i += 1) {
      chain.push(`/${parts.slice(0, i + 1).join('/')}`);
    }
    setLoading(true);
    try {
      for (const dir of chain) {
        const res = await loadDirOnce(dir, seq);
        if (res === 'error') {
          reachedTarget = false;
          break;
        }
        if (dir === p) reachedTarget = true;
      }
      if (seq === dirReqSeq) lastLoadedPath = reachedTarget ? p : '/';
    } finally {
      if (seq === dirReqSeq) setLoading(false);
    }
  }

  // -- preview --
  let previewReqSeq = 0;

  function cleanupPreview() {
    const url = previewObjectUrl();
    if (url) {
      URL.revokeObjectURL(url);
      setPreviewObjectUrl(null);
    }
    setPreviewText(null);
    setPreviewError(null);
  }

  async function openPreview(item: FileItem) {
    const seq = ++previewReqSeq;
    cleanupPreview();
    setPreviewItem(item);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewOpen(true);

    const mode = previewModeByName(item.name);
    if (mode === 'image') {
      setPreviewMode('image');
    } else if (mode === 'text') {
      setPreviewMode('text');
    } else {
      setPreviewMode('unsupported');
    }

    const client = protocol.client();
    if (!client) {
      setPreviewLoading(false);
      setPreviewError('Connection is not ready');
      return;
    }

    try {
      if (mode === 'image') {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
        if (seq !== previewReqSeq) return;
        const ext = getExtDot(item.name);
        const mime = mimeFromExtDot(ext) || 'application/octet-stream';
        const blob = new Blob([bytes], { type: mime });
        setPreviewObjectUrl(URL.createObjectURL(blob));
      } else if (mode === 'text') {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
        if (seq !== previewReqSeq) return;
        setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
      } else {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: SNIFF_BYTES });
        if (seq !== previewReqSeq) return;
        if (isLikelyTextContent(bytes)) {
          setPreviewMode('text');
          if (bytes.length < SNIFF_BYTES) {
            setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
          } else {
            const { bytes: full } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
            if (seq !== previewReqSeq) return;
            setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(full));
          }
        } else {
          setPreviewMode('binary');
        }
      }
    } catch (e) {
      if (seq !== previewReqSeq) return;
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === previewReqSeq) setPreviewLoading(false);
    }
  }

  onCleanup(() => cleanupPreview());

  // -- Snap to nearest edge of the container --
  function snapToEdge(left: number, top: number) {
    const ct = props.containerRef;
    if (!ct) {
      // no container, just keep position
      setFabLeft(left);
      setFabTop(top);
      return;
    }
    const cw = ct.clientWidth;
    const ch = ct.clientHeight;

    // clamp inside container
    const clampedLeft = Math.max(EDGE_MARGIN, Math.min(left, cw - FAB_SIZE - EDGE_MARGIN));
    const clampedTop = Math.max(EDGE_MARGIN, Math.min(top, ch - FAB_SIZE - EDGE_MARGIN));

    // distance to each edge
    const dLeft = clampedLeft;
    const dRight = cw - FAB_SIZE - clampedLeft;
    const dTop = clampedTop;
    const dBottom = ch - FAB_SIZE - clampedTop;

    const minDist = Math.min(dLeft, dRight, dTop, dBottom);

    let snapLeft = clampedLeft;
    let snapTop = clampedTop;

    // snap to nearest horizontal edge (left/right preference)
    if (minDist === dLeft) {
      snapLeft = EDGE_MARGIN;
    } else if (minDist === dRight) {
      snapLeft = cw - FAB_SIZE - EDGE_MARGIN;
    } else if (minDist === dTop) {
      snapTop = EDGE_MARGIN;
    } else {
      snapTop = ch - FAB_SIZE - EDGE_MARGIN;
    }

    setIsSnapping(true);
    setFabLeft(snapLeft);
    setFabTop(snapTop);
    // remove snapping transition flag after animation
    requestAnimationFrame(() => {
      setTimeout(() => setIsSnapping(false), 250);
    });
  }

  // -- FAB drag handlers --

  function onFabPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const btn = e.currentTarget as HTMLElement;
    btn.setPointerCapture(e.pointerId);

    // if first interaction, compute initial position from the element's offset
    let currentLeft = fabLeft();
    let currentTop = fabTop();
    if (currentLeft == null || currentTop == null) {
      const ct = props.containerRef;
      if (ct) {
        const cw = ct.clientWidth;
        const ch = ct.clientHeight;
        currentLeft = cw - FAB_SIZE - EDGE_MARGIN;
        currentTop = ch - FAB_SIZE - EDGE_MARGIN;
      } else {
        currentLeft = 0;
        currentTop = 0;
      }
      setFabLeft(currentLeft);
      setFabTop(currentTop);
    }

    dragStart = {
      px: e.clientX,
      py: e.clientY,
      fabLeft: currentLeft,
      fabTop: currentTop,
    };
  }

  function onFabPointerMove(e: PointerEvent) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.px;
    const dy = e.clientY - dragStart.py;
    // dead zone to distinguish click from drag
    if (!isDragging() && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    setIsDragging(true);

    let newLeft = dragStart.fabLeft + dx;
    let newTop = dragStart.fabTop + dy;

    // clamp to container during drag
    const ct = props.containerRef;
    if (ct) {
      const cw = ct.clientWidth;
      const ch = ct.clientHeight;
      newLeft = Math.max(0, Math.min(newLeft, cw - FAB_SIZE));
      newTop = Math.max(0, Math.min(newTop, ch - FAB_SIZE));
    }

    setFabLeft(newLeft);
    setFabTop(newTop);
  }

  function onFabPointerUp(_e: PointerEvent) {
    if (!dragStart) return;
    const wasDrag = isDragging();
    dragStart = null;
    setIsDragging(false);

    if (wasDrag) {
      // snap to nearest edge
      snapToEdge(fabLeft()!, fabTop()!);
    } else {
      // it was a click — open file browser
      const wd = untrack(initialPath);
      if (!wd) return;
      if (!cache.has(wd) || lastLoadedPath !== wd) {
        void loadPathChain(wd);
      }
      setBrowserOpen(true);
    }
  }

  const showFab = () => (props.enabled ?? true) && !browserOpen();

  const fabStyle = () => {
    const left = fabLeft();
    const top = fabTop();
    if (left == null || top == null) {
      // default position: bottom-right via CSS
      return {};
    }
    return {
      left: `${left}px`,
      top: `${top}px`,
      // clear CSS defaults when using explicit position
      right: 'auto',
      bottom: 'auto',
      transition: isSnapping() ? 'left 0.25s ease-out, top 0.25s ease-out' : 'none',
    };
  };

  return (
    <>
      {/* FAB draggable button */}
      <Show when={showFab()}>
        <div
          class="redeven-fab-file-browser"
          style={fabStyle()}
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, easing: 'ease-out' }}
          >
            <button
              class="redeven-fab-file-browser-btn"
              title="Browse files"
              onPointerDown={onFabPointerDown}
              onPointerMove={onFabPointerMove}
              onPointerUp={onFabPointerUp}
            >
              <Folder class="w-5 h-5" />
            </button>
          </Motion.div>
        </div>
      </Show>

      {/* File browser floating window */}
      <FloatingWindow
        open={browserOpen()}
        onOpenChange={(open) => {
          setBrowserOpen(open);
        }}
        title="File Browser"
        defaultSize={{ width: 560, height: 520 }}
        minSize={{ width: 380, height: 340 }}
        zIndex={100}
      >
        <div class="h-full relative">
          <Show when={resetSeq() + 1} keyed>
            {(_seq) => (
              <FileBrowser
                files={files()}
                initialPath={initialPath()}
                initialViewMode="list"
                homeLabel="Home"
                sidebarWidth={200}
                persistenceKey="chat-fab-files"
                instanceId="chat-fab-files"
                onNavigate={(path) => {
                  const target = normalizePath(path);
                  void (async () => {
                    await loadPathChain(target);
                  })();
                }}
                onOpen={(item) => void openPreview(item)}
                class="h-full border-0 rounded-none shadow-none"
              />
            )}
          </Show>
          <LoadingOverlay visible={loading()} message="Loading files..." />
        </div>
      </FloatingWindow>

      {/* File preview floating window */}
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
        title={previewItem()?.name ?? 'File Preview'}
        defaultSize={{ width: 720, height: 520 }}
        minSize={{ width: 400, height: 300 }}
        zIndex={110}
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
                <img
                  src={previewObjectUrl()!}
                  alt={previewItem()?.name ?? 'Preview'}
                  class="max-w-full max-h-full object-contain"
                />
              </div>
            </Show>

            <Show when={(previewMode() === 'binary' || previewMode() === 'unsupported') && !previewError() && !previewLoading()}>
              <div class="p-4 text-sm text-muted-foreground">
                <div class="font-medium text-foreground mb-1">
                  {previewMode() === 'binary' ? 'Binary file' : 'Preview not available'}
                </div>
                <div class="text-xs">Preview is not available for this file type.</div>
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
        </div>
      </FloatingWindow>
    </>
  );
}
