import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Motion } from 'solid-motionone';
import {
  CheckCircle,
  ChevronUp,
  Code,
  FileText,
  Pencil,
  Settings,
  Stop,
  Terminal,
  Trash,
} from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from '../icons/FlowerIcon';
import { LoadingOverlay, SnakeLoader } from '@floegence/floe-webapp-core/loading';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, ConfirmDialog, Dialog, DirectoryPicker, Input, Select, Tooltip } from '@floegence/floe-webapp-core/ui';
import {
  AttachmentPreview,
  ChatProvider,
  VirtualMessageList,
  useChatContext,
  useAttachments,
  type Attachment,
  type ChatCallbacks,
  type ChatContextValue,
  type Message,
} from '../chat';
import { RpcError, useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';
import { useAIChatContext } from './AIChatContext';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { fetchGatewayJSON } from '../services/gatewayApi';
import { decorateMessageBlocks, decorateStreamEvent } from './aiBlockPresentation';
import {
  extractSubagentViewsFromWaitResult,
  mapSubagentPayloadSnakeToCamel,
  mergeSubagentEventsByTimestamp,
  normalizeSubagentStatus,
  normalizeThreadTodosView,
  normalizeWriteTodosToolView,
  todoStatusBadgeClass,
  todoStatusLabel,
  type SubagentView,
  type ThreadTodoItem,
  type ThreadTodosView,
  type TodoStatus,
} from './aiDataNormalizers';
import { hasRWXPermissions } from './aiPermissions';
import type { AskFlowerIntent } from './askFlowerIntent';
import { buildAskFlowerDraftMarkdown, mergeAskFlowerDraft } from '../utils/askFlowerContextTemplate';
import {
  absolutePathToVirtualPath,
  normalizeAbsolutePath as normalizeAskFlowerAbsolutePath,
  resolveSuggestedWorkingDirAbsolute,
  virtualPathToAbsolutePath,
} from '../utils/askFlowerPath';

// ---- Working dir picker (directory tree utilities) ----

type DirCache = Map<string, FileItem[]>;

function normalizeVirtualPath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  if (p === '/') return '/';
  return p.endsWith('/') ? p.replace(/\/+$/, '') || '/' : p;
}

function toFolderFileItem(entry: FsFileInfo): FileItem {
  const name = String(entry.name ?? '');
  const p = normalizeVirtualPath(String(entry.path ?? ''));
  const modifiedAtMs = Number(entry.modifiedAt ?? 0);
  return {
    id: p,
    name,
    type: 'folder',
    path: p,
    modifiedAt: Number.isFinite(modifiedAtMs) && modifiedAtMs > 0 ? new Date(modifiedAtMs) : undefined,
  };
}

function sortFileItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
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

function virtualToRealPath(virtualPath: string, rootAbs?: string): string {
  const root = String(rootAbs ?? '').trim();
  if (!root) return normalizeVirtualPath(virtualPath);
  return virtualPathToAbsolutePath(virtualPath, root) || normalizeVirtualPath(virtualPath);
}

function realToVirtualPath(realPath: string, rootAbs?: string): string {
  const root = String(rootAbs ?? '').trim();
  if (!root) return '/';
  return absolutePathToVirtualPath(realPath, root);
}

function toUserDisplayPath(realPath: string, rootAbs?: string): string {
  const p = String(realPath ?? '').trim();
  if (!p) return '';
  const root = String(rootAbs ?? '').trim().replace(/\/+$/, '') || '';
  if (!root || root === '/' || !p.startsWith(root)) return p;
  const rel = p.slice(root.length);
  return '~' + (rel || '');
}

function normalizeWorkingDirInputText(input: string, rootAbs?: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const root = String(rootAbs ?? '').trim().replace(/\/+$/, '') || '';
  if (raw === '~') return root;
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    const vp = normalizeVirtualPath(raw.slice(1).replace(/\\/g, '/'));
    return virtualToRealPath(vp, root);
  }
  if (!raw.startsWith('/')) {
    const vp = normalizeVirtualPath(raw);
    return virtualToRealPath(vp, root);
  }
  return raw;
}

type ExecutionMode = 'act' | 'plan';

const EXECUTION_MODE_STORAGE_KEY = 'redeven_ai_execution_mode';

function normalizeExecutionMode(raw: unknown): ExecutionMode {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === 'plan' ? 'plan' : 'act';
}

function readPersistedExecutionMode(): ExecutionMode {
  try {
    return normalizeExecutionMode(localStorage.getItem(EXECUTION_MODE_STORAGE_KEY));
  } catch {
    return 'act';
  }
}

function persistExecutionMode(mode: ExecutionMode): void {
  try {
    localStorage.setItem(EXECUTION_MODE_STORAGE_KEY, normalizeExecutionMode(mode));
  } catch {
    // ignore
  }
}

const ChatCapture: Component<{ onReady: (ctx: ChatContextValue) => void }> = (props) => {
  const ctx = useChatContext();
  createEffect(() => props.onReady(ctx));
  return null;
};

type AIChatInputApi = {
  applyDraftText: (nextText: string, mode: 'append' | 'replace') => void;
  addAttachmentFiles: (files: File[]) => void;
  focusInput: () => void;
};

const AIChatInput: Component<{
  class?: string;
  placeholder?: string;
  disabled?: boolean;
  workingDirLabel?: string;
  workingDirTitle?: string;
  workingDirLocked?: boolean;
  workingDirDisabled?: boolean;
  onPickWorkingDir?: () => void;
  onEditWorkingDir?: () => void;
  onApiReady?: (api: AIChatInputApi | null) => void;
}> = (props) => {
  const ctx = useChatContext();
  const notify = useNotification();
  const [text, setText] = createSignal('');
  const [isFocused, setIsFocused] = createSignal(false);
  const [sending, setSending] = createSignal(false);

  let textareaRef: HTMLTextAreaElement | undefined;
  let rafId: number | null = null;

  const attachments = useAttachments({
    maxAttachments: ctx.config().maxAttachments,
    maxSize: ctx.config().maxAttachmentSize,
    acceptedTypes: ctx.config().acceptedFileTypes,
    onUpload: ctx.config().allowAttachments ? (file) => ctx.uploadAttachment(file) : undefined,
    uploadMode: 'deferred',
  });

  const placeholder = () => props.placeholder || ctx.config().placeholder || 'Type a message...';

  const canSend = () =>
    (text().trim() || attachments.attachments().length > 0) &&
    !props.disabled &&
    !sending() &&
    !attachments.hasUploading();

  // Auto-resize textarea height (coalesce to at most once per frame).
  const adjustHeight = () => {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };

  const scheduleAdjustHeight = () => {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      adjustHeight();
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      adjustHeight();
    });
  };

  const handleSend = async () => {
    if (!canSend()) return;

    setSending(true);

    const content = text().trim();
    try {
      const upload = await attachments.uploadAll();
      if (!upload.ok) {
        notify.error('Attachment upload failed', 'Remove failed attachments and try again.');
        return;
      }

      const files = upload.attachments.filter((attachment) => attachment.status === 'uploaded');

      setText('');
      attachments.clearAttachments();
      if (textareaRef) textareaRef.style.height = 'auto';

      await ctx.sendMessage(content, files);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // IME composition in progress (e.g. CJK input) — let the IME handle Enter.
    if (e.isComposing) return;
    // Enter to send (Shift+Enter for newline).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handlePaste = async (e: ClipboardEvent) => {
    if (!ctx.config().allowAttachments) return;
    await attachments.handlePaste(e);
  };

  const canPickWorkingDir = () => !!props.onPickWorkingDir && !props.disabled && !props.workingDirDisabled && !props.workingDirLocked;
  const canEditWorkingDir = () => !!props.onEditWorkingDir && !props.disabled && !props.workingDirDisabled && !props.workingDirLocked;

  const applyDraftText = (nextText: string, mode: 'append' | 'replace') => {
    const normalized = String(nextText ?? '').trim();
    if (!normalized) return;

    setText((prev) =>
      mergeAskFlowerDraft({
        currentText: prev,
        nextText: normalized,
        mode,
      }),
    );

    requestAnimationFrame(() => {
      scheduleAdjustHeight();
      const el = textareaRef;
      if (!el) return;
      el.focus();
      const cursor = el.value.length;
      try {
        el.setSelectionRange(cursor, cursor);
      } catch {
        // ignore cursor placement failures on older browsers
      }
    });
  };

  const addAttachmentFiles = (files: File[]) => {
    if (!ctx.config().allowAttachments) return;
    if (!Array.isArray(files) || files.length <= 0) return;
    attachments.addFiles(files);
  };

  const focusInput = () => {
    requestAnimationFrame(() => {
      textareaRef?.focus();
    });
  };

  createEffect(() => {
    props.onApiReady?.({
      applyDraftText,
      addAttachmentFiles,
      focusInput,
    });
  });

  onCleanup(() => {
    props.onApiReady?.(null);
    if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return (
    <div
      class={cn(
        'chat-input-container',
        isFocused() && 'chat-input-container-focused',
        attachments.isDragging() && 'chat-input-container-dragging',
        props.class,
      )}
      onDragEnter={attachments.handleDragEnter}
      onDragLeave={attachments.handleDragLeave}
      onDragOver={attachments.handleDragOver}
      onDrop={attachments.handleDrop}
    >
      <Show when={attachments.isDragging()}>
        <div class="chat-input-drop-overlay">
          <UploadIcon />
          <span>Drop files here</span>
        </div>
      </Show>

      <Show when={attachments.attachments().length > 0}>
        <AttachmentPreview
          attachments={attachments.attachments()}
          onRemove={attachments.removeAttachment}
        />
      </Show>

      <div class="chat-input-body">
        <textarea
          ref={textareaRef}
          class="chat-input-textarea"
          value={text()}
          onInput={(e) => {
            setText(e.currentTarget.value);
            scheduleAdjustHeight();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder()}
          disabled={props.disabled}
          rows={2}
        />
      </div>

      <div class="chat-input-toolbar">
        <div class="chat-input-toolbar-left">
          <div class="flex items-center gap-2 min-w-0">
            <Show when={props.onPickWorkingDir}>
              <button
                type="button"
                class={cn(
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-muted/40 text-[11px] font-medium text-muted-foreground transition-colors duration-150 max-w-[220px]',
                  canPickWorkingDir()
                    ? 'hover:text-foreground hover:bg-muted/60 cursor-pointer'
                    : 'opacity-60 cursor-not-allowed',
                )}
                onClick={() => {
                  if (!canPickWorkingDir()) return;
                  props.onPickWorkingDir?.();
                }}
                title={String(props.workingDirTitle ?? '').trim() || String(props.workingDirLabel ?? '').trim() || 'Working dir'}
              >
                <FolderIcon />
                <span class="truncate font-mono">{String(props.workingDirLabel ?? '').trim() || 'Working dir'}</span>
                <Show when={!!props.workingDirLocked}>
                  <LockIcon />
                </Show>
              </button>
            </Show>

            <Show when={props.onEditWorkingDir}>
              <button
                type="button"
                class="chat-input-attachment-btn"
                onClick={() => {
                  if (!canEditWorkingDir()) return;
                  props.onEditWorkingDir?.();
                }}
                title="Edit working directory"
                disabled={!canEditWorkingDir()}
              >
                <Pencil class="w-4 h-4" />
              </button>
            </Show>

            <Show when={ctx.config().allowAttachments}>
              <button
                type="button"
                class="chat-input-attachment-btn"
                onClick={attachments.openFilePicker}
                title="Add attachments"
              >
                <PaperclipIcon />
              </button>
            </Show>
          </div>
        </div>

        <div class="chat-input-toolbar-right">
          <span class="chat-input-hint">
            <kbd>Enter</kbd> send &nbsp; <kbd>Shift+Enter</kbd> newline
          </span>

          <button
            type="button"
            class={cn('chat-input-send-btn', canSend() && 'chat-input-send-btn-active')}
            onClick={() => void handleSend()}
            disabled={!canSend()}
            title="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
};

const PaperclipIcon: Component = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const FolderIcon: Component = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const LockIcon: Component = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 1 1 8 0v4" />
  </svg>
);

const SendIcon: Component = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const UploadIcon: Component = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

function InlineButtonSnakeLoading() {
  return (
    <span
      class="inline-flex items-center justify-center text-blue-600 dark:text-blue-300"
      style={{ '--primary': 'rgb(37 99 235)', '--muted': 'rgb(59 130 246 / 0.2)' }}
      aria-hidden="true"
    >
      <SnakeLoader size="sm" class="origin-center scale-[0.82]" />
    </span>
  );
}

function InlineStatusSnakeLoading() {
  return (
    <span
      class="inline-flex items-center justify-center text-blue-600 dark:text-blue-300"
      style={{ '--primary': 'rgb(37 99 235)', '--muted': 'rgb(59 130 246 / 0.2)' }}
      aria-hidden="true"
    >
      <SnakeLoader size="sm" class="origin-center scale-[0.72]" />
    </span>
  );
}

// Custom working indicator — neural animation + minimal waveform bars
function ChatWorkingIndicator(props: { phaseLabel?: string }) {
  const uid = `neural-${Math.random().toString(36).slice(2, 8)}`;

  const baseNodes = [
    { x: 20, y: 8 },
    { x: 8, y: 20 },
    { x: 32, y: 20 },
    { x: 14, y: 32 },
    { x: 26, y: 32 },
    { x: 20, y: 20 },
  ];

  const nodeAnimParams = [
    { ax: 2.6, ay: 2.2, fx: 1.55, fy: 1.35, px: 0, py: 0.4 },
    { ax: 2.3, ay: 2.6, fx: 1.4, fy: 1.6, px: 0.7, py: 0.2 },
    { ax: 2.3, ay: 2.6, fx: 1.4, fy: 1.6, px: 1.9, py: 0.5 },
    { ax: 2.6, ay: 2.2, fx: 1.55, fy: 1.35, px: 0.4, py: 1.1 },
    { ax: 2.6, ay: 2.2, fx: 1.55, fy: 1.35, px: 1.3, py: 0.9 },
    { ax: 0, ay: 0, fx: 0, fy: 0, px: 0, py: 0 },
  ];

  const toCenterConnections: Array<[number, number]> = [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5]];
  const toCenterDelays = [0, 0.22, 0.44, 0.66, 0.88];

  const sideConnections: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]];
  const sideDelays = [120, 210, 300, 150, 240];

  const [nodePositions, setNodePositions] = createSignal(baseNodes.map((n) => ({ x: n.x, y: n.y })));

  createEffect(() => {
    let animationId = 0;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000;
      setNodePositions(
        baseNodes.map((base, i) => {
          const p = nodeAnimParams[i];
          return {
            x: base.x + Math.sin(elapsed * p.fx + p.px) * p.ax,
            y: base.y + Math.sin(elapsed * p.fy + p.py) * p.ay,
          };
        }),
      );
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    onCleanup(() => cancelAnimationFrame(animationId));
  });

  return (
    <div class="px-4 py-1.5 shrink-0">
      <div class="inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-primary/[0.04] border border-primary/10 shadow-sm">
        {/* Neural SVG animation */}
        <svg class="w-7 h-7 shrink-0" viewBox="0 0 40 40" fill="none">
          <defs>
            <filter id={uid}>
              <feGaussianBlur stdDeviation="1" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <style>
            {`@keyframes ${uid}-draw { from { stroke-dashoffset: 1; stroke-opacity: 0.15; } to { stroke-dashoffset: 0; stroke-opacity: 0.7; } }`}
          </style>

          <g stroke="var(--primary)" stroke-width="0.8" fill="none">
            <For each={toCenterConnections}>
              {([from, to], i) => (
                <line
                  x1={nodePositions()[from].x}
                  y1={nodePositions()[from].y}
                  x2={nodePositions()[to].x}
                  y2={nodePositions()[to].y}
                  pathLength="1"
                  stroke-dasharray="1"
                  stroke-dashoffset="1"
                  style={{ animation: `${uid}-draw 1.15s linear ${toCenterDelays[i()]}s infinite` }}
                />
              )}
            </For>
            <For each={sideConnections}>
              {([from, to], i) => (
                <line
                  x1={nodePositions()[from].x}
                  y1={nodePositions()[from].y}
                  x2={nodePositions()[to].x}
                  y2={nodePositions()[to].y}
                  class="processing-neural-line"
                  style={`animation-delay:${sideDelays[i()]}ms`}
                />
              )}
            </For>
          </g>

          <g>
            <For each={toCenterConnections}>
              {([from, to], i) => (
                <circle r="1.2" fill="var(--primary)" opacity="0.8">
                  <animateMotion
                    dur="1.05s"
                    repeatCount="indefinite"
                    begin={`${toCenterDelays[i()]}s`}
                    path={`M${nodePositions()[from].x},${nodePositions()[from].y} L${nodePositions()[to].x},${nodePositions()[to].y}`}
                  />
                </circle>
              )}
            </For>
          </g>

          <g filter={`url(#${uid})`}>
            <For each={nodePositions()}>
              {(node, i) => (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={i() === 5 ? 2.5 : 2}
                  fill="var(--primary)"
                  class="processing-neural-node"
                  style={`animation-delay:${[0, 200, 400, 600, 800, 100][i()]}ms`}
                />
              )}
            </For>
          </g>
        </svg>

        {/* Status text (shimmer) */}
        <span class="text-xs text-muted-foreground processing-text-shimmer">{String(props.phaseLabel ?? "").trim() || "Working"}</span>

        {/* Waveform bars (minimal style) */}
        <div class="flex items-end gap-[2px] h-3.5">
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:0ms" />
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:100ms" />
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:200ms" />
          <div class="w-[3px] bg-primary/70 rounded-full processing-bar" style="animation-delay:300ms" />
        </div>
      </div>
    </div>
  );
}

function ExecutionModeToggle(props: {
  value: ExecutionMode;
  disabled?: boolean;
  onChange: (mode: ExecutionMode) => void;
}) {
  const btnClass = (active: boolean) => {
    const base = 'px-2.5 py-1 text-[11px] font-medium rounded-md transition-all duration-150 cursor-pointer';
    if (active) return `${base} bg-background text-foreground shadow-sm border border-border`;
    return `${base} text-muted-foreground hover:text-foreground hover:bg-muted/50`;
  };

  return (
    <div class={cn('inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-muted/40', props.disabled && 'opacity-60 pointer-events-none')}>
      <button
        type="button"
        class={btnClass(props.value === 'plan')}
        onClick={() => props.onChange('plan')}
        title="Planning-first mode with soft guidance; execution may still happen based on policy"
      >
        Plan
      </button>
      <button
        type="button"
        class={btnClass(props.value === 'act')}
        onClick={() => props.onChange('act')}
        title="Execution-first mode for direct tool actions"
      >
        Act
      </button>
    </div>
  );
}

// Compact tasks summary — collapsed as a small chip, expanded as an absolutely positioned panel.
function CompactTasksSummary(props: {
  executionMode: ExecutionMode;
  todos: ThreadTodoItem[];
  unresolvedCount: number;
  todosLoading: boolean;
  todosError: string;
  todosView: ThreadTodosView | null;
  todoUpdatedLabel: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  const doneCount = createMemo(() => props.todos.filter((item) => item.status === 'completed').length);
  const inProgressCount = createMemo(() => props.todos.filter((item) => item.status === 'in_progress').length);
  const progressLabel = createMemo(() => `${doneCount()} done/${props.todos.length} total`);

  // Close the popover when clicking outside.
  createEffect(() => {
    if (!expanded()) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
      }
    };
    // Capture phase keeps outside-close working even when inner widgets stop event bubbling.
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <div ref={containerRef} class="relative">
      {/* Collapsed chip */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded()}
        aria-haspopup="dialog"
        class={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer',
          'border transition-all duration-150',
          expanded()
            ? 'bg-primary/10 text-primary border-primary/30'
            : inProgressCount() > 0
              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25 hover:bg-blue-500/14'
              : 'bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground',
        )}
      >
        <Show when={inProgressCount() > 0} fallback={<CheckCircle class="w-3.5 h-3.5" />}>
          <InlineButtonSnakeLoading />
        </Show>
        <span>{progressLabel()}</span>
        <ChevronUp class={cn('w-3 h-3 transition-transform duration-200', expanded() ? '' : 'rotate-180')} />
      </button>

      <Show when={expanded()}>
        {/* Expanded panel */}
        <div class={cn(
          'absolute bottom-full left-0 mb-1.5 z-50',
          'w-80 max-sm:w-[calc(100vw-2rem)]',
          'rounded-xl border border-border/70 bg-card shadow-lg shadow-black/10',
          'backdrop-blur-md',
          'chat-tasks-panel chat-tasks-panel-open',
        )}>
          <div class="px-3 py-2.5">
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="text-xs font-medium text-foreground">Tasks</div>
              <div class="text-[11px] text-muted-foreground">
                {props.unresolvedCount} open
              </div>
            </div>

            <Show when={props.executionMode === 'plan' && props.unresolvedCount > 0}>
              <div class="text-[11px] text-muted-foreground mb-2">
                Switch to Act to execute these tasks
              </div>
            </Show>

            <Show when={!props.todosLoading || props.todos.length > 0} fallback={
              <div class="text-[11px] text-muted-foreground py-2">Loading tasks...</div>
            }>
              <Show when={!props.todosError} fallback={
                <div class="text-[11px] text-error py-2">{props.todosError}</div>
              }>
                <Show when={props.todos.length > 0} fallback={
                  <div class="text-[11px] text-muted-foreground py-2">No tasks yet.</div>
                }>
                  <div class="space-y-1.5 max-h-52 overflow-auto pr-1">
                    <For each={props.todos}>
                      {(item) => (
                        <div class="rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
                          <div class="flex items-center gap-2">
                            <span class={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium shrink-0', todoStatusBadgeClass(item.status))}>
                              <Show when={item.status === 'in_progress'}>
                                <InlineStatusSnakeLoading />
                              </Show>
                              {todoStatusLabel(item.status)}
                            </span>
                            <span class="text-xs text-foreground leading-relaxed break-words">{item.content}</span>
                          </div>
                          <Show when={item.note}>
                            <div class="mt-1 text-[11px] text-muted-foreground leading-relaxed break-words">
                              {item.note}
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Version {props.todosView?.version ?? 0}</span>
                  <span>{props.todoUpdatedLabel ? `Updated ${props.todoUpdatedLabel}` : ''}</span>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function subagentStatusLabel(status: string): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'waiting_input':
      return 'Waiting input';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    case 'timed_out':
      return 'Timed out';
    default:
      return 'Unknown';
  }
}

function subagentStatusBadgeClass(status: string): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'running':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25';
    case 'waiting_input':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
    case 'completed':
      return 'bg-success/10 text-success border-success/20';
    case 'failed':
    case 'timed_out':
      return 'bg-error/10 text-error border-error/20';
    case 'canceled':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return 'bg-muted/50 text-muted-foreground border-border/60';
  }
}

const subagentIntegerFormatter = new Intl.NumberFormat('en-US');

function formatSubagentInteger(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return subagentIntegerFormatter.format(Math.round(value));
}

function formatSubagentElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return '0s';
  const totalSec = Math.floor(elapsedMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function summarizeSubagentText(value: string, maxLength = 120): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function subagentHistoryRoleLabel(role: string): string {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'user') return 'User';
  if (normalized === 'assistant') return 'Subagent';
  if (normalized === 'system') return 'System';
  return 'Message';
}

function subagentHistoryRoleClass(role: string): string {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'user') return 'bg-primary/[0.06] border-primary/20';
  if (normalized === 'assistant') return 'bg-emerald-500/[0.08] border-emerald-500/20';
  if (normalized === 'system') return 'bg-amber-500/[0.08] border-amber-500/20';
  return 'bg-muted/40 border-border/70';
}

function resolveSubagentFinalMessage(item: SubagentView): string {
  for (let i = item.history.length - 1; i >= 0; i -= 1) {
    const entry = item.history[i];
    if (entry.role === 'assistant' && String(entry.text ?? '').trim()) {
      return String(entry.text).trim();
    }
  }
  return String(item.summary ?? '').trim();
}

function CompactSubagentsSummary(props: {
  subagents: SubagentView[];
  updatedLabel: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [selectedSubagent, setSelectedSubagent] = createSignal<SubagentView | null>(null);
  let containerRef: HTMLDivElement | undefined;

  const runningCount = createMemo(
    () => props.subagents.filter((item) => item.status === 'running').length,
  );
  const waitingCount = createMemo(
    () => props.subagents.filter((item) => item.status === 'waiting_input').length,
  );
  const completedCount = createMemo(
    () => props.subagents.filter((item) => item.status === 'completed').length,
  );
  const failedCount = createMemo(
    () => props.subagents.filter((item) => item.status === 'failed' || item.status === 'timed_out').length,
  );

  const openDetails = (item: SubagentView) => {
    setSelectedSubagent(item);
    setDetailOpen(true);
    setExpanded(false);
  };

  createEffect(() => {
    if (!expanded()) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef && !containerRef.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <div ref={containerRef} class="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded()}
        aria-haspopup="dialog"
        class={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer border transition-all duration-150',
          expanded()
            ? 'bg-primary/10 text-primary border-primary/30'
            : runningCount() > 0
              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25 hover:bg-blue-500/14'
              : 'bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground',
        )}
      >
        <Show when={runningCount() > 0} fallback={<Settings class="w-3.5 h-3.5" />}>
          <InlineButtonSnakeLoading />
        </Show>
        <span>{runningCount()} running</span>
        <ChevronUp class={cn('w-3 h-3 transition-transform duration-200', expanded() ? '' : 'rotate-180')} />
      </button>

      <Show when={expanded()}>
        <div class={cn(
          'absolute bottom-full left-0 mb-1.5 z-50 w-96 max-sm:w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-card shadow-lg shadow-black/10 backdrop-blur-md',
          'chat-tasks-panel chat-tasks-panel-open',
        )}>
          <div class="px-3 py-2.5">
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="text-xs font-medium text-foreground">Subagents</div>
              <div class="text-[11px] text-muted-foreground">
                {runningCount()} running · {waitingCount()} waiting · {completedCount()} completed · {failedCount()} failed
              </div>
            </div>

            <Show when={props.subagents.length > 0} fallback={
              <div class="text-[11px] text-muted-foreground py-2">No subagents yet.</div>
            }>
              <div class="space-y-1.5 max-h-64 overflow-auto pr-1">
                <For each={props.subagents}>
                  {(item) => (
                    <button
                      type="button"
                      onClick={() => openDetails(item)}
                      class={cn(
                        'w-full text-left rounded-lg border border-border/65 bg-background/75 px-2.5 py-2',
                        'transition-all duration-150 hover:border-primary/35 hover:bg-primary/[0.04]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                      )}
                    >
                      <div class="flex items-center gap-2">
                        <span class={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0', subagentStatusBadgeClass(item.status))}>
                          <Show when={String(item.status ?? '').toLowerCase() === 'running'}>
                            <InlineStatusSnakeLoading />
                          </Show>
                          {subagentStatusLabel(item.status)}
                        </span>
                        <span class="text-[11px] text-muted-foreground">{item.agentType || 'subagent'}</span>
                        <span class="ml-auto text-[10px] text-muted-foreground">{formatSubagentElapsed(item.stats.elapsedMs)}</span>
                      </div>
                      <div class="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span class="font-mono">{item.subagentId}</span>
                        <span>•</span>
                        <span>Steps {formatSubagentInteger(item.stats.steps)}</span>
                        <span>•</span>
                        <span>Tools {formatSubagentInteger(item.stats.toolCalls)}</span>
                        <span>•</span>
                        <span>Tokens {formatSubagentInteger(item.stats.tokens)}</span>
                      </div>
                      <Show when={item.summary}>
                        <div class="mt-1 text-[11px] text-foreground leading-relaxed">
                          {summarizeSubagentText(item.summary, 108)}
                        </div>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <div class="mt-2 text-[10px] text-muted-foreground">
              {props.updatedLabel ? `Updated ${props.updatedLabel}` : ''}
            </div>
          </div>
        </div>
      </Show>

      <Dialog
        open={detailOpen()}
        onOpenChange={(open) => {
          if (!open) {
            setDetailOpen(false);
            setSelectedSubagent(null);
            return;
          }
          setDetailOpen(true);
        }}
        title="Subagent details"
      >
        <Show when={selectedSubagent()} fallback={<div class="text-sm text-muted-foreground">No subagent selected.</div>}>
          {(selected) => {
            const item = selected();
            return (
              <div class="space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', subagentStatusBadgeClass(item.status))}>
                    <Show when={String(item.status ?? '').toLowerCase() === 'running'}>
                      <InlineStatusSnakeLoading />
                    </Show>
                    {subagentStatusLabel(item.status)}
                  </span>
                  <span class="text-xs text-muted-foreground">{item.agentType || 'subagent'}</span>
                  <span class="ml-auto rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    {item.subagentId}
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2 text-[11px]">
                  <div class="rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
                    <div class="text-muted-foreground">Steps</div>
                    <div class="mt-0.5 font-medium text-foreground">{formatSubagentInteger(item.stats.steps)}</div>
                  </div>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
                    <div class="text-muted-foreground">Tool calls</div>
                    <div class="mt-0.5 font-medium text-foreground">{formatSubagentInteger(item.stats.toolCalls)}</div>
                  </div>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
                    <div class="text-muted-foreground">Tokens</div>
                    <div class="mt-0.5 font-medium text-foreground">{formatSubagentInteger(item.stats.tokens)}</div>
                  </div>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
                    <div class="text-muted-foreground">Elapsed</div>
                    <div class="mt-0.5 font-medium text-foreground">{formatSubagentElapsed(item.stats.elapsedMs)}</div>
                  </div>
                  <div class="col-span-2 rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
                    <div class="text-muted-foreground">Outcome</div>
                    <div class="mt-0.5 font-medium text-foreground">{item.stats.outcome || subagentStatusLabel(item.status)}</div>
                  </div>
                </div>

                <Show when={item.summary}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Summary</div>
                    <div class="mt-1 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">{item.summary}</div>
                  </div>
                </Show>

                <Show when={resolveSubagentFinalMessage(item)}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Final message</div>
                    <div class="mt-1 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">{resolveSubagentFinalMessage(item)}</div>
                  </div>
                </Show>

                <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                  <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Message timeline</div>
                  <Show
                    when={item.history.length > 0}
                    fallback={<div class="mt-1 text-xs text-muted-foreground">No detailed messages yet.</div>}
                  >
                    <div class="mt-1 space-y-1.5 max-h-56 overflow-auto pr-0.5">
                      <For each={item.history}>
                        {(entry) => (
                          <div class={cn('rounded-md border px-2 py-1.5', subagentHistoryRoleClass(entry.role))}>
                            <div class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                              {subagentHistoryRoleLabel(entry.role)}
                            </div>
                            <div class="mt-0.5 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">
                              {entry.text}
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <Show when={item.triggerReason}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Trigger reason</div>
                    <div class="mt-1 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">{item.triggerReason}</div>
                  </div>
                </Show>

                <Show when={item.evidenceRefs.length > 0}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Evidence refs</div>
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      <For each={item.evidenceRefs}>
                        {(ref) => (
                          <span class="rounded-full border border-primary/25 bg-primary/[0.08] px-2 py-0.5 text-[11px] text-primary">
                            {ref}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={item.keyFiles.length > 0}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Key files</div>
                    <div class="mt-1 space-y-1.5">
                      <For each={item.keyFiles}>
                        {(file) => (
                          <div class="text-[11px] leading-relaxed text-foreground">
                            <span class="font-mono">{file.path}<Show when={file.line && file.line > 0}>:{file.line}</Show></span>
                            <Show when={file.purpose}>
                              <span class="text-muted-foreground"> — {file.purpose}</span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={item.openRisks.length > 0}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Open risks</div>
                    <ul class="mt-1 list-disc pl-4 space-y-1 text-xs leading-relaxed text-foreground">
                      <For each={item.openRisks}>{(risk) => <li>{risk}</li>}</For>
                    </ul>
                  </div>
                </Show>

                <Show when={item.nextActions.length > 0}>
                  <div class="rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
                    <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Next actions</div>
                    <ul class="mt-1 list-disc pl-4 space-y-1 text-xs leading-relaxed text-foreground">
                      <For each={item.nextActions}>{(action) => <li>{action}</li>}</For>
                    </ul>
                  </div>
                </Show>

                <Show when={item.error}>
                  <div class="rounded-md border border-error/30 bg-error/10 px-2.5 py-2 text-xs text-error">
                    Error: {item.error}
                  </div>
                </Show>
              </div>
            );
          }}
        </Show>
      </Dialog>
    </div>
  );
}

// Suggestion item for empty chat state
interface SuggestionItem {
  icon: Component<{ class?: string }>;
  title: string;
  description: string;
  prompt: string;
}

const SUGGESTIONS: SuggestionItem[] = [
  {
    icon: Terminal,
    title: 'Weather Check',
    description: 'Toronto now, forecast, and outfit tips',
    prompt: [
      'Check the latest weather for Toronto, Canada. Include:',
      '- current conditions',
      '- hourly forecast for the next 12 hours',
      '- daily forecast for the next 3 days',
      '- rain/snow probability and feels-like temperature',
      '- what to wear and whether to carry an umbrella',
      'Cite source URLs with update timestamps.',
    ].join('\n'),
  },
  {
    icon: CheckCircle,
    title: 'Trip Planner',
    description: 'Guided Q&A to choose your destination',
    prompt: [
      'Help me choose a travel destination through guided Q&A.',
      'Use ask_user one question at a time with 3 concise options (best option first).',
      'Cover budget, trip length, weather preference, travel pace, and visa constraints.',
      'After enough info, recommend top 3 destinations with pros/cons, best season, and budget range.',
    ].join('\n'),
  },
  {
    icon: FileText,
    title: 'Project Intro',
    description: 'Understand what this repo does',
    prompt: [
      'Analyze the current repository and provide:',
      '1) a concise project introduction (what it does and who it is for)',
      '2) a module map and responsibilities',
      '3) local run/build/test commands',
      '4) key file paths as evidence',
    ].join('\n'),
  },
  {
    icon: Code,
    title: 'Tech Route',
    description: 'Map key architecture and flows',
    prompt: [
      'Analyze this project\'s key technical routes and output:',
      '- authentication flow',
      '- control-plane vs data-plane flow',
      '- deployment path',
      '- observability and operational checkpoints',
      'For each route, include steps, key files, and main risks.',
    ].join('\n'),
  },
];

// Empty chat state component with welcome message and suggestions
interface EmptyChatProps {
  onSuggestionClick: (prompt: string) => void;
  disabled?: boolean;
}

const EmptyChat: Component<EmptyChatProps> = (props) => {
  return (
    <div class="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
      {/* Welcome section */}
      <Motion.div
        class="text-center mb-8 max-w-lg"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, easing: 'ease-out' }}
      >
        {/* Animated flower icon */}
        <div class="relative inline-flex items-center justify-center mb-6">
          <div class="absolute -inset-2 rounded-full bg-primary/8 animate-[pulse_3s_ease-in-out_1.35s_infinite] motion-reduce:animate-none" />
          <div class="relative w-16 h-16 redeven-flower-icon-breathe">
            <div class="w-full h-full rounded-full bg-gradient-to-br from-primary/15 to-amber-500/10 flex items-center justify-center shadow-sm redeven-flower-icon-spin">
              <FlowerIcon class="w-9 h-9 text-primary" />
            </div>
          </div>
        </div>

        <h2 class="text-xl font-semibold text-foreground mb-3">
          Hello! I'm Flower
        </h2>
        <p class="text-sm text-muted-foreground leading-relaxed">
          I'm your AI assistant. I can help you with code, files, commands, and more.
          Just type a message below or choose from the suggestions.
        </p>
      </Motion.div>

      {/* Suggestions grid */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        <For each={SUGGESTIONS}>
          {(item, i) => (
            <Motion.button
              type="button"
              onClick={() => props.onSuggestionClick(item.prompt)}
              disabled={props.disabled}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 + i() * 0.08, easing: 'ease-out' }}
              class={cn(
                'group flex items-start gap-3 p-4 rounded-xl border border-border/50',
                'bg-card/40 backdrop-blur-sm hover:bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5',
                'text-left transition-all duration-200 active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-card/40 disabled:hover:border-border/50',
              )}
            >
              <div class="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-200">
                <item.icon class="w-5 h-5 text-primary" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-foreground mb-0.5">
                  {item.title}
                </div>
                <div class="text-xs text-muted-foreground leading-relaxed">
                  {item.description}
                </div>
              </div>
            </Motion.button>
          )}
        </For>
      </div>

      {/* Keyboard hint */}
      <Motion.div
        class="mt-8 text-xs text-muted-foreground/60 flex items-center gap-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[10px] border border-border/50">Enter</kbd>
          <span>send</span>
        </span>
        <span class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[10px] border border-border/50">Shift+Enter</kbd>
          <span>newline</span>
        </span>
      </Motion.div>
    </div>
  );
};

// Message list with empty state overlay
interface MessageListWithEmptyStateProps {
  hasMessages: boolean;
  loading?: boolean;
  onSuggestionClick: (prompt: string) => void;
  disabled?: boolean;
  class?: string;
}

const MessageListWithEmptyState: Component<MessageListWithEmptyStateProps> = (props) => {
  return (
    <div class={cn('relative flex-1 min-h-0', props.class)}>
      <Show when={props.hasMessages}>
        <VirtualMessageList class="h-full" />
      </Show>
      <Show when={!props.hasMessages && !props.loading}>
        <EmptyChat
          onSuggestionClick={props.onSuggestionClick}
          disabled={props.disabled}
        />
      </Show>
    </div>
  );
};

/**
 * AI chat page — renders only the chat area (header + messages + input).
 * The thread sidebar is managed by Shell's native sidebar via AIChatSidebar.
 */
export function EnvAIPage() {
  const env = useEnvContext();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notify = useNotification();
  const ai = useAIChatContext();

  const [renameOpen, setRenameOpen] = createSignal(false);
  const [renameTitle, setRenameTitle] = createSignal('');
  const [renaming, setRenaming] = createSignal(false);

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteForce, setDeleteForce] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const [messagesLoading, setMessagesLoading] = createSignal(false);
  const [todosLoading, setTodosLoading] = createSignal(false);
  const [todosError, setTodosError] = createSignal('');
  const [threadTodos, setThreadTodos] = createSignal<ThreadTodosView | null>(null);
  const [threadSubagentsById, setThreadSubagentsById] = createSignal<Record<string, SubagentView>>({});
  const [hasMessages, setHasMessages] = createSignal(false);
  // Turns true immediately after send to keep instant feedback before run state events arrive.
  const [sendPending, setSendPending] = createSignal(false);
  const [executionMode, setExecutionMode] = createSignal<ExecutionMode>(readPersistedExecutionMode());

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);
  const [chatInputApi, setChatInputApi] = createSignal<AIChatInputApi | null>(null);
  let queuedAskFlowerIntents: AskFlowerIntent[] = [];

  // Working dir (draft-only; locked after thread creation)
  const [homePath, setHomePath] = createSignal<string | undefined>(undefined);
  const [workingDirPickerOpen, setWorkingDirPickerOpen] = createSignal(false);
  const [workingDirFiles, setWorkingDirFiles] = createSignal<FileItem[]>([]);
  const [workingDirEditOpen, setWorkingDirEditOpen] = createSignal(false);
  const [workingDirEditValue, setWorkingDirEditValue] = createSignal('');
  const [workingDirEditError, setWorkingDirEditError] = createSignal<string | null>(null);
  const [workingDirEditSaving, setWorkingDirEditSaving] = createSignal(false);
  let workingDirCache: DirCache = new Map();

  const FOLLOW_BOTTOM_THRESHOLD_PX = 24;
  let autoFollowEnabled = true;
  let followScrollRafPending = false;
  let scrollerListenerEl: HTMLElement | null = null;
  let scrollerListenerCleanup: (() => void) | null = null;
  let draftWorkingDirInitializedForHome = false;

  createEffect(() => {
    if (!protocol.client()) return;
    void (async () => {
      try {
        const resp = await rpc.fs.getHome();
        const home = String(resp?.path ?? '').trim();
        if (home) setHomePath(home);
      } catch {
        // ignore
      }
    })();
  });

  const validateWorkingDirSilently = async (workingDir: string): Promise<string> => {
    const value = String(workingDir ?? '').trim();
    if (!value) return '';
    try {
      const resp = await fetchGatewayJSON<Readonly<{ working_dir: string }>>('/_redeven_proxy/api/ai/validate_working_dir', {
        method: 'POST',
        body: JSON.stringify({ working_dir: value }),
      });
      return String(resp?.working_dir ?? '').trim();
    } catch {
      return '';
    }
  };

  createEffect(() => {
    env.env_id();
    draftWorkingDirInitializedForHome = false;
  });

  createEffect(() => {
    if (draftWorkingDirInitializedForHome) return;
    if (protocol.status() !== 'connected' || !ai.aiEnabled() || !canRWXReady()) return;

    const root = normalizeAskFlowerAbsolutePath(String(homePath() ?? '').trim());
    if (!root) return;

    draftWorkingDirInitializedForHome = true;
    const currentRaw = String(ai.draftWorkingDir() ?? '').trim();
    if (!currentRaw) {
      ai.setDraftWorkingDir(root);
      return;
    }

    const normalizedCurrent = normalizeAskFlowerAbsolutePath(currentRaw);
    const currentCandidate = normalizedCurrent || currentRaw;
    void (async () => {
      const validCurrent = await validateWorkingDirSilently(currentCandidate);
      if (validCurrent) {
        if (validCurrent !== currentRaw) {
          ai.setDraftWorkingDir(validCurrent);
        }
        return;
      }

      const legacyCandidate = virtualToRealPath(currentRaw, root);
      if (legacyCandidate && legacyCandidate !== currentRaw) {
        const validLegacy = await validateWorkingDirSilently(legacyCandidate);
        if (validLegacy) {
          ai.setDraftWorkingDir(validLegacy);
          return;
        }
      }

      ai.setDraftWorkingDir(root);
    })();
  });

  const getMessageListScroller = () =>
    document.querySelector<HTMLElement>('.chat-message-list-scroll') ??
    document.querySelector<HTMLElement>('.chat-message-list');

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX;

  const enableAutoFollow = () => {
    autoFollowEnabled = true;
  };

  const ensureMessageListScrollerListener = () => {
    const el = getMessageListScroller();
    if (!el) return null;
    if (el === scrollerListenerEl) return el;

    scrollerListenerCleanup?.();
    scrollerListenerEl = el;

    let lastScrollTop = el.scrollTop;
    const onScroll = () => {
      const nextScrollTop = el.scrollTop;
      const prevScrollTop = lastScrollTop;
      lastScrollTop = nextScrollTop;

      if (isNearBottom(el)) {
        autoFollowEnabled = true;
        return;
      }

      // Only disable auto-follow when the user scrolls up (away from the bottom).
      if (nextScrollTop < prevScrollTop) {
        autoFollowEnabled = false;
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    scrollerListenerCleanup = () => {
      el.removeEventListener('scroll', onScroll);
    };

    autoFollowEnabled = isNearBottom(el);
    return el;
  };

  onCleanup(() => {
    scrollerListenerCleanup?.();
    scrollerListenerCleanup = null;
    scrollerListenerEl = null;
  });

  const forceScrollToLatest = () => {
    const scrollBottom = () => {
      const el = ensureMessageListScrollerListener();
      if (!el) return false;
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      return true;
    };

    if (scrollBottom()) return;
    requestAnimationFrame(() => {
      if (scrollBottom()) return;
      requestAnimationFrame(() => {
        void scrollBottom();
      });
    });
  };

  const scheduleFollowScrollToLatest = () => {
    ensureMessageListScrollerListener();

    if (!autoFollowEnabled || followScrollRafPending) {
      return;
    }

    followScrollRafPending = true;
    requestAnimationFrame(() => {
      followScrollRafPending = false;
      if (!autoFollowEnabled) return;
      forceScrollToLatest();
    });
  };

  createEffect(() => {
    if (!chatReady()) return;
    hasMessages();
    requestAnimationFrame(() => {
      ensureMessageListScrollerListener();
    });
  });

  let lastMessagesReq = 0;
  let lastTodosReq = 0;
  let skipNextThreadLoad = false;
  let activeTranscriptThreadId = '';
  let activeTranscriptCursor = 0; // max transcript_messages.id seen for the active thread
  let activeTranscriptBaselineLoaded = false;
  let activeRealtimeEventSeq = 0;
  let activeSnapshotReqSeq = 0;
  const failureNotifiedRuns = new Set<string>();
  const [runPhaseLabel, setRunPhaseLabel] = createSignal('Working');
  const setThreadTodosIfChanged = (next: ThreadTodosView | null): void => {
    if (!next) {
      if (threadTodos() !== null) {
        setThreadTodos(null);
      }
      return;
    }
    const prev = threadTodos();
    if (prev && prev.version === next.version && prev.updated_at_unix_ms === next.updated_at_unix_ms) {
      return;
    }
    setThreadTodos(next);
  };
  const resetThreadSubagents = (): void => {
    setThreadSubagentsById({});
  };
  const rebuildSubagentsFromMessages = (messages: Message[]): void => {
    const normalizeSubagentHistory = (raw: any): Array<{ role: 'user' | 'assistant' | 'system'; text: string }> => {
      if (!Array.isArray(raw)) return [];
      const history: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> = [];
      for (const item of raw) {
        const rec = item && typeof item === 'object' && !Array.isArray(item) ? item as any : null;
        if (!rec) continue;
        const roleRaw = String(rec.role ?? '').trim().toLowerCase();
        const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system'
          ? roleRaw
          : '';
        const text = String(rec.text ?? '').trim();
        if (!role || !text) continue;
        history.push({
          role,
          text,
        });
      }
      return history;
    };
    const nextMap: Record<string, SubagentView> = {};
    const mergeIntoMap = (incoming: SubagentView | null, fallbackUpdatedAt = 0): void => {
      if (!incoming || !incoming.subagentId) return;
      const normalized: SubagentView = incoming.updatedAtUnixMs > 0
        ? incoming
        : {
          ...incoming,
          updatedAtUnixMs: Math.max(0, Number(fallbackUpdatedAt || 0)),
        };
      const merged = mergeSubagentEventsByTimestamp(nextMap[normalized.subagentId] ?? null, normalized);
      if (merged) {
        nextMap[normalized.subagentId] = merged;
      }
    };
    const emptySubagentView = (subagentId: string, fallbackUpdatedAt = 0): SubagentView => ({
      subagentId,
      taskId: '',
      agentType: '',
      triggerReason: '',
      status: 'unknown',
      summary: '',
      evidenceRefs: [],
      keyFiles: [],
      openRisks: [],
      nextActions: [],
      history: [],
      stats: {
        steps: 0,
        toolCalls: 0,
        tokens: 0,
        elapsedMs: 0,
        outcome: '',
      },
      updatedAtUnixMs: Math.max(0, Number(fallbackUpdatedAt || 0)),
      error: undefined,
    });
    const walkBlocks = (blocks: any[], messageTimestamp: number): void => {
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const blockType = String((block as any).type ?? '').trim().toLowerCase();
        if (blockType === 'subagent') {
          const candidate = block as any;
          const subagentId = String(candidate.subagentId ?? '').trim();
          if (!subagentId) continue;
          const view: SubagentView = {
            subagentId,
            taskId: String(candidate.taskId ?? '').trim(),
            agentType: String(candidate.agentType ?? '').trim(),
            triggerReason: String(candidate.triggerReason ?? '').trim(),
            status: normalizeSubagentStatus(candidate.status),
            summary: String(candidate.summary ?? '').trim(),
            evidenceRefs: Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [],
            keyFiles: Array.isArray(candidate.keyFiles) ? candidate.keyFiles : [],
            openRisks: Array.isArray(candidate.openRisks) ? candidate.openRisks : [],
            nextActions: Array.isArray(candidate.nextActions) ? candidate.nextActions : [],
            history: normalizeSubagentHistory(candidate.history),
            stats: candidate.stats ?? {
              steps: 0,
              toolCalls: 0,
              tokens: 0,
              elapsedMs: 0,
              outcome: '',
            },
            updatedAtUnixMs: Math.max(0, Number(candidate.updatedAtUnixMs ?? 0) || messageTimestamp || 0),
            error: String(candidate.error ?? '').trim() || undefined,
          };
          mergeIntoMap(view, messageTimestamp);
        } else if (blockType === 'tool-call') {
          const toolBlock = block as any;
          const toolName = String(toolBlock.toolName ?? '').trim();
          const toolStatus = String(toolBlock.status ?? '').trim().toLowerCase();
          const args = toolBlock.args && typeof toolBlock.args === 'object' && !Array.isArray(toolBlock.args) ? toolBlock.args : {};
          const result = toolBlock.result && typeof toolBlock.result === 'object' && !Array.isArray(toolBlock.result) ? toolBlock.result : {};

          if (toolName === 'delegate_task') {
            const view = mapSubagentPayloadSnakeToCamel({
              ...result,
              agent_type: (result as any).agent_type ?? (args as any).agent_type,
              trigger_reason: (result as any).trigger_reason ?? (args as any).trigger_reason,
            });
            mergeIntoMap(view, messageTimestamp);
          } else if (toolName === 'wait_subagents' && toolStatus === 'success') {
            const views = extractSubagentViewsFromWaitResult(result);
            views.forEach((item) => mergeIntoMap(item, messageTimestamp));
          } else if (toolName === 'subagents' && toolStatus === 'success') {
            const action = String((args as any).action ?? (result as any).action ?? '').trim().toLowerCase();
            if (action === 'inspect') {
              mergeIntoMap(mapSubagentPayloadSnakeToCamel((result as any).item), messageTimestamp);
            } else if (action === 'steer' || action === 'terminate') {
              mergeIntoMap(mapSubagentPayloadSnakeToCamel((result as any).snapshot), messageTimestamp);
            } else if (action === 'terminate_all') {
              const ids = Array.isArray((result as any).affected_ids) ? ((result as any).affected_ids as unknown[]) : [];
              ids.forEach((rawID) => {
                const id = String(rawID ?? '').trim();
                if (!id) return;
                const prev = nextMap[id] ?? emptySubagentView(id, messageTimestamp);
                mergeIntoMap({
                  ...prev,
                  status: 'canceled',
                  updatedAtUnixMs: Math.max(prev.updatedAtUnixMs, messageTimestamp),
                }, messageTimestamp);
              });
            }
          }
        }
        const children = Array.isArray((block as any).children) ? ((block as any).children as any[]) : [];
        if (children.length > 0) walkBlocks(children, messageTimestamp);
      }
    };
    for (const message of messages) {
      const messageTimestamp = Math.max(0, Number((message as any)?.timestamp ?? 0) || 0);
      const blocks = Array.isArray((message as any)?.blocks) ? ((message as any).blocks as any[]) : [];
      walkBlocks(blocks, messageTimestamp);
    }
    setThreadSubagentsById(nextMap);

    const syncSubagentBlocksWithLatest = (inputMessages: Message[]): Message[] | null => {
      let changed = false;
      const patchBlocks = (blocks: any[]): any[] => {
        let blockChanged = false;
        const nextBlocks = blocks.map((block) => {
          if (!block || typeof block !== 'object') return block;
          let nextBlock = block;
          const blockType = String((block as any).type ?? '').trim().toLowerCase();
          if (blockType === 'subagent') {
            const subagentId = String((block as any).subagentId ?? '').trim();
            const latest = nextMap[subagentId];
            if (latest) {
              const latestStatus = normalizeSubagentStatus(latest.status);
              const latestError = String(latest.error ?? '').trim();
              const currentStatus = normalizeSubagentStatus((block as any).status);
              const currentError = String((block as any).error ?? '').trim();
              const currentUpdatedAt = Math.max(0, Number((block as any).updatedAtUnixMs ?? 0) || 0);
              const same =
                currentStatus === latestStatus &&
                String((block as any).summary ?? '').trim() === latest.summary &&
                String((block as any).agentType ?? '').trim() === latest.agentType &&
                String((block as any).triggerReason ?? '').trim() === latest.triggerReason &&
                String((block as any).taskId ?? '').trim() === latest.taskId &&
                currentError === latestError &&
                currentUpdatedAt === latest.updatedAtUnixMs &&
                JSON.stringify((block as any).evidenceRefs ?? []) === JSON.stringify(latest.evidenceRefs) &&
                JSON.stringify((block as any).keyFiles ?? []) === JSON.stringify(latest.keyFiles) &&
                JSON.stringify((block as any).openRisks ?? []) === JSON.stringify(latest.openRisks) &&
                JSON.stringify((block as any).nextActions ?? []) === JSON.stringify(latest.nextActions) &&
                JSON.stringify((block as any).history ?? []) === JSON.stringify(latest.history) &&
                JSON.stringify((block as any).stats ?? {}) === JSON.stringify(latest.stats);
              if (!same) {
                nextBlock = {
                  ...(block as any),
                  subagentId: latest.subagentId,
                  taskId: latest.taskId,
                  agentType: latest.agentType,
                  triggerReason: latest.triggerReason,
                  status: latestStatus,
                  summary: latest.summary,
                  evidenceRefs: latest.evidenceRefs,
                  keyFiles: latest.keyFiles,
                  openRisks: latest.openRisks,
                  nextActions: latest.nextActions,
                  history: latest.history,
                  stats: latest.stats,
                  updatedAtUnixMs: latest.updatedAtUnixMs,
                  error: latest.error,
                };
                blockChanged = true;
              }
            }
          }
          const children = Array.isArray((nextBlock as any).children) ? ((nextBlock as any).children as any[]) : [];
          if (children.length > 0) {
            const patchedChildren = patchBlocks(children);
            if (patchedChildren !== children) {
              nextBlock = {
                ...(nextBlock as any),
                children: patchedChildren,
              };
              blockChanged = true;
            }
          }
          return nextBlock;
        });
        if (!blockChanged) return blocks;
        changed = true;
        return nextBlocks;
      };

      const nextMessages = inputMessages.map((message) => {
        const blocks = Array.isArray((message as any)?.blocks) ? ((message as any).blocks as any[]) : [];
        const patchedBlocks = patchBlocks(blocks);
        if (patchedBlocks === blocks) return message;
        return {
          ...message,
          blocks: patchedBlocks,
        };
      });
      if (!changed) return null;
      return nextMessages;
    };

    const patchedMessages = syncSubagentBlocksWithLatest(messages);
    if (patchedMessages && chat) {
      chat.setMessages(patchedMessages);
    }
  };
  const activeThreadTodos = createMemo(() => threadTodos()?.todos ?? []);
  const unresolvedTodoCount = createMemo(() =>
    activeThreadTodos().filter((item) => item.status === 'pending' || item.status === 'in_progress').length,
  );
  const activeThreadSubagents = createMemo(() =>
    Object.values(threadSubagentsById()).sort((a, b) => b.updatedAtUnixMs - a.updatedAtUnixMs),
  );
  const subagentsUpdatedLabel = createMemo(() => {
    const latest = activeThreadSubagents()[0];
    if (!latest || latest.updatedAtUnixMs <= 0) return '';
    const date = new Date(latest.updatedAtUnixMs);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });
  const todoUpdatedLabel = createMemo(() => {
    const updatedAt = Number(threadTodos()?.updated_at_unix_ms ?? 0);
    if (!updatedAt) return '';
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const normalizeLifecyclePhase = (raw: unknown): string => {
    const v = String(raw ?? '').trim().toLowerCase();
    switch (v) {
      case 'planning':
      case 'start':
        return 'planning';
      case 'executing_tools':
      case 'tool_call':
      case 'tool':
        return 'executing_tools';
      case 'synthesizing':
      case 'synthesis':
        return 'synthesizing';
      case 'finalizing':
      case 'end':
      case 'finish':
      case 'ended':
        return 'finalizing';
      default:
        return '';
    }
  };

  const lifecyclePhaseLabel = (phase: string): string => {
    switch (phase) {
      case 'planning':
        return 'Planning...';
      case 'executing_tools':
        return 'Executing tools...';
      case 'synthesizing':
        return 'Synthesizing answer...';
      case 'finalizing':
        return 'Finalizing...';
      default:
        return 'Working';
    }
  };

  const activeThreadRunning = createMemo(() => ai.isThreadRunning(ai.activeThreadId()));
  const activeThreadWaitingUser = createMemo(() => {
    const status = String(ai.activeThread()?.run_status ?? '').trim().toLowerCase();
    return status === 'waiting_user';
  });
  const permissionReady = () => env.env.state === 'ready';
  const canRWX = createMemo(() => hasRWXPermissions(env.env()));
  const canRWXReady = createMemo(() => permissionReady() && canRWX());
  const canInteract = createMemo(
    () => protocol.status() === 'connected' && ai.aiEnabled() && ai.modelsReady() && canRWXReady(),
  );
  const ensureRWX = (): boolean => {
    if (!permissionReady()) {
      notify.error('Not ready', 'Loading environment permissions...');
      return false;
    }
    if (!canRWX()) {
      notify.error('Permission denied', 'Read/write/execute permission required.');
      return false;
    }
    return true;
  };
  const chatInputPlaceholder = createMemo((): string => {
    if (!ai.aiEnabled()) {
      return 'Configure AI in settings to start...';
    }
    if (!permissionReady()) {
      return 'Loading permissions...';
    }
    if (!canRWX()) {
      return 'Read/write/execute permission required to send messages.';
    }
    if (activeThreadWaitingUser()) {
      return 'Flower is waiting for your reply. Continue with details or pick the next action.';
    }
    return 'Type a message...';
  });

  const activeWorkingDir = createMemo(() => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (tid) {
      return String(ai.activeThread()?.working_dir ?? '').trim();
    }
    return String(ai.draftWorkingDir() ?? '').trim();
  });
  const workingDirLabel = createMemo(() => toUserDisplayPath(activeWorkingDir(), homePath()));
  const workingDirLocked = createMemo(() => !!String(ai.activeThreadId() ?? '').trim());
  const workingDirDisabled = createMemo(
    () =>
      !canInteract() ||
      sendPending() ||
      ai.creatingThread() ||
      !String(homePath() ?? '').trim(),
  );
  const workingDirPickerInitialPath = createMemo(() => realToVirtualPath(activeWorkingDir(), homePath()));

  const applyAskFlowerIntent = (intent: AskFlowerIntent): boolean => {
    const inputApi = chatInputApi();
    if (!inputApi) return false;

    const suggestedWorkingDirAbs = resolveSuggestedWorkingDirAbsolute({
      suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
      suggestedWorkingDirVirtual: intent.suggestedWorkingDirVirtual,
      fsRootAbs: intent.fsRootAbs,
      fallbackFsRootAbs: homePath(),
    });
    const includeSuggestedWorkingDir = workingDirLocked() && !!suggestedWorkingDirAbs;

    const draftText = buildAskFlowerDraftMarkdown({
      intent: {
        ...intent,
        suggestedWorkingDirAbs: suggestedWorkingDirAbs || undefined,
      },
      includeSuggestedWorkingDir,
    });

    if (draftText) {
      inputApi.applyDraftText(draftText, intent.mode);
    }

    if (intent.pendingAttachments.length > 0) {
      inputApi.addAttachmentFiles(intent.pendingAttachments);
    }

    if (suggestedWorkingDirAbs) {
      if (workingDirLocked()) {
        notify.info('Working directory locked', `Suggested: ${suggestedWorkingDirAbs}`);
      } else {
        ai.setDraftWorkingDir(suggestedWorkingDirAbs);
      }
    }

    if (intent.notes.length > 0) {
      notify.info('Ask Flower', intent.notes.join('\n'));
    }

    inputApi.focusInput();
    return true;
  };

  createEffect(() => {
    if (!chatInputApi()) return;
    if (queuedAskFlowerIntents.length <= 0) return;
    const queue = [...queuedAskFlowerIntents];
    queuedAskFlowerIntents = [];
    for (const intent of queue) {
      applyAskFlowerIntent(intent);
    }
  });

  const openWorkingDirEditor = () => {
    if (workingDirLocked()) return;
    setWorkingDirEditError(null);
    setWorkingDirEditValue(workingDirLabel() || activeWorkingDir() || '');
    setWorkingDirEditOpen(true);
  };

  const saveWorkingDirEditor = async () => {
    if (!ensureRWX()) return;
    if (workingDirLocked()) return;

    const root = String(homePath() ?? '').trim();
    const normalized = normalizeWorkingDirInputText(workingDirEditValue(), root);

    // Empty input: reset to default root dir.
    if (!normalized) {
      ai.setDraftWorkingDir('');
      setWorkingDirEditOpen(false);
      setWorkingDirEditError(null);
      return;
    }

    setWorkingDirEditSaving(true);
    setWorkingDirEditError(null);
    try {
      const resp = await fetchGatewayJSON<Readonly<{ working_dir: string }>>('/_redeven_proxy/api/ai/validate_working_dir', {
        method: 'POST',
        body: JSON.stringify({ working_dir: normalized }),
      });
      const cleaned = String(resp?.working_dir ?? '').trim();
      if (!cleaned) throw new Error('Invalid working directory');
      ai.setDraftWorkingDir(cleaned);
      setWorkingDirEditOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setWorkingDirEditError(msg || 'Request failed.');
    } finally {
      setWorkingDirEditSaving(false);
    }
  };

  const loadWorkingDirRoot = async () => {
    if (!protocol.client()) return;
    const p = '/';
    if (workingDirCache.has(p)) {
      setWorkingDirFiles(workingDirCache.get(p)!);
      return;
    }
    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      const entries = resp?.entries ?? [];
      const items = sortFileItems(
        entries
          .filter((e) => !!e?.isDirectory)
          .map((e) => toFolderFileItem(e as FsFileInfo)),
      );
      workingDirCache.set(p, items);
      setWorkingDirFiles(items);
    } catch {
      // ignore
    }
  };

  const loadWorkingDirDir = async (path: string) => {
    if (!protocol.client()) return;
    const p = normalizeVirtualPath(path);
    if (workingDirCache.has(p)) {
      setWorkingDirFiles((prev) => withChildren(prev, p, workingDirCache.get(p)!));
      return;
    }
    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      const entries = resp?.entries ?? [];
      const items = sortFileItems(
        entries
          .filter((e) => !!e?.isDirectory)
          .map((e) => toFolderFileItem(e as FsFileInfo)),
      );
      workingDirCache.set(p, items);
      setWorkingDirFiles((prev) => withChildren(prev, p, items));
    } catch {
      // ignore
    }
  };

  const handleWorkingDirExpand = (path: string) => {
    const p = normalizeVirtualPath(path);
    if (p === '/') {
      void loadWorkingDirRoot();
      return;
    }
    void loadWorkingDirDir(p);
  };

  createEffect(() => {
    if (!workingDirPickerOpen()) return;
    if (workingDirFiles().length > 0) return;
    void loadWorkingDirRoot();
  });

  const updateExecutionMode = (nextMode: ExecutionMode) => {
    const next = normalizeExecutionMode(nextMode);
    setExecutionMode(next);
    persistExecutionMode(next);
  };

  const isTerminalRunStatus = (status: string) =>
    status === 'success' || status === 'failed' || status === 'canceled' || status === 'timed_out' || status === 'waiting_user';

  const normalizeMessageID = (m: any): string => String(m?.id ?? '').trim();

  const resetActiveTranscriptCursor = (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    activeTranscriptThreadId = tid;
    activeTranscriptCursor = 0;
    activeTranscriptBaselineLoaded = false;
    activeRealtimeEventSeq = 0;
    // Invalidate in-flight active snapshot requests when switching threads.
    activeSnapshotReqSeq += 1;
  };

  const upsertMessageById = (existing: Message[], next: Message): Message[] => {
    const id = normalizeMessageID(next);
    if (!id) return existing;
    const idx = existing.findIndex((m) => normalizeMessageID(m) === id);
    if (idx === -1) return [...existing, next];
    const out = existing.slice();
    out[idx] = next;
    return out;
  };

  const mergeBaselineTranscript = (existing: Message[], loaded: Message[]): Message[] => {
    const loadedByID = new Map<string, Message>();
    const loadedOrder: string[] = [];
    loaded.forEach((m) => {
      const id = normalizeMessageID(m);
      if (!id || loadedByID.has(id)) return;
      loadedByID.set(id, m);
      loadedOrder.push(id);
    });

    const existingByID = new Map<string, Message>();
    const existingOrder: string[] = [];
    existing.forEach((m) => {
      const id = normalizeMessageID(m);
      if (!id || existingByID.has(id)) return;
      existingByID.set(id, m);
      existingOrder.push(id);
    });

    const out: Message[] = [];
    const seen = new Set<string>();

    loadedOrder.forEach((id) => {
      const m = loadedByID.get(id);
      if (!m) return;
      out.push(m);
      seen.add(id);
    });

    // Keep any optimistic/local-only messages that are not yet persisted.
    existingOrder.forEach((id) => {
      if (seen.has(id)) return;
      const m = existingByID.get(id);
      if (!m) return;
      out.push(m);
      seen.add(id);
    });

    return out;
  };

  const mergeDeltaTranscript = (existing: Message[], delta: Message[]): Message[] => {
    let out = existing;
    delta.forEach((m) => {
      out = upsertMessageById(out, m);
    });
    return out;
  };

  const loadThreadMessages = async (
    threadId: string,
    opts?: { scrollToBottom?: boolean; reset?: boolean },
  ): Promise<void> => {
    if (!chat) return;
    if (!canRWXReady()) return;
    const tid = String(threadId ?? '').trim();
    if (!tid) return;

    const reqNo = ++lastMessagesReq;
    setMessagesLoading(true);
    try {
      const baseline = opts?.reset === true || (opts?.reset !== false && !activeTranscriptBaselineLoaded);
      const resp = baseline
        ? await rpc.ai.listMessages({ threadId: tid, tail: true, limit: 500 })
        : await rpc.ai.listMessages({ threadId: tid, afterRowId: activeTranscriptCursor, limit: 500 });
      if (reqNo !== lastMessagesReq) return;

      const items = Array.isArray((resp as any)?.messages) ? (resp as any).messages : [];
      const loaded = items
        .map((it: any) => decorateMessageBlocks((it?.messageJson ?? it?.message_json) as Message))
        .filter((m: any) => !!String(m?.id ?? '').trim());

      const isActiveTid = tid === String(ai.activeThreadId() ?? '').trim();
      if (!isActiveTid) return;

      const nextAfter = Number((resp as any)?.nextAfterRowId ?? (resp as any)?.next_after_row_id ?? 0);
      if (baseline) {
        activeTranscriptBaselineLoaded = true;
      }
      if (Number.isFinite(nextAfter) && nextAfter > 0) {
        const nextCursor = Math.floor(nextAfter);
        if (baseline) {
          activeTranscriptCursor = nextCursor;
        } else {
          activeTranscriptCursor = Math.max(activeTranscriptCursor, nextCursor);
        }
      } else if (baseline) {
        activeTranscriptCursor = 0;
      }

      const existing = chat.messages() ?? [];
      const merged = baseline ? mergeBaselineTranscript(existing, loaded) : mergeDeltaTranscript(existing, loaded);
      chat.setMessages(merged);
      rebuildSubagentsFromMessages(merged);
      setHasMessages(merged.length > 0);
      if (opts?.scrollToBottom) {
        enableAutoFollow();
        forceScrollToLatest();
      }
    } catch (e) {
      if (reqNo !== lastMessagesReq) return;
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to load chat', msg || 'Request failed.');
    } finally {
      if (reqNo === lastMessagesReq) {
        setMessagesLoading(false);
      }
    }
  };

  const loadActiveRunSnapshot = async (threadId: string): Promise<void> => {
    if (!chat) return;
    if (protocol.status() !== 'connected' || !ai.aiEnabled()) return;
    if (!canRWXReady()) return;

    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    if (tid !== String(ai.activeThreadId() ?? '').trim()) return;
    const reqSeq = ++activeSnapshotReqSeq;
    const realtimeSeqAtStart = activeRealtimeEventSeq;

    try {
      const resp = await rpc.ai.getActiveRunSnapshot({ threadId: tid });
      if (!resp.ok || !resp.messageJson) return;

      if (reqSeq !== activeSnapshotReqSeq) return;
      if (tid !== String(ai.activeThreadId() ?? '').trim()) return;
      // Realtime events that arrived during fetch are newer than this snapshot.
      if (realtimeSeqAtStart !== activeRealtimeEventSeq) return;

      const decorated = decorateMessageBlocks(resp.messageJson as Message);
      const current = chat.messages() ?? [];
      const next = upsertMessageById(current, decorated);
      chat.setMessages(next);
      rebuildSubagentsFromMessages(next);
      setHasMessages(next.length > 0);
      scheduleFollowScrollToLatest();
    } catch {
      // Best-effort: ignore snapshot failures (realtime frames / transcript refresh can self-heal).
    }
  };

  const loadThreadTodos = async (
    threadId: string,
    opts?: {
      silent?: boolean;
      notifyError?: boolean;
    },
  ): Promise<void> => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;

    const reqNo = ++lastTodosReq;
    const silent = !!opts?.silent;
    const notifyError = opts?.notifyError !== false;
    if (!silent) {
      setTodosLoading(true);
    }

    try {
      const resp = await fetchGatewayJSON<{ todos: unknown }>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/todos`,
        { method: 'GET' },
      );
      if (reqNo !== lastTodosReq) return;

      setThreadTodosIfChanged(normalizeThreadTodosView(resp.todos));
      setTodosError('');
    } catch (e) {
      if (reqNo !== lastTodosReq) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) {
        setThreadTodosIfChanged(null);
        setTodosError(msg || 'Request failed.');
      } else if (!threadTodos()) {
        setTodosError(msg || 'Request failed.');
      }
      if (!silent && notifyError) {
        notify.error('Failed to load tasks', msg || 'Request failed.');
      }
    } finally {
      if (!silent) {
        setTodosLoading(false);
      }
    }
  };

  const cancelRunForThread = async (threadId: string, opts?: { notifyOnError?: boolean }): Promise<boolean> => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return false;
    if (!ensureRWX()) return false;

    const rid = String(ai.runIdForThread(tid) ?? '').trim();
    if (!rid && !ai.isThreadRunning(tid)) {
      return true;
    }

    try {
      await rpc.ai.cancelRun({ runId: rid || undefined, threadId: rid ? undefined : tid || undefined });
      ai.bumpThreadsSeq();
      return true;
    } catch (e) {
      if (opts?.notifyOnError !== false) {
        const msg = e instanceof Error ? e.message : String(e);
        notify.error('Failed to stop run', msg || 'Request failed.');
      }
      return false;
    }
  };

  const stopRun = () => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) return;
    setRunPhaseLabel('Stopping...');
    void cancelRunForThread(tid, { notifyOnError: true }).then((ok) => {
      if (!ok) setRunPhaseLabel('Working');
    });
  };

  // Load messages when the active thread changes (or on initial selection).
  createEffect(() => {
    if (!chatReady()) return;

    if (protocol.status() !== 'connected' || !ai.aiEnabled()) {
      chat?.clearMessages();
      setHasMessages(false);
      setRunPhaseLabel('Working');
      setThreadTodos(null);
      resetThreadSubagents();
      setTodosError('');
      setTodosLoading(false);
      resetActiveTranscriptCursor('');
      return;
    }

    const tid = ai.activeThreadId();
    enableAutoFollow();

    if (!tid) {
      chat?.clearMessages();
      setHasMessages(false);
      setRunPhaseLabel('Working');
      setThreadTodos(null);
      resetThreadSubagents();
      setTodosError('');
      setTodosLoading(false);
      resetActiveTranscriptCursor('');
      return;
    }

    const tidStr = String(tid ?? '').trim();
    resetActiveTranscriptCursor(tidStr);

    // Draft -> thread promotion: keep the optimistic user message already rendered in the chat store.
    if (skipNextThreadLoad) {
      skipNextThreadLoad = false;
      const current = chat?.messages() ?? [];
      setHasMessages(current.length > 0);
    } else {
      chat?.clearMessages();
      setHasMessages(false);
    }

    setRunPhaseLabel('Working');
    setThreadTodos(null);
    resetThreadSubagents();
    setTodosError('');
    setTodosLoading(true);
    void loadThreadMessages(tid, { scrollToBottom: true, reset: true }).then(() => {
      void loadActiveRunSnapshot(tidStr);
    });
    void loadThreadTodos(tid, { silent: false, notifyError: false });
  });

  createEffect(() => {
    if (!chatReady()) return;

    const unsub = ai.onRealtimeEvent((event) => {
      const tid = String(event.threadId ?? '').trim();
      if (!tid) return;

      if (event.eventType === 'transcript_message') {
        const rowId = Math.max(0, Math.floor(Number((event as any)?.messageRowId ?? 0) || 0));
        const messageJson = (event as any)?.messageJson ?? (event as any)?.message_json;
        const messageID = String(messageJson?.id ?? '').trim();
        if (!messageID) return;

        const decorated = decorateMessageBlocks(messageJson as Message);

        const isActiveTid = tid === String(ai.activeThreadId() ?? '').trim();
        if (isActiveTid) {
          activeRealtimeEventSeq += 1;
          if (rowId > 0) {
            const shouldBackfillGap = activeTranscriptBaselineLoaded && rowId > activeTranscriptCursor + 1;
            if (shouldBackfillGap) {
              // Backfill before advancing the cursor so we don't skip missed rows.
              void loadThreadMessages(tid, { reset: false });
            }
            activeTranscriptCursor = Math.max(activeTranscriptCursor, rowId);
          }

          const current = chat?.messages() ?? [];
          const next = upsertMessageById(current, decorated);
          chat?.setMessages(next);
          rebuildSubagentsFromMessages(next);
          setHasMessages(true);
          scheduleFollowScrollToLatest();
        }
        return;
      }

      if (event.eventType === 'stream_event') {
        const streamEvent = event.streamEvent as any;
        const streamType = String(streamEvent?.type ?? '').trim().toLowerCase();
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          activeRealtimeEventSeq += 1;
        }
        if (streamType === 'lifecycle-phase') {
          if (tid === String(ai.activeThreadId() ?? '').trim()) {
            const normalizedPhase = normalizeLifecyclePhase(streamEvent?.phase ?? event.diag?.phase);
            if (normalizedPhase) {
              setRunPhaseLabel(lifecyclePhaseLabel(normalizedPhase));
            }
          }
          return;
        }
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          const block = streamEvent?.block as any;
          const blockType = String(block?.type ?? '').trim().toLowerCase();
          const toolName = String(block?.toolName ?? '').trim();
          const toolStatus = String(block?.status ?? '').trim().toLowerCase();
          if (streamType === 'block-set' && blockType === 'tool-call' && toolName === 'write_todos' && toolStatus === 'success') {
            const next = normalizeWriteTodosToolView(block?.result, block?.args);
            if (next.version > 0) {
              setThreadTodosIfChanged(next);
              setTodosError('');
            } else {
              void loadThreadTodos(tid, { silent: true, notifyError: false });
            }
          }
        }
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          chat?.handleStreamEvent(decorateStreamEvent(streamEvent) as any);
          rebuildSubagentsFromMessages(chat?.messages() ?? []);
          setHasMessages(true);
          scheduleFollowScrollToLatest();
        }
        return;
      }

      const status = String(event.runStatus ?? '').trim().toLowerCase();
      if (!isTerminalRunStatus(status)) {
        return;
      }

      if (tid === String(ai.activeThreadId() ?? '').trim()) {
        setRunPhaseLabel('Working');
      }

      const runId = String(event.runId ?? '').trim();
      const runError = String(event.runError ?? '').trim();
      if (status === 'failed' && runError && runId && !failureNotifiedRuns.has(runId)) {
        failureNotifiedRuns.add(runId);
        notify.error('AI failed', runError);
      }
    });

    onCleanup(() => {
      unsub();
    });
  });

  // When the active thread finishes a run, refresh persisted messages even if realtime terminal events were dropped.
  let lastSeenRunningTid = '';
  let lastSeenRunning = false;
  let deferredReloadTid = '';
  createEffect(() => {
    if (!chatReady()) return;
    const tid = String(ai.activeThreadId() ?? '').trim();
    const running = activeThreadRunning();

    if (!tid) {
      lastSeenRunningTid = '';
      lastSeenRunning = false;
      deferredReloadTid = '';
      return;
    }

    if (lastSeenRunningTid !== tid) {
      lastSeenRunningTid = tid;
      lastSeenRunning = running;
      deferredReloadTid = '';
      return;
    }

      if (lastSeenRunning && !running) {
        if (sendPending()) {
          deferredReloadTid = tid;
        } else {
          deferredReloadTid = '';
          // Hard refresh from persisted transcript so dropped realtime frames/tool blocks self-heal.
          void loadThreadMessages(tid, { reset: true });
        }
        void loadThreadTodos(tid, { silent: true, notifyError: false });
      } else if (!running && !sendPending() && deferredReloadTid === tid) {
        deferredReloadTid = '';
        // Hard refresh from persisted transcript so dropped realtime frames/tool blocks self-heal.
        void loadThreadMessages(tid, { reset: true });
        void loadThreadTodos(tid, { silent: true, notifyError: false });
      }

    lastSeenRunningTid = tid;
    lastSeenRunning = running;
  });

  // Context intent injection from file browser / terminal / preview.
  let lastAskFlowerIntentSeq = 0;
  createEffect(() => {
    if (!chatReady()) return;
    if (protocol.status() !== 'connected' || !ai.aiEnabled()) return;
    if (!canRWXReady()) return;

    const seq = env.askFlowerIntentSeq();
    if (!seq || seq === lastAskFlowerIntentSeq) return;
    lastAskFlowerIntentSeq = seq;

    const intent = env.askFlowerIntent();
    if (!intent) return;

    const applied = applyAskFlowerIntent(intent);
    if (!applied) {
      queuedAskFlowerIntents.push(intent);
    }
  });

  const uploadAttachment = async (file: File): Promise<string> => {
    if (!canRWXReady()) {
      throw new Error('Read/write/execute permission required.');
    }
    const form = new FormData();
    form.append('file', file);

    const resp = await fetch('/_redeven_proxy/api/ai/uploads', {
      method: 'POST',
      body: form,
      credentials: 'omit',
      cache: 'no-store',
    });

    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
    if (data?.ok === false) throw new Error(String(data?.error ?? 'Upload failed'));

    const url = String(data?.data?.url ?? '').trim();
    if (!url) throw new Error('Upload failed');
    return url;
  };

  const sendToolApproval = async (_messageId: string, toolId: string, approved: boolean) => {
    if (!ensureRWX()) return;
    const tid = String(ai.activeThreadId() ?? '').trim();
    const rid = String(ai.runIdForThread(tid) ?? '').trim();
    if (!rid) return;
    await rpc.ai.approveTool({ runId: rid, toolId, approved });
  };

  const installSharedToolCollapse = (ctx: ChatContextValue) => {
    const key = '__redeven_shared_tool_collapse_v1';
    const anyCtx = ctx as any;
    if (anyCtx[key]) return;
    anyCtx[key] = true;

    const original = ctx.toggleToolCollapse.bind(ctx);
    ctx.toggleToolCollapse = (messageId: string, toolId: string) => {
      original(messageId, toolId);

      if (protocol.status() !== 'connected' || !ai.aiEnabled()) return;
      if (!canRWXReady()) return;

      const tid = String(ai.activeThreadId() ?? '').trim();
      const mid = String(messageId ?? '').trim();
      const tidTool = String(toolId ?? '').trim();
      if (!tid || !mid || !tidTool) return;

      const msg = (ctx.messages() ?? []).find((m: any) => String(m?.id ?? '').trim() === mid);
      const blocks: any[] = Array.isArray((msg as any)?.blocks) ? ((msg as any).blocks as any[]) : [];
      const toolBlock = blocks.find((b) => b && typeof b === 'object' && b.type === 'tool-call' && String((b as any).toolId ?? '').trim() === tidTool);
      const collapsed = (toolBlock as any)?.collapsed;
      if (typeof collapsed !== 'boolean') return;

      void rpc.ai.setToolCollapsed({ threadId: tid, messageId: mid, toolId: tidTool, collapsed }).catch(() => {
        // Best-effort: ignore persistence failures (snapshot/transcript refresh can self-heal).
      });
    };
  };

  const sendUserTurn = async (content: string, attachments: Attachment[], userMessageId?: string) => {
    if (!chat) {
      notify.error('AI unavailable', 'Chat is not ready.');
      setSendPending(false);
      return;
    }
    if (!ensureRWX()) {
      setSendPending(false);
      setRunPhaseLabel('Working');
      return;
    }
    if (!ai.aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
      setSendPending(false);
      return;
    }
    if (ai.models.error) {
      const msg = ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error);
      notify.error('AI unavailable', msg || 'Failed to load models.');
      setSendPending(false);
      return;
    }

    const model = ai.selectedModel().trim();
    if (!model) {
      notify.error('Missing model', 'Please select a model.');
      setSendPending(false);
      return;
    }

    // ChatProvider already rendered the optimistic user message; ensure the message list is visible.
    // sendPending is usually raised by onWillSend, this call keeps attachment-only flows responsive.
    setHasMessages(true);
    setSendPending(true);
    setRunPhaseLabel('Planning...');
    enableAutoFollow();
    forceScrollToLatest();

    let tid = ai.activeThreadId();
    if (!tid) {
      skipNextThreadLoad = true;
      tid = await ai.ensureThreadForSend();
      if (!tid) {
        // Thread creation failed; do not leave the "preserve optimistic messages" flag armed.
        skipNextThreadLoad = false;
      }
    }
    if (!tid) {
      setSendPending(false);
      return;
    }

    const userText = String(content ?? '').trim();
    const uploaded = attachments.filter((a) => a.status === 'uploaded' && !!String(a.url ?? '').trim());
    const attIn = uploaded.map((a) => ({
      name: a.file.name,
      mimeType: a.file.type,
      url: String(a.url ?? '').trim(),
    }));
    const replyToWaitingPromptId =
      tid === String(ai.activeThreadId() ?? '').trim()
        ? String(ai.activeThreadWaitingPrompt()?.prompt_id ?? '').trim()
        : '';

    ai.markThreadPendingRun(tid);

    try {
      // Ensure the client is subscribed to thread-scoped events before sending so we don't miss
      // the initial transcript/stream frames on a new chat.
      try {
        await rpc.ai.subscribeThread({ threadId: tid });
      } catch {
        // Best-effort: sendUserTurn still persists the message and can self-heal via transcript refresh.
      }

      setRunPhaseLabel('Planning...');
      const msgID = String(userMessageId ?? '').trim();
      const baseReq = {
        threadId: tid,
        model,
        input: {
          messageId: msgID || undefined,
          text: userText,
          attachments: attIn,
        },
        options: { maxSteps: 10, mode: executionMode() },
        replyToWaitingPromptId: replyToWaitingPromptId || undefined,
      } as const;

      const expected = String(ai.runIdForThread(tid) ?? '').trim();
      let resp: Awaited<ReturnType<(typeof rpc.ai)['sendUserTurn']>>;
      try {
        resp = await rpc.ai.sendUserTurn({ ...baseReq, expectedRunId: expected || undefined });
      } catch (e) {
        const isConflict = e instanceof RpcError && e.code === 409;
        if (expected && isConflict) {
          resp = await rpc.ai.sendUserTurn(baseReq);
        } else {
          throw e;
        }
      }

      const rid = String(resp.runId ?? '').trim();
      const consumedWaitingPromptId = String(resp.consumedWaitingPromptId ?? '').trim();
      if (consumedWaitingPromptId) {
        ai.consumeWaitingPrompt(tid, consumedWaitingPromptId);
      }
      if (rid) {
        ai.confirmThreadRun(tid, rid);
      }
      ai.bumpThreadsSeq();
      if (String(resp.kind ?? '').trim().toLowerCase() === 'steer') {
        setRunPhaseLabel('Working');
      }
    } catch (e) {
      ai.clearThreadPendingRun(tid);
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('AI failed', msg || 'Request failed.');
      setRunPhaseLabel('Working');
      void loadThreadMessages(tid);
    } finally {
      setSendPending(false);
    }
  };

  let sendUserTurnQueue: Promise<void> = Promise.resolve();
  const enqueueSendUserTurn = (content: string, attachments: Attachment[], userMessageId?: string) => {
    const task = sendUserTurnQueue.then(() => sendUserTurn(content, attachments, userMessageId));
    sendUserTurnQueue = task.catch(() => {});
    return task;
  };

  const callbacks: ChatCallbacks = {
    onWillSend: (_content, _attachments, _userMessageId) => {
      // Synchronous hook: called right after ChatProvider renders the optimistic user message.
      // Raising sendPending here makes the working indicator appear in the same frame.
      if (import.meta.env.DEV) console.debug('[AI Chat] onWillSend fired at', performance.now().toFixed(1), 'ms');

      if (!canInteract()) return;
      setSendPending(true);
      setHasMessages(true);
      setRunPhaseLabel('Planning...');
      enableAutoFollow();
      forceScrollToLatest();
    },
    onSendMessage: async (content, attachments, userMessageId, _addMessage) => {
      if (protocol.status() !== 'connected') {
        notify.error('Not connected', 'Connecting to agent...');
        setSendPending(false);
        setRunPhaseLabel('Working');
        return;
      }
      if (!ensureRWX()) {
        setSendPending(false);
        setRunPhaseLabel('Working');
        return;
      }
      await enqueueSendUserTurn(content, attachments, userMessageId);
    },
    onUploadAttachment: uploadAttachment,
    onToolApproval: sendToolApproval,
  };

  const openRename = () => {
    const t = ai.activeThread();
    setRenameTitle(String(t?.title ?? ''));
    setRenameOpen(true);
  };

  const doRename = async () => {
    const tid = ai.activeThreadId();
    if (!tid) return;
    if (!ensureRWX()) return;

    setRenaming(true);
    try {
      await fetchGatewayJSON<{ thread: any }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: renameTitle().trim() }),
      });
      ai.bumpThreadsSeq();
      setRenameOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to rename chat', msg || 'Request failed.');
    } finally {
      setRenaming(false);
    }
  };

  const doDelete = async () => {
    const tid = ai.activeThreadId();
    if (!tid) return;
    if (!ensureRWX()) return;
    const force = deleteForce();

    setDeleting(true);
    try {
      const url = `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}${force ? '?force=true' : ''}`;
      const resp = await fetch(url, { method: 'DELETE', credentials: 'omit', cache: 'no-store' });
      const text = await resp.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }
      if (!resp.ok) {
        if (resp.status === 409 && !force) {
          setDeleteForce(true);
          return;
        }
        throw new Error(String(data?.error ?? `HTTP ${resp.status}`));
      }
      if (data?.ok === false) throw new Error(String(data?.error ?? 'Request failed'));

      setDeleteOpen(false);
      setDeleteForce(false);
      ai.clearActiveThreadPersistence();
      ai.enterDraftChat();
      chat?.clearMessages();
      setHasMessages(false);
      ai.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete chat', msg || 'Request failed.');
    } finally {
      setDeleting(false);
    }
  };

  // Handle suggestion click from empty state
  const handleSuggestionClick = (prompt: string) => {
    if (!canInteract()) return;
    void enqueueSendUserTurn(prompt, []);
  };

  // Keep the custom working indicator visible from send start until the run fully ends.
  const showWorkingIndicator = () => {
    if (!chatReady()) return false;
    if (!sendPending() && !activeThreadRunning()) return false;
    return true;
  };

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <ChatProvider
        config={{
          placeholder: 'Describe what you want to do...',
          assistantAvatar: `${import.meta.env.BASE_URL}flower.svg`,
          allowAttachments: canInteract(),
          maxAttachments: 5,
          maxAttachmentSize: 10 * 1024 * 1024,
        }}
        callbacks={callbacks}
      >
        <ChatCapture
          onReady={(ctx) => {
            chat = ctx;
            installSharedToolCollapse(ctx);
            setChatReady(true);
          }}
        />

        <Show
          when={permissionReady()}
          fallback={
            <div class="flex flex-col items-center justify-center h-full p-8 text-center">
              <div class="text-sm text-muted-foreground">Loading environment permissions...</div>
            </div>
          }
        >
          <Show
            when={canRWX()}
            fallback={
              <Motion.div
                class="flex flex-col items-center justify-center h-full p-8 text-center"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, easing: 'ease-out' }}
              >
                <div class="relative inline-flex items-center justify-center mb-6">
                  <div class="absolute -inset-2 rounded-2xl bg-primary/8 animate-[pulse_3s_ease-in-out_infinite]" />
                  <div class="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-amber-500/10 flex items-center justify-center border border-primary/20 shadow-sm">
                    <FlowerIcon class="w-9 h-9 text-primary" />
                  </div>
                </div>
                <div class="text-lg font-semibold text-foreground mb-2">Flower is disabled</div>
                <div class="text-sm text-muted-foreground mb-6 max-w-[360px]">
                  Read/write/execute permission required to use Flower.
                </div>
              </Motion.div>
            }
          >
            <Show
              when={ai.aiEnabled() || ai.settings.loading}
              fallback={
                // Fallback: AI is disabled and settings are not loading.
                // Further distinguish: settings error vs not configured vs not yet resolved.
                <Show
                  when={ai.settings.error}
                  fallback={
                    // No settings error: either settings are loaded but AI is not configured,
                    // or settings are still unresolved. In both cases, show a clear CTA.
                    <Motion.div
                      class="flex flex-col items-center justify-center h-full p-8 text-center"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4, easing: 'ease-out' }}
                    >
                      <div class="relative inline-flex items-center justify-center mb-6">
                        <div class="absolute -inset-2 rounded-2xl bg-primary/8 animate-[pulse_3s_ease-in-out_infinite]" />
                        <div class="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-amber-500/10 flex items-center justify-center border border-primary/20 shadow-sm">
                          <FlowerIcon class="w-9 h-9 text-primary" />
                        </div>
                      </div>
                      <div class="text-lg font-semibold text-foreground mb-2">Flower is not configured</div>
                      <div class="text-sm text-muted-foreground mb-6 max-w-[320px]">
                        Configure an AI provider in settings to start using Flower.
                      </div>
                      <Button size="md" variant="default" onClick={() => env.openSettings('ai')}>
                        <Settings class="w-4 h-4 mr-2" />
                        Open Settings
                      </Button>
                    </Motion.div>
                  }
                >
                  {/* Settings failed to load */}
                  <Motion.div
                    class="flex flex-col items-center justify-center h-full p-8 text-center"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, easing: 'ease-out' }}
                  >
                    <div class="relative inline-flex items-center justify-center mb-6">
                      <div class="relative w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center border border-error/20 shadow-sm">
                        <svg class="w-8 h-8 text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </div>
                    </div>
                    <div class="text-lg font-semibold text-foreground mb-2">Failed to load settings</div>
                    <div class="text-sm text-muted-foreground mb-6 max-w-[360px]">
                      {ai.settings.error instanceof Error ? ai.settings.error.message : String(ai.settings.error)}
                    </div>
                    <Button size="md" variant="default" onClick={() => env.openSettings('ai')}>
                      <Settings class="w-4 h-4 mr-2" />
                      Open Settings
                    </Button>
                  </Motion.div>
                </Show>
              }
            >
              {/* Chat area — sidebar is managed by Shell */}
          <div class="flex-1 min-w-0 flex flex-col h-full">
            {/* Header */}
            <div class="chat-header border-b border-border/80 bg-background/95 backdrop-blur-md max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
              <div class="chat-header-title flex items-center gap-2 min-w-0 w-full sm:w-auto">
                <span class="truncate font-medium">{ai.activeThreadTitle()}</span>
              </div>
              <div class="w-full sm:w-auto flex items-center justify-between gap-2 sm:justify-start sm:gap-1.5">
                <div class="min-w-0 flex items-center gap-1.5">
                  {/* Model selector */}
                  <Show when={ai.aiEnabled() && ai.modelOptions().length > 0}>
                    <Select
                      value={ai.selectedModel()}
                      onChange={(v) => ai.selectModel(String(v ?? '').trim())}
                      options={ai.modelOptions()}
                      placeholder="Select model..."
                      disabled={ai.models.loading || !!ai.models.error || activeThreadRunning() || !canRWXReady()}
                      class="ai-model-select-trigger min-w-[120px] max-w-[160px] sm:min-w-[140px] sm:max-w-[200px] h-7 text-[11px]"
                    />
                  </Show>

                  {/* Stop button */}
                  <Show when={activeThreadRunning()}>
                    <Tooltip content="Stop generation" placement="bottom" delay={0}>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={Stop}
                        onClick={() => stopRun()}
                        disabled={!canRWXReady()}
                        class="h-7 px-2 max-sm:w-7 max-sm:px-0 text-error border-error/30 hover:bg-error/10 hover:text-error"
                      >
                        <span class="max-sm:hidden">Stop</span>
                      </Button>
                    </Tooltip>
                  </Show>
                </div>

                <div class="shrink-0 flex items-center gap-1.5">
                  <div class="hidden sm:block w-px h-5 bg-border mx-1" />

                  {/* Rename */}
                  <Tooltip content="Rename chat" placement="bottom" delay={0}>
                    <Button
                      size="icon"
                      variant="ghost"
                      icon={Pencil}
                      onClick={() => openRename()}
                      aria-label="Rename"
                      disabled={!ai.activeThreadId() || activeThreadRunning() || !canRWXReady()}
                      class="w-7 h-7"
                    />
                  </Tooltip>

                  {/* Delete */}
                  <Tooltip content="Delete chat" placement="bottom" delay={0}>
                    <Button
                      size="icon"
                      variant="ghost"
                      icon={Trash}
                      onClick={() => {
                        setDeleteForce(activeThreadRunning());
                        setDeleteOpen(true);
                      }}
                      aria-label="Delete"
                      disabled={!ai.activeThreadId() || !canRWXReady()}
                      class="w-7 h-7 text-muted-foreground hover:text-error hover:bg-error/10"
                    />
                  </Tooltip>

                  {/* Settings button */}
                  <Tooltip content="AI Settings" placement="bottom" delay={0}>
                    <Button
                      size="icon"
                      variant="ghost"
                      icon={Settings}
                      onClick={() => env.openSettings('ai')}
                      aria-label="Settings"
                      class="w-7 h-7"
                    />
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Error banner: Settings unavailable */}
            <Show when={ai.settings.error}>
              <div class="mx-3 mt-3 px-4 py-3 text-xs rounded-xl shadow-sm bg-error/5 border border-error/20">
                <div class="flex items-center gap-2 font-medium text-error">
                  <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Settings are not available
                </div>
                <div class="mt-1 text-muted-foreground pl-6">
                  {ai.settings.error instanceof Error ? ai.settings.error.message : String(ai.settings.error)}
                </div>
              </div>
            </Show>

            {/* Error banner: Models unavailable */}
            <Show when={ai.models.error && ai.aiEnabled()}>
              <div class="mx-3 mt-3 px-4 py-3 text-xs rounded-xl shadow-sm bg-error/5 border border-error/20">
                <div class="flex items-center gap-2 font-medium text-error">
                  <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  AI is not available
                </div>
                <div class="mt-1 text-muted-foreground pl-6">
                  {ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error)}
                </div>
              </div>
            </Show>

            {/* Message list with empty state */}
            <MessageListWithEmptyState
              hasMessages={hasMessages()}
              loading={messagesLoading()}
              onSuggestionClick={handleSuggestionClick}
              disabled={!canInteract()}
              class="flex-1 min-h-0"
            />

            {/* Keep indicator mounted and toggle visibility via display to avoid mount/unmount jitter. */}
            <div style={{ display: showWorkingIndicator() ? '' : 'none' }}>
              <ChatWorkingIndicator phaseLabel={runPhaseLabel()} />
            </div>

            {/* Toolbar: Tasks chip + Execution mode toggle */}
            <div class="relative px-3 pt-1 pb-1.5 chat-toolbar-separator">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="min-w-0 flex items-center gap-1.5 flex-wrap">
                  <Show when={ai.activeThreadId() && activeThreadTodos().length > 0}>
                    <CompactTasksSummary
                      executionMode={executionMode()}
                      todos={activeThreadTodos()}
                      unresolvedCount={unresolvedTodoCount()}
                      todosLoading={todosLoading()}
                      todosError={todosError()}
                      todosView={threadTodos()}
                      todoUpdatedLabel={todoUpdatedLabel()}
                    />
                  </Show>
                  <Show when={ai.activeThreadId() && activeThreadSubagents().length > 0}>
                    <CompactSubagentsSummary
                      subagents={activeThreadSubagents()}
                      updatedLabel={subagentsUpdatedLabel()}
                    />
                  </Show>
                  <Show when={!ai.activeThreadId() || (activeThreadTodos().length === 0 && activeThreadSubagents().length === 0)}>
                    <span class="text-[11px] text-muted-foreground">Execution mode</span>
                  </Show>
                </div>
                <ExecutionModeToggle
                  value={executionMode()}
                  disabled={activeThreadRunning()}
                  onChange={(mode) => updateExecutionMode(mode)}
                />
              </div>
            </div>

            {/* Input area */}
            <DirectoryPicker
              open={workingDirPickerOpen()}
              onOpenChange={(open) => {
                if (!open) setWorkingDirPickerOpen(false);
              }}
              files={workingDirFiles()}
              initialPath={workingDirPickerInitialPath()}
              homeLabel="Home"
              homePath={homePath()}
              title="Select Working Directory"
              confirmText="Select"
              onExpand={handleWorkingDirExpand}
              onSelect={(virtualPath) => {
                if (workingDirLocked()) return;
                const realPath = virtualToRealPath(virtualPath, homePath());
                ai.setDraftWorkingDir(realPath);
              }}
            />

            <Dialog
              open={workingDirEditOpen()}
              onOpenChange={(open) => {
                if (!open) {
                  setWorkingDirEditOpen(false);
                  setWorkingDirEditError(null);
                  setWorkingDirEditValue('');
                  return;
                }
                setWorkingDirEditOpen(true);
              }}
              title="Edit Working Directory"
              footer={
                <div class="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setWorkingDirEditOpen(false)} disabled={workingDirEditSaving()}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => void saveWorkingDirEditor()}
                    disabled={workingDirEditSaving() || workingDirLocked()}
                  >
                    <Show when={workingDirEditSaving()}>
                      <span class="mr-1">
                        <InlineButtonSnakeLoading />
                      </span>
                    </Show>
                    Save
                  </Button>
                </div>
              }
            >
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-medium mb-1.5">Path</label>
                  <Input
                    value={workingDirEditValue()}
                    onInput={(e) => setWorkingDirEditValue(e.currentTarget.value)}
                    placeholder="/path/to/dir"
                    size="sm"
                    class="w-full"
                  />
                  <p class="text-[11px] text-muted-foreground mt-1.5">
                    Use an absolute path. <span class="font-mono">~</span> maps to Home (<span class="font-mono">root_dir</span>). Relative paths are resolved against Home.
                  </p>
                  <Show when={workingDirEditError()}>
                    <p class="text-[11px] text-error mt-1.5">{workingDirEditError()}</p>
                  </Show>
                </div>
              </div>
            </Dialog>

            <AIChatInput
              disabled={!canInteract()}
              placeholder={chatInputPlaceholder()}
              workingDirLabel={workingDirLabel() || 'Working dir'}
              workingDirTitle={activeWorkingDir() || workingDirLabel() || 'Working dir'}
              workingDirLocked={workingDirLocked()}
              workingDirDisabled={workingDirDisabled()}
              onPickWorkingDir={() => setWorkingDirPickerOpen(true)}
              onEditWorkingDir={() => openWorkingDirEditor()}
              onApiReady={setChatInputApi}
            />
          </div>
        </Show>
          </Show>
        </Show>

        {/* Rename dialog */}
        <Dialog
          open={renameOpen()}
          onOpenChange={(open) => {
            if (!open) {
              setRenameOpen(false);
              setRenameTitle('');
              return;
            }
            setRenameOpen(true);
          }}
          title="Rename Chat"
          footer={
            <div class="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setRenameOpen(false)} disabled={renaming()}>
                Cancel
              </Button>
              <Button size="sm" variant="default" onClick={() => void doRename()} disabled={renaming()}>
                <Show when={renaming()}>
                  <span class="mr-1">
                    <InlineButtonSnakeLoading />
                  </span>
                </Show>
                Save
              </Button>
            </div>
          }
        >
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium mb-1.5">Title</label>
              <Input
                value={renameTitle()}
                onInput={(e) => setRenameTitle(e.currentTarget.value)}
                placeholder="New chat"
                size="sm"
                class="w-full"
              />
              <p class="text-[11px] text-muted-foreground mt-1.5">
                This title is visible to everyone in this environment.
              </p>
            </div>
          </div>
        </Dialog>

        {/* Delete confirmation dialog */}
        <ConfirmDialog
          open={deleteOpen()}
          onOpenChange={(open) => {
            setDeleteOpen(open);
            if (!open) setDeleteForce(false);
          }}
          title="Delete Chat"
          confirmText={deleteForce() ? 'Force Delete' : 'Delete'}
          variant="destructive"
          loading={deleting()}
          onConfirm={() => void doDelete()}
        >
          <div class="space-y-2">
            <p class="text-sm">
              Delete <span class="font-semibold">"{ai.activeThreadTitle()}"</span>?
            </p>
            <Show when={deleteForce()}>
              <p class="text-xs text-muted-foreground">
                This chat is running. Deleting will stop the run and delete the thread.
              </p>
            </Show>
            <p class="text-xs text-muted-foreground">This cannot be undone.</p>
          </div>
        </ConfirmDialog>
      </ChatProvider>

      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
      <LoadingOverlay visible={ai.settings.loading && protocol.status() === 'connected'} message="Loading settings..." />
      <LoadingOverlay visible={ai.models.loading && ai.aiEnabled()} message="Loading models..." />
      {/* Show global loading only on first load (no cached data); hide it for background refreshes. */}
      <LoadingOverlay visible={ai.threads.loading && ai.aiEnabled() && !ai.threads()} message="Loading chats..." />
      {/* Do not show message loading overlay while a run is active to avoid flicker. */}
      <LoadingOverlay visible={messagesLoading() && ai.aiEnabled() && !activeThreadRunning()} message="Loading chat..." />
    </div>
  );
}
