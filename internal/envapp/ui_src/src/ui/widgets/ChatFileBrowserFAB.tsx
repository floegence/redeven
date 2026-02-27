// Chat 页面悬浮文件浏览器 FAB 组件
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Motion } from 'solid-motionone';
import { Folder, FileText } from '@floegence/floe-webapp-core/icons';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { previewModeByName, isLikelyTextContent, getExtDot, mimeFromExtDot } from '../utils/filePreview';

// 文件列表项
interface ChatFileItem {
  name: string;
  path: string;
  type: 'folder' | 'file';
  size?: number;
}

export interface ChatFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  enabled?: boolean;
}

// 格式化文件大小
function formatSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// 将 FsFileInfo 转换为 ChatFileItem
function toChatFileItem(entry: FsFileInfo): ChatFileItem {
  return {
    name: String(entry.name ?? ''),
    path: String(entry.path ?? ''),
    type: entry.isDirectory ? 'folder' : 'file',
    size: entry.isDirectory ? undefined : (Number.isFinite(entry.size) ? entry.size : undefined),
  };
}

// 拆分路径为面包屑段落
function splitBreadcrumb(dirPath: string, homePath?: string): { label: string; path: string }[] {
  const normalized = dirPath.replace(/\/+$/, '') || '/';
  const parts = normalized.split('/').filter(Boolean);
  const segments: { label: string; path: string }[] = [];

  // 根路径
  if (homePath && normalized.startsWith(homePath)) {
    segments.push({ label: '~', path: homePath });
    const rel = normalized.slice(homePath.length).replace(/^\/+/, '');
    if (rel) {
      const relParts = rel.split('/').filter(Boolean);
      let accum = homePath;
      for (const p of relParts) {
        accum = accum.replace(/\/+$/, '') + '/' + p;
        segments.push({ label: p, path: accum });
      }
    }
  } else {
    segments.push({ label: '/', path: '/' });
    let accum = '';
    for (const p of parts) {
      accum += '/' + p;
      segments.push({ label: p, path: accum });
    }
  }

  return segments;
}

// 最大预览字节数
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;

export function ChatFileBrowserFAB(props: ChatFileBrowserFABProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();

  // 状态
  const [browserOpen, setBrowserOpen] = createSignal(false);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [currentDir, setCurrentDir] = createSignal('');
  const [items, setItems] = createSignal<ChatFileItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  // 预览状态
  const [previewPath, setPreviewPath] = createSignal('');
  const [previewName, setPreviewName] = createSignal('');
  const [previewContent, setPreviewContent] = createSignal<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = createSignal<string | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewMode, setPreviewMode] = createSignal<'text' | 'image' | 'unsupported'>('unsupported');

  // 目录缓存
  let dirCache = new Map<string, ChatFileItem[]>();
  let loadSeq = 0;

  // workingDir 变化时重置并导航
  createEffect(() => {
    const wd = props.workingDir;
    if (wd) {
      dirCache = new Map();
      setCurrentDir(wd);
      void loadDir(wd);
    }
  });

  // 加载目录内容
  async function loadDir(dirPath: string) {
    const seq = ++loadSeq;
    const cached = dirCache.get(dirPath);
    if (cached) {
      setItems(cached);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const resp = await rpc.fs.list({ path: dirPath, showHidden: false });
      if (seq !== loadSeq) return;
      const entries = resp?.entries ?? [];
      const fileItems = entries
        .map(toChatFileItem)
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
      dirCache.set(dirPath, fileItems);
      setItems(fileItems);
    } catch (e) {
      if (seq !== loadSeq) return;
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setItems([]);
    } finally {
      if (seq === loadSeq) setLoading(false);
    }
  }

  // 导航到目录
  function navigateTo(dirPath: string) {
    setCurrentDir(dirPath);
    void loadDir(dirPath);
  }

  // 打开文件预览
  let previewReqSeq = 0;
  async function openPreview(item: ChatFileItem) {
    const seq = ++previewReqSeq;
    cleanupPreview();
    setPreviewPath(item.path);
    setPreviewName(item.name);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);
    setPreviewImageUrl(null);
    setPreviewOpen(true);

    const mode = previewModeByName(item.name);
    if (mode === 'image') {
      setPreviewMode('image');
    } else if (mode === 'text') {
      setPreviewMode('text');
    } else {
      // 对 binary / pdf / docx / xlsx 等尝试嗅探是否为文本
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
        const url = URL.createObjectURL(blob);
        setPreviewImageUrl(url);
      } else if (mode === 'text') {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
        if (seq !== previewReqSeq) return;
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        setPreviewContent(text);
      } else {
        // 嗅探判断是否为文本
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: SNIFF_BYTES });
        if (seq !== previewReqSeq) return;
        if (isLikelyTextContent(bytes)) {
          setPreviewMode('text');
          // 如果嗅探量就足够，则直接显示
          if (bytes.length < SNIFF_BYTES) {
            const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            setPreviewContent(text);
          } else {
            // 需要读取更多
            const { bytes: fullBytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
            if (seq !== previewReqSeq) return;
            const text = new TextDecoder('utf-8', { fatal: false }).decode(fullBytes);
            setPreviewContent(text);
          }
        }
        // 如果不是文本则保持 unsupported
      }
    } catch (e) {
      if (seq !== previewReqSeq) return;
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg);
    } finally {
      if (seq === previewReqSeq) setPreviewLoading(false);
    }
  }

  // 清理预览资源
  function cleanupPreview() {
    const url = previewImageUrl();
    if (url) {
      URL.revokeObjectURL(url);
      setPreviewImageUrl(null);
    }
    setPreviewContent(null);
    setPreviewError(null);
  }

  onCleanup(() => {
    cleanupPreview();
  });

  // 文件双击计时
  let lastClickPath = '';
  let lastClickTime = 0;
  function handleItemClick(item: ChatFileItem) {
    if (item.type === 'folder') {
      navigateTo(item.path);
      return;
    }
    // 文件双击检测
    const now = Date.now();
    if (lastClickPath === item.path && now - lastClickTime < 400) {
      // 双击
      void openPreview(item);
      lastClickPath = '';
      lastClickTime = 0;
    } else {
      lastClickPath = item.path;
      lastClickTime = now;
    }
  }

  const showFab = () => (props.enabled ?? true) && !browserOpen();
  const breadcrumbs = () => splitBreadcrumb(currentDir(), props.homePath);

  return (
    <>
      {/* FAB 悬浮按钮 */}
      <Show when={showFab()}>
        <div class="redeven-fab-file-browser">
          <Motion.div
            initial={{ opacity: 0, scale: 0.6, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, easing: 'ease-out' }}
          >
            <button
              class="redeven-fab-file-browser-btn"
              title="Browse files"
              onClick={() => {
                if (!currentDir()) {
                  setCurrentDir(props.workingDir);
                  void loadDir(props.workingDir);
                }
                setBrowserOpen(true);
              }}
            >
              <Folder class="w-5 h-5" />
            </button>
          </Motion.div>
        </div>
      </Show>

      {/* 文件浏览 FloatingWindow */}
      <FloatingWindow
        open={browserOpen()}
        onOpenChange={(open) => {
          setBrowserOpen(open);
        }}
        title="File Browser"
        defaultSize={{ width: 480, height: 520 }}
        minSize={{ width: 360, height: 300 }}
        zIndex={100}
      >
        <div class="flex flex-col h-full">
          {/* 面包屑 */}
          <div class="chat-fb-breadcrumb">
            <For each={breadcrumbs()}>
              {(seg, i) => (
                <>
                  <Show when={i() > 0}>
                    <span class="chat-fb-breadcrumb-sep">/</span>
                  </Show>
                  <span
                    class="chat-fb-breadcrumb-segment"
                    onClick={() => navigateTo(seg.path)}
                  >
                    {seg.label}
                  </span>
                </>
              )}
            </For>
          </div>

          {/* 文件列表 */}
          <div class="chat-fb-list">
            <Show when={loading()}>
              <div class="chat-fb-empty">
                <SnakeLoader />
              </div>
            </Show>
            <Show when={!loading() && loadError()}>
              <div class="chat-fb-preview-error">{loadError()}</div>
            </Show>
            <Show when={!loading() && !loadError() && items().length === 0}>
              <div class="chat-fb-empty">Empty directory</div>
            </Show>
            <Show when={!loading() && !loadError() && items().length > 0}>
              <For each={items()}>
                {(item) => (
                  <div
                    class={`chat-fb-item ${item.type === 'folder' ? 'chat-fb-item-folder' : ''}`}
                    onClick={() => handleItemClick(item)}
                  >
                    <span class="chat-fb-item-icon">
                      {item.type === 'folder' ? <Folder class="w-full h-full" /> : <FileText class="w-full h-full" />}
                    </span>
                    <span class="chat-fb-item-name" title={item.name}>{item.name}</span>
                    <Show when={item.type === 'file' && item.size != null}>
                      <span class="chat-fb-item-size">{formatSize(item.size)}</span>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </FloatingWindow>

      {/* 文件预览 FloatingWindow */}
      <FloatingWindow
        open={previewOpen()}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) {
            previewReqSeq += 1;
            cleanupPreview();
          }
        }}
        title={previewName() || 'File Preview'}
        defaultSize={{ width: 720, height: 520 }}
        minSize={{ width: 400, height: 300 }}
        zIndex={110}
      >
        <div class="flex flex-col h-full relative">
          {/* 路径显示 */}
          <div class="chat-fb-preview-path" title={previewPath()}>
            {previewPath()}
          </div>

          {/* 加载遮罩 */}
          <Show when={previewLoading()}>
            <div class="chat-fb-preview-loading">
              <SnakeLoader />
            </div>
          </Show>

          {/* 错误状态 */}
          <Show when={previewError()}>
            <div class="chat-fb-preview-error">{previewError()}</div>
          </Show>

          {/* 文本预览 */}
          <Show when={!previewError() && previewMode() === 'text' && previewContent() != null}>
            <pre
              class="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap break-words"
              style={{ margin: 0 }}
            >
              {previewContent()}
            </pre>
          </Show>

          {/* 图片预览 */}
          <Show when={!previewError() && previewMode() === 'image' && previewImageUrl()}>
            <div class="flex-1 overflow-auto flex items-center justify-center p-3">
              <img
                src={previewImageUrl()!}
                alt={previewName()}
                style={{ 'max-width': '100%', 'max-height': '100%', 'object-fit': 'contain' }}
              />
            </div>
          </Show>

          {/* 不支持预览 */}
          <Show when={!previewError() && !previewLoading() && previewMode() === 'unsupported'}>
            <div class="chat-fb-preview-unsupported">Preview not available for this file type</div>
          </Show>
        </div>
      </FloatingWindow>
    </>
  );
}
