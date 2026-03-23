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
import { Button, ConfirmDialog, Dialog, DirectoryPicker, Dropdown, Input, Select, Tooltip, type DropdownItem } from '@floegence/floe-webapp-core/ui';
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
  type MessageRole,
} from '../chat';
import { RpcError, useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';
import { useAIChatContext } from './AIChatContext';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { fetchGatewayJSON, prepareGatewayRequestInit, uploadGatewayFile } from '../services/gatewayApi';
import { decorateMessageBlocks, decorateStreamEvent } from './aiBlockPresentation';
import {
  extractSubagentViewsFromWaitResult,
  mergeContextCompactionEvents,
  mapSubagentPayloadSnakeToCamel,
  normalizeContextCompactionEvent,
  normalizeContextUsage,
  mergeSubagentEventsByTimestamp,
  normalizeSubagentStatus,
  normalizeThreadTodosView,
  normalizeWriteTodosToolView,
  todoStatusBadgeClass,
  todoStatusLabel,
  type ContextCompactionEventView,
  type ContextUsageView,
  type SubagentView,
  type ThreadTodoItem,
  type ThreadTodosView,
} from './aiDataNormalizers';
import { hasRWXPermissions } from './aiPermissions';
import type { AskFlowerIntent } from './askFlowerIntent';
import { buildAskFlowerDraftMarkdown, mergeAskFlowerDraft } from '../utils/askFlowerContextTemplate';
import { createClientId } from '../utils/clientId';
import {
  normalizeAbsolutePath as normalizeAskFlowerAbsolutePath,
  resolveSuggestedWorkingDirAbsolute,
  toHomeDisplayPath,
} from '../utils/askFlowerPath';
import { readLiveTextValue, syncLiveTextValue } from '../utils/liveTextValue';
import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';
import { readUIStorageItem, writeUIStorageItem } from '../services/uiStorage';
import { ChatFileBrowserFAB } from '../widgets/ChatFileBrowserFAB';
import { FlowerMessageRunIndicator } from '../widgets/FlowerMessageRunIndicator';
import {
  replacePickerChildren,
  sortPickerFolderItems,
  toPickerFolderItem,
  toPickerTreeAbsolutePath,
  toPickerTreePath,
} from '../utils/directoryPickerTree';
import {
  composeFollowupOrder,
  composerSnapshotHasContent,
  moveFollowupByDelta,
  reorderFollowupsByIDs,
  reindexFollowups,
  shouldAutoloadRecoveredFollowup,
  type ComposerDraftSnapshot,
  type FollowupItem,
  type FollowupLane,
  type ListFollowupsResponse,
} from './followupsState';

type DirCache = Map<string, FileItem[]>;

type ExecutionMode = 'act' | 'plan';

const EXECUTION_MODE_STORAGE_KEY = 'redeven_ai_execution_mode';

function normalizeExecutionMode(raw: unknown): ExecutionMode {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === 'plan' ? 'plan' : 'act';
}

function readPersistedExecutionMode(): ExecutionMode {
  return normalizeExecutionMode(readUIStorageItem(EXECUTION_MODE_STORAGE_KEY));
}

function persistExecutionMode(mode: ExecutionMode): void {
  writeUIStorageItem(EXECUTION_MODE_STORAGE_KEY, normalizeExecutionMode(mode));
}

const CONTEXT_TIMELINE_WINDOW_LIMIT = 200;
const RUN_CONTEXT_EVENTS_PAGE_LIMIT = 200;
const RUN_CONTEXT_EVENTS_MAX_PAGES = 12;
const ACTIVE_RUN_SNAPSHOT_RECOVERY_DELAY_MS = 300;

type RunEventResponseItem = {
  event_id?: number;
  run_id?: string;
  thread_id?: string;
  stream_kind?: string;
  event_type?: string;
  at_unix_ms?: number;
  payload?: unknown;
};

type RunContextEventsResponse = {
  events?: RunEventResponseItem[];
  next_cursor?: number;
  has_more?: boolean;
};

type SendIntent = 'default' | 'queue_after_waiting_user';
type AIChatInputDraftSnapshot = ComposerDraftSnapshot<Attachment>;

type PendingDraftLoad = {
  followup: FollowupItem;
};

const queuedTurnTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function formatQueuedTurnTime(unixMs: number | null | undefined): string {
  const value = Number(unixMs ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  return queuedTurnTimeFormatter.format(new Date(value));
}

const ChatCapture: Component<{ onReady: (ctx: ChatContextValue) => void }> = (props) => {
  const ctx = useChatContext();
  createEffect(() => props.onReady(ctx));
  return null;
};

type AIChatInputApi = {
  applyDraftText: (nextText: string, mode: 'append' | 'replace') => void;
  addAttachmentFiles: (files: File[]) => void;
  replaceDraft: (nextDraft: AIChatInputDraftSnapshot) => void;
  snapshotDraft: () => AIChatInputDraftSnapshot;
  clearDraft: () => void;
  focusInput: () => void;
};

const AIChatInput: Component<{
  class?: string;
  placeholder?: string;
  disabled?: boolean;
  waitingForUser?: boolean;
  workingDirLabel?: string;
  workingDirTitle?: string;
  workingDirLocked?: boolean;
  workingDirDisabled?: boolean;
  onPickWorkingDir?: () => void;
  onSendIntent?: (intent: SendIntent) => void;
  getSendBlockReason?: (content: string, attachments: Attachment[]) => string | null;
  onApiReady?: (api: AIChatInputApi | null) => void;
}> = (props) => {
  const ctx = useChatContext();
  const notify = useNotification();
  const [text, setText] = createSignal('');
  const [isFocused, setIsFocused] = createSignal(false);
  const [isComposing, setIsComposing] = createSignal(false);
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
  const currentText = () => readLiveTextValue(textareaRef, text());
  const syncTextFromTextarea = () => syncLiveTextValue(textareaRef, setText, text());
  const hasDraftPayload = () => currentText().trim().length > 0 || attachments.attachments().length > 0;
  const sendBlockReason = () => {
    if (!hasDraftPayload()) return '';
    return String(props.getSendBlockReason?.(currentText(), attachments.attachments()) ?? '').trim();
  };

  const canSend = () =>
    hasDraftPayload() &&
    !props.disabled &&
    !sending() &&
    !attachments.hasUploading() &&
    !sendBlockReason();

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

  const focusComposer = () => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        textareaRef?.focus();
      });
      return;
    }
    textareaRef?.focus();
  };

  const snapshotDraft = (): AIChatInputDraftSnapshot => ({
    text: currentText(),
    attachments: attachments.attachments().map((attachment) => ({ ...attachment })),
  });

  const clearDraft = () => {
    setIsComposing(false);
    setText('');
    attachments.clearAttachments();
    if (textareaRef) textareaRef.style.height = 'auto';
  };

  const replaceDraft = (nextDraft: AIChatInputDraftSnapshot) => {
    setIsComposing(false);
    setText(String(nextDraft?.text ?? ''));
    attachments.replaceAttachments(Array.isArray(nextDraft?.attachments) ? nextDraft.attachments : []);
    if (textareaRef) textareaRef.style.height = 'auto';
    if (typeof requestAnimationFrame === 'function') {
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
      return;
    }
    scheduleAdjustHeight();
    focusComposer();
  };

  const handleSend = async (intent: SendIntent = 'default') => {
    if (!canSend()) return;

    setSending(true);
    const content = syncTextFromTextarea().trim();
    try {
      const upload = await attachments.uploadAll();
      if (!upload.ok) {
        const firstError = upload.failed
          .map((attachment) => String(attachment.error ?? '').trim())
          .find((message) => message.length > 0);
        notify.error('Attachment upload failed', firstError || 'Remove failed attachments and try again.');
        return;
      }

      const files = upload.attachments.filter((attachment) => attachment.status === 'uploaded');
      const restoreDraft: AIChatInputDraftSnapshot = {
        text: content,
        attachments: upload.attachments.map((attachment) => ({ ...attachment })),
      };
      props.onSendIntent?.(intent);
      clearDraft();
      try {
        await ctx.sendMessage(content, files);
      } catch {
        replaceDraft(restoreDraft);
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (shouldSubmitOnEnterKeydown({ event: e, isComposing: isComposing() })) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handlePaste = async (e: ClipboardEvent) => {
    if (!ctx.config().allowAttachments) return;
    await attachments.handlePaste(e);
  };

  const canPickWorkingDir = () => !!props.onPickWorkingDir && !props.disabled && !props.workingDirDisabled && !props.workingDirLocked;

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

    if (typeof requestAnimationFrame === 'function') {
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
      return;
    }
    scheduleAdjustHeight();
    focusComposer();
  };

  const addAttachmentFiles = (files: File[]) => {
    if (!ctx.config().allowAttachments) return;
    if (!Array.isArray(files) || files.length <= 0) return;
    attachments.addFiles(files);
  };

  const focusInput = () => {
    focusComposer();
  };

  createEffect(() => {
    props.onApiReady?.({
      applyDraftText,
      addAttachmentFiles,
      replaceDraft,
      snapshotDraft,
      clearDraft,
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

      <div class="chat-input-body flower-chat-input-body">
        <div class="flower-chat-input-primary-row">
          <textarea
            ref={textareaRef}
            class="chat-input-textarea flower-chat-input-textarea"
            value={text()}
            onInput={(e) => {
              setText(e.currentTarget.value);
              scheduleAdjustHeight();
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionUpdate={() => {
              syncTextFromTextarea();
              scheduleAdjustHeight();
            }}
            onCompositionEnd={() => {
              setIsComposing(false);
              syncTextFromTextarea();
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

          <div class="flower-chat-input-send-slot">
            <button
              type="button"
              class={cn(
                'chat-input-send-btn flower-chat-input-send-btn',
                canSend() && 'chat-input-send-btn-active',
                props.waitingForUser && 'flower-chat-input-send-btn-reply',
              )}
              onClick={() => void handleSend()}
              disabled={!canSend()}
              title={props.waitingForUser ? 'Reply now' : 'Send message'}
            >
              <Show when={props.waitingForUser}>
                <span class="chat-input-send-btn-label">Reply</span>
              </Show>
              <SendIcon />
            </button>
          </div>
        </div>

        <div class="flower-chat-input-meta">
          <div class="flower-chat-input-meta-rail" role="toolbar" aria-label="Chat input secondary actions">
            <Show when={props.onPickWorkingDir}>
              <button
                type="button"
                class={cn(
                  'flower-chat-chip flower-chat-working-dir-chip',
                  canPickWorkingDir()
                    ? 'flower-chat-chip-actionable'
                    : 'flower-chat-chip-disabled',
                )}
                onClick={() => {
                  if (!canPickWorkingDir()) return;
                  props.onPickWorkingDir?.();
                }}
                title={String(props.workingDirTitle ?? '').trim() || String(props.workingDirLabel ?? '').trim() || 'Working dir'}
              >
                <FolderIcon />
                <span class="flower-chat-working-dir-chip-label">{String(props.workingDirLabel ?? '').trim() || 'Working dir'}</span>
                <Show when={!!props.workingDirLocked}>
                  <LockIcon />
                </Show>
              </button>
            </Show>

            <Show when={ctx.config().allowAttachments}>
              <button
                type="button"
                class="flower-chat-meta-btn"
                onClick={attachments.openFilePicker}
                title="Add attachments"
              >
                <PaperclipIcon />
              </button>
            </Show>

            <Show when={props.waitingForUser}>
              <button
                type="button"
                class="flower-chat-chip flower-chat-secondary-chip"
                onClick={() => void handleSend('queue_after_waiting_user')}
                disabled={!canSend()}
                title="Queue for later"
              >
                Queue for later
              </button>
            </Show>
          </div>

          <Show when={sendBlockReason()}>
            <div class="flower-chat-input-status text-error">{sendBlockReason()}</div>
          </Show>
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

const MoreVerticalIcon: Component<{ class?: string }> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
  >
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

const UploadIcon: Component = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const FlowerAssistantAvatar: Component<{ role: MessageRole }> = () => (
  <FlowerIcon class="w-8 h-8 text-primary" />
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
        title="Read-only planning mode: mutating actions are blocked; switch to Act for edits"
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
        <Show when={inProgressCount() <= 0}>
          <CheckCircle class="w-3.5 h-3.5" />
        </Show>
        <span>{progressLabel()}</span>
        <ChevronUp class={cn('w-3 h-3 transition-transform duration-200', expanded() ? '' : 'rotate-180')} />
      </button>

      <Show when={expanded()}>
        {/* Expanded panel */}
        <div class={cn(
          'absolute bottom-full left-0 mb-1.5 z-50',
          'w-[22rem] max-sm:w-[calc(100vw-2rem)]',
          'rounded-xl overflow-hidden',
          'border border-border/60 bg-card shadow-xl shadow-black/12',
          'backdrop-blur-xl',
          'chat-tasks-panel chat-tasks-panel-open',
        )}>
          {/* Accent line */}
          <div class="h-[2px] bg-gradient-to-r from-emerald-500/50 via-emerald-500/20 to-transparent" />

          {/* Header */}
          <div class="px-3.5 pt-2.5 pb-2 border-b border-border/50 bg-gradient-to-b from-muted/40 to-transparent">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <CheckCircle class="w-3.5 h-3.5 text-emerald-500/70" />
                <span class="text-[13px] font-semibold text-foreground tracking-tight">Tasks</span>
                <span class="text-[10px] font-semibold tabular-nums text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-px leading-none">
                  {props.todos.length}
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <Show when={props.unresolvedCount > 0}>
                  <span class="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 py-px">
                    {props.unresolvedCount} open
                  </span>
                </Show>
                <Show when={doneCount() > 0}>
                  <span class="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-px">
                    {doneCount()} done
                  </span>
                </Show>
              </div>
            </div>
          </div>

          <Show when={props.executionMode === 'plan' && props.unresolvedCount > 0}>
            <div class="px-3.5 py-1.5 border-b border-border/40 bg-amber-500/5 text-[10.5px] text-amber-600 dark:text-amber-400">
              Switch to Act to execute these tasks
            </div>
          </Show>

          <Show when={!props.todosLoading || props.todos.length > 0} fallback={
            <div class="px-3.5 py-4 text-[11px] text-muted-foreground text-center">Loading tasks...</div>
          }>
            <Show when={!props.todosError} fallback={
              <div class="px-3.5 py-3 text-[11px] text-error">{props.todosError}</div>
            }>
              <Show when={props.todos.length > 0} fallback={
                <div class="px-3.5 py-4 text-[11px] text-muted-foreground text-center">No tasks yet.</div>
              }>
                <div class="max-h-56 overflow-auto">
                  <div class="flex flex-col gap-1.5 p-2.5">
                    <For each={props.todos}>
                      {(item) => {
                        const borderColor = (): string => {
                          if (item.status === 'completed') return 'border-l-emerald-500';
                          if (item.status === 'in_progress') return 'border-l-blue-500';
                          if (item.status === 'cancelled') return 'border-l-muted-foreground';
                          return 'border-l-amber-500';
                        };
                        return (
                          <div class={cn(
                            'rounded-lg border border-border/55 bg-background/80 overflow-hidden',
                            'border-l-[3px] transition-colors',
                            borderColor(),
                          )}>
                            <div class="flex items-start gap-2 px-2.5 py-2">
                              <span class={cn(
                                'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold shrink-0 mt-px',
                                todoStatusBadgeClass(item.status),
                              )}>
                                {todoStatusLabel(item.status)}
                              </span>
                              <div class="min-w-0 flex-1">
                                <span class={cn(
                                  'text-[11.5px] leading-snug break-words',
                                  item.status === 'completed'
                                    ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                                    : 'text-foreground font-medium',
                                )}>
                                  {item.content}
                                </span>
                                <Show when={item.note}>
                                  <p class="mt-1 text-[10.5px] text-muted-foreground/80 leading-snug m-0 break-words">
                                    {item.note}
                                  </p>
                                </Show>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Footer */}
              <div class="flex items-center justify-between px-3.5 py-1.5 border-t border-border/40 bg-muted/15 text-[10px] text-muted-foreground/70">
                <span>v{props.todosView?.version ?? 0}</span>
                <span>{props.todoUpdatedLabel ? `Updated ${props.todoUpdatedLabel}` : ''}</span>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function CompactContextSummary(props: {
  usage: ContextUsageView | null;
  compactions: ContextCompactionEventView[];
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [showDebug, setShowDebug] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const usagePercent = createMemo(() => {
    const raw = Number(props.usage?.usagePercent ?? 0);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return raw;
  });
  const usagePercentLabel = createMemo(() => (props.usage ? `${usagePercent().toFixed(1)}%` : '--'));

  type CompactionAttemptView = {
    compactionId: string;
    stepIndex: number;
    stage: ContextCompactionEventView['stage'];
    strategy?: string;
    reason?: string;
    error?: string;
    estimateTokensBefore?: number;
    estimateTokensAfter?: number;
    contextLimit?: number;
    pressure?: number;
    effectiveThreshold?: number;
    configuredThreshold?: number;
    windowBasedThreshold?: number;
    messagesBefore?: number;
    messagesAfter?: number;
    atUnixMs: number;
  };

  const compactionAttempts = createMemo((): CompactionAttemptView[] => {
    const list = Array.isArray(props.compactions) ? props.compactions : [];
    if (list.length <= 0) return [];

    const byID = new Map<string, ContextCompactionEventView[]>();
    for (const entry of list) {
      const id = String(entry?.compactionId ?? '').trim();
      if (!id) continue;
      const existing = byID.get(id);
      if (existing) existing.push(entry);
      else byID.set(id, [entry]);
    }

    const pickLatest = (
      items: ContextCompactionEventView[],
      stage: ContextCompactionEventView['stage'],
    ): ContextCompactionEventView | null => {
      const filtered = items.filter((it) => it.stage === stage);
      if (filtered.length <= 0) return null;
      filtered.sort((a, b) => {
        const atA = Number(a.atUnixMs ?? 0) || 0;
        const atB = Number(b.atUnixMs ?? 0) || 0;
        if (atA !== atB) return atB - atA;
        const idA = Number(a.eventId ?? 0) || 0;
        const idB = Number(b.eventId ?? 0) || 0;
        return idB - idA;
      });
      return filtered[0] ?? null;
    };

    const out: CompactionAttemptView[] = [];
    for (const [id, items] of byID.entries()) {
      if (!items || items.length <= 0) continue;

      const applied = pickLatest(items, 'applied');
      const failed = pickLatest(items, 'failed');
      const skipped = pickLatest(items, 'skipped');
      const started = pickLatest(items, 'started');
      const terminal = applied || failed || skipped || started;
      if (!terminal) continue;

      let atUnixMs = 0;
      for (const item of items) {
        const at = Number(item.atUnixMs ?? 0) || 0;
        if (at > atUnixMs) atUnixMs = at;
      }

      const stage = terminal.stage;
      const stepIndex = Math.max(0, Math.floor(Number(terminal.stepIndex ?? 0) || 0));
      const strategy = String((applied?.strategy ?? failed?.strategy ?? skipped?.strategy ?? started?.strategy ?? '')).trim();
      const reason = String((applied?.reason ?? failed?.reason ?? skipped?.reason ?? started?.reason ?? '')).trim();
      const error = String((applied?.error ?? failed?.error ?? skipped?.error ?? started?.error ?? '')).trim();

      out.push({
        compactionId: id,
        stepIndex,
        stage,
        strategy: strategy || undefined,
        reason: reason || undefined,
        error: error || undefined,
        estimateTokensBefore: applied?.estimateTokensBefore ?? failed?.estimateTokensBefore ?? skipped?.estimateTokensBefore ?? started?.estimateTokensBefore,
        estimateTokensAfter: applied?.estimateTokensAfter ?? skipped?.estimateTokensAfter ?? started?.estimateTokensAfter,
        contextLimit: applied?.contextLimit ?? failed?.contextLimit ?? skipped?.contextLimit ?? started?.contextLimit,
        pressure: applied?.pressure ?? failed?.pressure ?? skipped?.pressure ?? started?.pressure,
        effectiveThreshold: applied?.effectiveThreshold ?? failed?.effectiveThreshold ?? skipped?.effectiveThreshold ?? started?.effectiveThreshold,
        configuredThreshold: applied?.configuredThreshold ?? failed?.configuredThreshold ?? skipped?.configuredThreshold ?? started?.configuredThreshold,
        windowBasedThreshold: applied?.windowBasedThreshold ?? failed?.windowBasedThreshold ?? skipped?.windowBasedThreshold ?? started?.windowBasedThreshold,
        messagesBefore: applied?.messagesBefore ?? skipped?.messagesBefore ?? started?.messagesBefore,
        messagesAfter: applied?.messagesAfter ?? skipped?.messagesAfter ?? started?.messagesAfter,
        atUnixMs,
      });
    }

    out.sort((a, b) => {
      const atA = Number(a.atUnixMs ?? 0) || 0;
      const atB = Number(b.atUnixMs ?? 0) || 0;
      if (atA !== atB) return atA - atB;
      return a.compactionId.localeCompare(b.compactionId);
    });

    if (out.length <= 12) return out;
    return out.slice(out.length - 12);
  });

  const chipLabel = createMemo(() => (props.usage ? usagePercentLabel() : `${compactionAttempts().length} events`));
  const usageTokensLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '';
    const used = Math.max(0, Math.floor(Number(usage.estimateTokens ?? 0) || 0));
    const total = Math.max(0, Math.floor(Number(usage.contextLimit ?? 0) || 0));
    if (total <= 0) return '';
    return `${used.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} tok`;
  });
  const usageBadgeClass = createMemo(() => {
    if (!props.usage) return 'bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground';
    const percent = usagePercent();
    if (percent >= 90) return 'bg-error/10 text-error border-error/30 hover:bg-error/14';
    if (percent >= 75) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25 hover:bg-amber-500/14';
    return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25 hover:bg-blue-500/14';
  });
  const thresholdLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '--';
    const ratio = Number(usage.effectiveThreshold ?? NaN);
    if (!Number.isFinite(ratio) || ratio <= 0) return '--';
    return `${Math.round(ratio * 100)}%`;
  });
  const turnMessagesLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '--';
    const raw = Number(usage.turnMessages ?? NaN);
    if (!Number.isFinite(raw) || raw <= 0) return '--';
    return Math.max(0, Math.floor(raw)).toLocaleString('en-US');
  });
  const usageMetaLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '';
    const source = String(usage.estimateSource ?? '').trim();
    const contextWindow = Math.max(0, Math.floor(Number(usage.contextWindow ?? 0) || 0));
    const inputWindow = Math.max(0, Math.floor(Number(usage.contextLimit ?? 0) || 0));
    const windowLabel =
      contextWindow > 0 && contextWindow !== inputWindow
        ? `Input window ${inputWindow.toLocaleString('en-US')} / Context window ${contextWindow.toLocaleString('en-US')}`
        : '';
    const at = Number(usage.atUnixMs ?? 0) || 0;
    const timeLabel = at > 0
      ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const parts = [] as string[];
    if (source) parts.push(`Source: ${source}`);
    if (windowLabel) parts.push(windowLabel);
    if (timeLabel) parts.push(`Updated ${timeLabel}`);
    return parts.join(' · ');
  });
  const sortedSections = createMemo(() => {
    const usage = props.usage;
    if (!usage) return [] as Array<[string, number]>;
    const entries = Object.entries(usage.sectionsTokens ?? {})
      .map(([name, value]) => [String(name ?? '').trim(), Math.max(0, Number(value ?? 0) || 0)] as [string, number])
      .filter(([name]) => !!name);
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  });
  const visibleCompactionAttempts = createMemo(() => {
    const list = compactionAttempts();
    if (showDebug()) return list;
    return list.filter((item) => item.stage === 'applied' || item.stage === 'failed');
  });
  const hiddenAttemptsCount = createMemo(() => {
    const all = compactionAttempts().length;
    const visible = visibleCompactionAttempts().length;
    return Math.max(0, all - visible);
  });
  const debugToggleLabel = createMemo(() => {
    if (showDebug()) return 'Hide debug';
    const hidden = hiddenAttemptsCount();
    if (hidden > 0) return `Show debug (+${hidden})`;
    return 'Show debug';
  });
  const formatRatioPercent = (ratio: number | undefined, digits = 1): string => {
    const raw = Number(ratio ?? NaN);
    if (!Number.isFinite(raw) || raw < 0) return '--';
    return `${(raw * 100).toFixed(digits)}%`;
  };
  const formatCompactionReason = (reason: string | undefined): string => {
    const v = String(reason ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'below_threshold') return 'Below threshold';
    if (v === 'no_effect') return 'No effect';
    return v;
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
            : usageBadgeClass(),
        )}
      >
        <Terminal class="w-3.5 h-3.5" />
        <span>{chipLabel()}</span>
        <ChevronUp class={cn('w-3 h-3 transition-transform duration-200', expanded() ? '' : 'rotate-180')} />
      </button>

      <Show when={expanded()}>
        <div class={cn(
          'absolute bottom-full left-0 mb-1.5 z-50 w-[24rem] max-sm:w-[calc(100vw-2rem)] rounded-xl overflow-hidden',
          'border border-border/60 bg-card shadow-xl shadow-black/12 backdrop-blur-xl',
          'chat-tasks-panel chat-tasks-panel-open',
        )}>
          <div class="h-[2px] bg-gradient-to-r from-blue-500/60 via-blue-500/30 to-transparent" />

          <div class="px-3.5 pt-2.5 pb-2 border-b border-border/50 bg-gradient-to-b from-muted/40 to-transparent">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <Terminal class="w-3.5 h-3.5 text-blue-500/80" />
                <span class="text-[13px] font-semibold text-foreground tracking-tight">Context</span>
                <span class="text-[10px] font-semibold tabular-nums text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-px leading-none">
                  {usagePercentLabel()}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <Show when={usageTokensLabel()}>
                  <span class="text-[10px] font-mono tabular-nums text-muted-foreground/80">{usageTokensLabel()}</span>
                </Show>
                <Show when={compactionAttempts().length > 0}>
                  <button
                    type="button"
                    class={cn(
                      'text-[10px] font-medium px-1.5 py-px rounded border transition-colors',
                      showDebug()
                        ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/15'
                        : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted/60 hover:text-foreground',
                    )}
                    title="Show compaction debug events"
                    onClick={() => setShowDebug((v) => !v)}
                  >
                    {debugToggleLabel()}
                  </button>
                </Show>
              </div>
            </div>
          </div>

          <div class="px-3.5 py-2 border-b border-border/40 bg-muted/10">
            <Show when={props.usage} fallback={
              <div class="text-[11px] text-muted-foreground">No context usage telemetry yet.</div>
            }>
              <div class="grid grid-cols-3 gap-1.5 text-[10px]">
                <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                  <div
                    class="font-medium text-muted-foreground/70 uppercase tracking-wider"
                    title="One model request equals one round."
                  >
                    Round
                  </div>
                  <div class="font-semibold tabular-nums text-foreground/85">{props.usage?.stepIndex ?? 0}</div>
                </div>
                <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                  <div class="font-medium text-muted-foreground/70 uppercase tracking-wider" title="When compaction may trigger.">
                    Threshold
                  </div>
                  <div class="font-semibold tabular-nums text-foreground/85">{thresholdLabel()}</div>
                </div>
                <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                  <div class="font-medium text-muted-foreground/70 uppercase tracking-wider">Msgs</div>
                  <div class="font-semibold tabular-nums text-foreground/85">{turnMessagesLabel()}</div>
                </div>
              </div>

              <Show when={usageMetaLabel()}>
                <div class="mt-2 text-[10px] text-muted-foreground/80">{usageMetaLabel()}</div>
              </Show>

              <Show when={sortedSections().length > 0}>
                <div class="mt-2">
                  <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Sections</div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <For each={sortedSections()}>
                      {([name, value]) => (
                        <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] text-foreground/80">
                          <span class="font-medium">{name}</span>
                          <span class="font-mono tabular-nums text-muted-foreground">{Math.max(0, Math.floor(value)).toLocaleString('en-US')}</span>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>
          </div>

          <div class="max-h-56 overflow-auto">
            <Show when={visibleCompactionAttempts().length > 0} fallback={
              <div class="px-3.5 py-3 text-[11px] text-muted-foreground text-center">No compaction actions yet.</div>
            }>
              <div class="flex flex-col gap-1.5 p-2.5">
                <For each={visibleCompactionAttempts()}>
                  {(item) => {
                    const stageClass = () => {
                      switch (item.stage) {
                        case 'started':
                          return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25';
                        case 'applied':
                          return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25';
                        case 'failed':
                          return 'bg-error/10 text-error border-error/25';
                        default:
                          return 'bg-muted/50 text-muted-foreground border-border/60';
                      }
                    };
                    const stageLabel = () => {
                      switch (item.stage) {
                        case 'started':
                          return 'Started';
                        case 'applied':
                          return 'Applied';
                        case 'failed':
                          return 'Failed';
                        case 'skipped':
                          return 'Skipped';
                        default:
                          return 'Unknown';
                      }
                    };
                    const tokenDeltaLabel = () => {
                      const before = Number(item.estimateTokensBefore ?? NaN);
                      const after = Number(item.estimateTokensAfter ?? NaN);
                      if (Number.isFinite(before) && Number.isFinite(after) && after > 0) {
                        return `${Math.floor(before).toLocaleString('en-US')} → ${Math.floor(after).toLocaleString('en-US')} tok`;
                      }
                      if (Number.isFinite(before) && before > 0) {
                        return `${Math.floor(before).toLocaleString('en-US')} tok`;
                      }
                      return '';
                    };
                    const pressureLabel = () => {
                      const parts: string[] = [];
                      const pressure = formatRatioPercent(item.pressure, 1);
                      if (pressure !== '--') parts.push(`pressure ${pressure}`);
                      const thr = formatRatioPercent(item.effectiveThreshold, 0);
                      if (thr !== '--') parts.push(`thr ${thr}`);
                      return parts.join(' · ');
                    };
                    const messagesDeltaLabel = () => {
                      const before = Number(item.messagesBefore ?? NaN);
                      const after = Number(item.messagesAfter ?? NaN);
                      if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 0) return '';
                      return `msgs ${Math.floor(before)} → ${Math.floor(after)}`;
                    };
                    return (
                      <div class="rounded-lg border border-border/55 bg-background/80 px-2.5 py-1.5">
                        <div class="flex items-center gap-2">
                          <span class={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', stageClass())}>
                            {stageLabel()}
                          </span>
                          <span class="text-[10px] text-muted-foreground">round {item.stepIndex}</span>
                          <Show when={formatCompactionReason(item.reason)}>
                            <span
                              class="ml-auto text-[10px] text-muted-foreground truncate max-w-[10rem]"
                              title={formatCompactionReason(item.reason)}
                            >
                              {formatCompactionReason(item.reason)}
                            </span>
                          </Show>
                        </div>
                        <Show when={tokenDeltaLabel() || pressureLabel() || messagesDeltaLabel()}>
                          <div class="mt-1 text-[10px] text-muted-foreground/85">
                            {tokenDeltaLabel()}
                            <Show when={tokenDeltaLabel() && (pressureLabel() || messagesDeltaLabel())}>
                              <span> · </span>
                            </Show>
                            {pressureLabel()}
                            <Show when={pressureLabel() && messagesDeltaLabel()}>
                              <span> · </span>
                            </Show>
                            {messagesDeltaLabel()}
                          </div>
                        </Show>
                        <Show when={item.strategy && showDebug()}>
                          <div class="mt-1 text-[10px] text-muted-foreground/85">strategy: {item.strategy}</div>
                        </Show>
                        <Show when={item.error}>
                          <div class="mt-1 text-[10px] text-error break-words">{item.error}</div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
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

function CompactSubagentsSummary(props: {
  subagents: SubagentView[];
  updatedLabel: string;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [promptDialogOpen, setPromptDialogOpen] = createSignal(false);
  const [promptDialogItem, setPromptDialogItem] = createSignal<SubagentView | null>(null);
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
  const promptDialogTitle = createMemo(() => {
    const item = promptDialogItem();
    if (!item) return 'Subagent Prompt';
    const title = String(item.title ?? '').trim();
    if (title) return `Subagent Prompt · ${title}`;
    return `Subagent Prompt · ${item.subagentId}`;
  });

  const openPromptDialog = (item: SubagentView) => {
    const prompt = String(item.delegationPromptMarkdown ?? '').trim();
    if (!prompt) return;
    setPromptDialogItem(item);
    setPromptDialogOpen(true);
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
        <Settings class="w-3.5 h-3.5" />
        <span>{runningCount()} running</span>
        <ChevronUp class={cn('w-3 h-3 transition-transform duration-200', expanded() ? '' : 'rotate-180')} />
      </button>

      <Show when={expanded()}>
        <div class={cn(
          'absolute bottom-full left-0 mb-1.5 z-50 w-[26rem] max-sm:w-[calc(100vw-2rem)] rounded-xl overflow-hidden',
          'border border-border/60 bg-card shadow-xl shadow-black/12 backdrop-blur-xl',
          'chat-tasks-panel chat-tasks-panel-open',
        )}>
          {/* Panel accent line */}
          <div class="h-[2px] bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />

          {/* Panel header */}
          <div class="px-3.5 pt-2.5 pb-2 border-b border-border/50 bg-gradient-to-b from-muted/40 to-transparent">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <Settings class="w-3.5 h-3.5 text-primary/70" />
                <span class="text-[13px] font-semibold text-foreground tracking-tight">Subagents</span>
                <span class="text-[10px] font-semibold tabular-nums text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-px leading-none">
                  {props.subagents.length}
                </span>
              </div>
              <Show when={props.updatedLabel}>
                <span class="text-[10px] text-muted-foreground/70">{props.updatedLabel}</span>
              </Show>
            </div>
            <div class="flex items-center gap-1.5 mt-1.5">
              <Show when={runningCount() > 0}>
                <span class="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-1.5 py-px">
                  <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {runningCount()} running
                </span>
              </Show>
              <Show when={waitingCount() > 0}>
                <span class="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 py-px">
                  {waitingCount()} waiting
                </span>
              </Show>
              <Show when={completedCount() > 0}>
                <span class="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-px">
                  {completedCount()} completed
                </span>
              </Show>
              <Show when={failedCount() > 0}>
                <span class="inline-flex items-center gap-1 text-[10px] font-medium text-error bg-error/10 border border-error/20 rounded-full px-1.5 py-px">
                  {failedCount()} failed
                </span>
              </Show>
            </div>
          </div>

          {/* Agent list */}
          <Show when={props.subagents.length > 0} fallback={
            <div class="px-3.5 py-4 text-[11px] text-muted-foreground text-center">No subagents yet.</div>
          }>
            <div class="max-h-72 overflow-auto">
            <div class="flex flex-col gap-2 p-2.5">
              <For each={props.subagents}>
                {(item) => {
                  const borderColor = (): string => {
                    const s = String(item.status ?? '').trim().toLowerCase();
                    if (s === 'running') return 'border-l-blue-500';
                    if (s === 'waiting_input') return 'border-l-amber-500';
                    if (s === 'completed') return 'border-l-emerald-500';
                    if (s === 'failed' || s === 'timed_out') return 'border-l-red-500';
                    return 'border-l-border';
                  };
                  return (
                    <div class={cn(
                      'rounded-lg border border-border/60 bg-background/80 overflow-hidden',
                      'border-l-[3px] transition-colors',
                      borderColor(),
                    )}>
                      {/* Card header */}
                      <div class="flex items-center gap-2 px-2.5 py-1.5 bg-muted/20">
                        <span class={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0',
                          subagentStatusBadgeClass(item.status),
                        )}>
                          {subagentStatusLabel(item.status)}
                        </span>
                        <span class="text-[11px] font-medium text-foreground/80">{item.agentType || 'subagent'}</span>
                        <span class="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground">{formatSubagentElapsed(item.stats.elapsedMs)}</span>
                      </div>

                      {/* Card body */}
                      <div class="px-2.5 py-2 space-y-1.5">
                        {/* Title / Objective */}
                        <Show when={item.title || item.objective}>
                          <p class="text-[11.5px] font-medium text-foreground leading-snug m-0">
                            {summarizeSubagentText(String(item.title ?? item.objective ?? ''), 120)}
                          </p>
                        </Show>

                        {/* Stats grid */}
                        <div class="grid grid-cols-4 gap-1">
                          <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                            <div class="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider">Steps</div>
                            <div class="text-[11px] font-semibold tabular-nums text-foreground/85">{formatSubagentInteger(item.stats.steps)}</div>
                          </div>
                          <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                            <div class="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider">Tools</div>
                            <div class="text-[11px] font-semibold tabular-nums text-foreground/85">{formatSubagentInteger(item.stats.toolCalls)}</div>
                          </div>
                          <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                            <div class="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider">Tokens</div>
                            <div class="text-[11px] font-semibold tabular-nums text-foreground/85">{formatSubagentInteger(item.stats.tokens)}</div>
                          </div>
                          <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                            <div class="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider">ID</div>
                            <div class="text-[10px] font-mono text-foreground/70 truncate">{String(item.subagentId).slice(-6)}</div>
                          </div>
                        </div>

                        {/* Prompt section */}
                        <Show when={item.delegationPromptMarkdown}>
                          <button
                            type="button"
                            class={cn(
                              'group w-full text-left rounded-md px-2 py-1.5',
                              'border border-border/50 bg-muted/20',
                              'transition-all duration-150 hover:bg-accent/30 hover:border-primary/25',
                            )}
                            onClick={() => openPromptDialog(item)}
                          >
                            <div class="flex items-center justify-between gap-1.5">
                              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Prompt</span>
                              <span class="text-[10px] font-medium text-primary/70 group-hover:text-primary transition-colors">View</span>
                            </div>
                            <p class="mt-0.5 text-[10.5px] text-foreground/75 leading-relaxed line-clamp-2 m-0">
                              {summarizeSubagentText(String(item.delegationPromptMarkdown ?? ''), 120)}
                            </p>
                          </button>
                        </Show>

                        {/* Trigger reason */}
                        <Show when={item.triggerReason}>
                          <p class="text-[10px] text-muted-foreground/70 leading-snug m-0">
                            <span class="font-semibold uppercase tracking-wider">Trigger</span>{' '}
                            {summarizeSubagentText(item.triggerReason, 108)}
                          </p>
                        </Show>

                        {/* Error */}
                        <Show when={item.error}>
                          <div class="rounded-md border border-error/25 bg-error/8 px-2 py-1 text-[10.5px] text-error">
                            {item.error}
                          </div>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
            </div>
          </Show>
        </div>
      </Show>

      <Dialog
        open={promptDialogOpen()}
        onOpenChange={(open) => {
          setPromptDialogOpen(open);
          if (!open) {
            setPromptDialogItem(null);
          }
        }}
        title={promptDialogTitle()}
      >
        <Show when={promptDialogItem()}>
          {(item) => (
            <div class="space-y-4">
              {/* Meta cards */}
              <div class="grid gap-2 sm:grid-cols-3">
                <div class="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
                  <div class="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/60">Subagent</div>
                  <div class="mt-1 text-[11.5px] font-mono text-foreground/90 break-all leading-snug">{item().subagentId}</div>
                </div>
                <div class="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
                  <div class="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/60">Status</div>
                  <div class="mt-1">
                    <span class={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', subagentStatusBadgeClass(item().status))}>
                      {subagentStatusLabel(item().status)}
                    </span>
                  </div>
                </div>
                <div class="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
                  <div class="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/60">Type</div>
                  <div class="mt-1 text-[11.5px] font-medium text-foreground/90">{item().agentType || 'subagent'}</div>
                </div>
              </div>

              <Show when={item().objective}>
                <div>
                  <div class="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Objective</div>
                  <p class="text-[12.5px] text-foreground leading-relaxed m-0">{item().objective}</p>
                </div>
              </Show>

              <Show when={item().triggerReason}>
                <div>
                  <div class="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Trigger reason</div>
                  <p class="text-[12.5px] text-foreground leading-relaxed m-0">{item().triggerReason}</p>
                </div>
              </Show>

              <div>
                <div class="text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Delegation prompt</div>
                <pre class="max-h-[52vh] overflow-auto rounded-lg border border-border/60 bg-background/90 px-3.5 py-2.5 text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words text-foreground/90 m-0">
                  {String(item().delegationPromptMarkdown ?? '').trim()}
                </pre>
              </div>
            </div>
          )}
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
    <div class="flower-empty-chat-state">
      {/* Welcome section */}
      <Motion.div
        class="flower-empty-chat-hero"
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
      <div class="flower-empty-chat-suggestions">
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
        class="flower-empty-chat-hint"
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
  const [contextUsage, setContextUsage] = createSignal<ContextUsageView | null>(null);
  const [contextCompactions, setContextCompactions] = createSignal<ContextCompactionEventView[]>([]);
  const [hasMessages, setHasMessages] = createSignal(false);
  // Turns true immediately after send to keep instant feedback before run state events arrive.
  const [sendPending, setSendPending] = createSignal(false);
  const [draftExecutionMode, setDraftExecutionMode] = createSignal<ExecutionMode>(readPersistedExecutionMode());
  const [threadExecutionModeOverrideById, setThreadExecutionModeOverrideById] = createSignal<Record<string, ExecutionMode>>({});
  const [queuedFollowups, setQueuedFollowups] = createSignal<FollowupItem[]>([]);
  const [draftFollowups, setDraftFollowups] = createSignal<FollowupItem[]>([]);
  const [followupsRevision, setFollowupsRevision] = createSignal<number | null>(null);
  const [followupsPausedReason, setFollowupsPausedReason] = createSignal('');
  const [followupsLoading, setFollowupsLoading] = createSignal(false);
  const [followupsError, setFollowupsError] = createSignal('');
  const [followupEditOpen, setFollowupEditOpen] = createSignal(false);
  const [followupEditID, setFollowupEditID] = createSignal('');
  const [followupEditLane, setFollowupEditLane] = createSignal<FollowupLane>('queued');
  const [followupEditText, setFollowupEditText] = createSignal('');
  const [followupEditSaving, setFollowupEditSaving] = createSignal(false);
  const [followupDeletingID, setFollowupDeletingID] = createSignal<string | null>(null);
  const [loadedDraftFollowupID, setLoadedDraftFollowupID] = createSignal('');
  const [pendingDraftLoad, setPendingDraftLoad] = createSignal<PendingDraftLoad | null>(null);
  const [draftLoadConfirmOpen, setDraftLoadConfirmOpen] = createSignal(false);
  const [followupReorderingLane, setFollowupReorderingLane] = createSignal<FollowupLane | null>(null);
  const [draggingFollowupID, setDraggingFollowupID] = createSignal('');
  const [draggingFollowupLane, setDraggingFollowupLane] = createSignal<FollowupLane | null>(null);
  let lastFollowupsReq = 0;
  let nextSendIntent: SendIntent = 'default';
  const sendIntentByMessageId = new Map<string, SendIntent>();
  const sourceFollowupIDByMessageId = new Map<string, string>();
  const draftSnapshotByMessageId = new Map<string, AIChatInputDraftSnapshot>();

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);
  const [chatInputApi, setChatInputApi] = createSignal<AIChatInputApi | null>(null);
  let queuedAskFlowerIntents: AskFlowerIntent[] = [];
  let messageAreaRef: HTMLDivElement | undefined;

  // Working dir (draft-only; locked after thread creation)
  const [homePath, setHomePath] = createSignal<string | undefined>(undefined);
  const [workingDirPickerOpen, setWorkingDirPickerOpen] = createSignal(false);
  const [workingDirFiles, setWorkingDirFiles] = createSignal<FileItem[]>([]);
  let workingDirCache: DirCache = new Map();
  let draftWorkingDirInitializedForHome = false;

  createEffect(() => {
    if (!protocol.client()) return;
    void (async () => {
      try {
        const resp = await rpc.fs.getPathContext();
        const home = String(resp?.agentHomePathAbs ?? '').trim();
        if (home) setHomePath(home);
      } catch {
        // ignore
      }
    })();
  });

  createEffect(() => {
    homePath();
    workingDirCache = new Map();
    setWorkingDirFiles([]);
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

      ai.setDraftWorkingDir(root);
    })();
  });

  const requestScrollToBottom = (source: 'system' | 'user' = 'system') => {
    chat?.requestScrollToBottom({ source, behavior: 'auto' });
  };

  let lastMessagesReq = 0;
  let lastTodosReq = 0;
  let skipNextThreadLoad = false;
  let activeTranscriptCursor = 0; // max transcript_messages.id seen for the active thread
  let activeTranscriptBaselineLoaded = false;
  let activeAssistantMessageSeq = 0;
  let activeSnapshotReqSeq = 0;
  let activeSnapshotRecoverySeq = 0;
  let activeSnapshotRecoveryTimer: number | null = null;
  let activeContextRunID = '';
  let activeContextEventCursor = 0;
  let activeContextReplaySeq = 0;
  const failureNotifiedRuns = new Set<string>();
  const [runPhaseLabel, setRunPhaseLabel] = createSignal('Working');
  const resetContextTelemetryState = (opts?: { keepRunId?: boolean }) => {
    setContextUsage(null);
    setContextCompactions([]);
    activeContextEventCursor = 0;
    activeContextReplaySeq += 1;
    if (!opts?.keepRunId) {
      activeContextRunID = '';
    }
  };
  const ensureContextRun = (runId: string, opts?: { reset?: boolean }) => {
    const rid = String(runId ?? '').trim();
    if (!rid) return false;
    if (rid === activeContextRunID && !opts?.reset) return true;
    activeContextRunID = rid;
    resetContextTelemetryState({ keepRunId: true });
    return true;
  };
  const applyContextUsagePayload = (
    payload: unknown,
    meta?: {
      eventId?: unknown;
      atUnixMs?: unknown;
    },
  ) => {
    const normalized = normalizeContextUsage(payload, meta);
    if (!normalized) return;
    const current = contextUsage();
    const nextEventId = Number(normalized.eventId ?? 0);
    const currentEventId = Number(current?.eventId ?? 0);
    const nextAt = Number(normalized.atUnixMs ?? 0);
    const currentAt = Number(current?.atUnixMs ?? 0);

    if (nextEventId > 0 && currentEventId > 0 && nextEventId < currentEventId) return;
    if (nextEventId > 0 && currentEventId > 0 && nextEventId === currentEventId && nextAt < currentAt) return;
    if (nextEventId <= 0 && currentEventId > 0 && nextAt <= currentAt) return;
    if (nextEventId <= 0 && currentEventId <= 0 && nextAt < currentAt) return;

    setContextUsage(normalized);
  };
  const applyContextCompactionPayload = (
    eventType: string,
    payload: unknown,
    meta?: {
      eventId?: unknown;
      atUnixMs?: unknown;
    },
  ) => {
    const normalized = normalizeContextCompactionEvent(eventType, payload, meta);
    if (!normalized) return;
    setContextCompactions((prev) =>
      mergeContextCompactionEvents(prev, [normalized], CONTEXT_TIMELINE_WINDOW_LIMIT),
    );
  };
  const loadContextRunEvents = async (
    runId: string,
    opts?: {
      reset?: boolean;
      maxPages?: number;
    },
  ): Promise<void> => {
    if (!canRWXReady()) return;
    const rid = String(runId ?? '').trim();
    if (!rid) return;
    if (!ensureContextRun(rid, { reset: opts?.reset })) return;

    const reqSeq = ++activeContextReplaySeq;
    let cursor = activeContextEventCursor;
    const maxPages = Math.max(1, Math.floor(Number(opts?.maxPages ?? RUN_CONTEXT_EVENTS_MAX_PAGES)));
    let pages = 0;
    try {
      while (pages < maxPages) {
        pages += 1;
        const params = new URLSearchParams();
        params.set('category', 'context');
        params.set('limit', String(RUN_CONTEXT_EVENTS_PAGE_LIMIT));
        if (cursor > 0) {
          params.set('cursor', String(cursor));
        }
        const resp = await fetchGatewayJSON<RunContextEventsResponse>(
          `/_redeven_proxy/api/ai/runs/${encodeURIComponent(rid)}/events?${params.toString()}`,
          { method: 'GET' },
        );
        if (reqSeq !== activeContextReplaySeq) return;

        const events = Array.isArray(resp?.events) ? resp.events : [];
        const cursorBeforePage = cursor;
        let pageMaxEventID = cursor;
        for (const entry of events) {
          const eventID = Math.max(0, Math.floor(Number(entry?.event_id ?? 0) || 0));
          const atUnixMs = Math.max(0, Math.floor(Number(entry?.at_unix_ms ?? 0) || 0));
          const eventType = String(entry?.event_type ?? '').trim();
          const payload = entry?.payload;

          if (eventType === 'context.usage.updated') {
            applyContextUsagePayload(payload, { eventId: eventID, atUnixMs });
          } else if (eventType.startsWith('context.compaction.')) {
            applyContextCompactionPayload(eventType, payload, { eventId: eventID, atUnixMs });
          }

          if (eventID > pageMaxEventID) {
            pageMaxEventID = eventID;
          }
        }

        const nextCursorRaw = Math.max(0, Math.floor(Number(resp?.next_cursor ?? 0) || 0));
        const nextCursor = Math.max(pageMaxEventID, nextCursorRaw, cursor);
        const hasMore = Boolean(resp?.has_more);

        cursor = nextCursor;
        if (!hasMore) break;
        if (events.length <= 0 && nextCursor <= cursorBeforePage) break;
      }

      if (reqSeq === activeContextReplaySeq) {
        activeContextEventCursor = Math.max(activeContextEventCursor, cursor);
      }
    } catch {
      // best effort, realtime stream continues to update the UI
    }
  };
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
            specId: String(candidate.specId ?? '').trim() || undefined,
            title: String(candidate.title ?? '').trim() || undefined,
            objective: String(candidate.objective ?? '').trim() || undefined,
            contextMode: String(candidate.contextMode ?? '').trim() || undefined,
            promptHash: String(candidate.promptHash ?? '').trim() || undefined,
            delegationPromptMarkdown: String(candidate.delegationPromptMarkdown ?? '').trim() || undefined,
            deliverables: Array.isArray(candidate.deliverables) ? candidate.deliverables : [],
            definitionOfDone: Array.isArray(candidate.definitionOfDone) ? candidate.definitionOfDone : [],
            outputSchema: candidate.outputSchema && typeof candidate.outputSchema === 'object' && !Array.isArray(candidate.outputSchema)
              ? candidate.outputSchema
              : {},
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

          if (toolName === 'subagents' && toolStatus === 'success') {
            const action = String((args as any).action ?? (result as any).action ?? '').trim().toLowerCase();
            if (action === 'create') {
              mergeIntoMap(mapSubagentPayloadSnakeToCamel({
                ...(result as any),
                status: (result as any).subagent_status ?? (result as any).subagentStatus ?? (result as any).status,
                spec_id: (result as any).spec_id ?? (result as any).specId,
                title: (result as any).title ?? (args as any).title,
                objective: (result as any).objective ?? (args as any).objective,
                context_mode: (result as any).context_mode ?? (args as any).context_mode,
                prompt_hash: (result as any).prompt_hash ?? (result as any).promptHash,
                delegation_prompt_markdown: (result as any).delegation_prompt_markdown ?? (result as any).delegationPromptMarkdown,
                deliverables: (result as any).deliverables ?? (args as any).deliverables,
                definition_of_done: (result as any).definition_of_done ?? (args as any).definition_of_done,
                output_schema: (result as any).output_schema ?? (args as any).output_schema,
                agent_type: (result as any).agent_type ?? (args as any).agent_type,
                trigger_reason: (result as any).trigger_reason ?? (args as any).trigger_reason,
              }), messageTimestamp);
            } else if (action === 'wait') {
              const views = extractSubagentViewsFromWaitResult({
                status: (result as any).snapshots ?? {},
              });
              views.forEach((item) => mergeIntoMap(item, messageTimestamp));
            } else if (action === 'list') {
              const listItems = Array.isArray((result as any).items) ? ((result as any).items as unknown[]) : [];
              listItems.forEach((entry) => {
                mergeIntoMap(mapSubagentPayloadSnakeToCamel(entry), messageTimestamp);
              });
            } else if (action === 'inspect') {
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
                String((block as any).title ?? '').trim() === String(latest.title ?? '').trim() &&
                String((block as any).objective ?? '').trim() === String(latest.objective ?? '').trim() &&
                String((block as any).contextMode ?? '').trim() === String(latest.contextMode ?? '').trim() &&
                String((block as any).promptHash ?? '').trim() === String(latest.promptHash ?? '').trim() &&
                String((block as any).delegationPromptMarkdown ?? '').trim() === String(latest.delegationPromptMarkdown ?? '').trim() &&
                String((block as any).agentType ?? '').trim() === latest.agentType &&
                String((block as any).triggerReason ?? '').trim() === latest.triggerReason &&
                String((block as any).taskId ?? '').trim() === latest.taskId &&
                String((block as any).specId ?? '').trim() === String(latest.specId ?? '').trim() &&
                currentError === latestError &&
                currentUpdatedAt === latest.updatedAtUnixMs &&
                JSON.stringify((block as any).deliverables ?? []) === JSON.stringify(latest.deliverables ?? []) &&
                JSON.stringify((block as any).definitionOfDone ?? []) === JSON.stringify(latest.definitionOfDone ?? []) &&
                JSON.stringify((block as any).outputSchema ?? {}) === JSON.stringify(latest.outputSchema ?? {}) &&
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
                  specId: latest.specId,
                  title: latest.title,
                  objective: latest.objective,
                  contextMode: latest.contextMode,
                  promptHash: latest.promptHash,
                  delegationPromptMarkdown: latest.delegationPromptMarkdown,
                  deliverables: latest.deliverables ?? [],
                  definitionOfDone: latest.definitionOfDone ?? [],
                  outputSchema: latest.outputSchema ?? {},
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
  const hasContextTelemetry = createMemo(() => !!contextUsage() || contextCompactions().length > 0);

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
  const expectedQueuedTurnCount = createMemo(() => {
    const serverCount = Number(ai.activeThread()?.queued_turn_count ?? 0);
    return Number.isFinite(serverCount) && serverCount > 0 ? Math.floor(serverCount) : 0;
  });
  const shouldShowQueuedTurnsPanel = createMemo(() =>
    queuedFollowups().length > 0 || ((followupsLoading() || !!followupsError()) && expectedQueuedTurnCount() > 0),
  );
  const activeQueuedTurnCount = createMemo(() => {
    if (queuedFollowups().length > 0) {
      return queuedFollowups().length;
    }
    return shouldShowQueuedTurnsPanel() ? expectedQueuedTurnCount() : 0;
  });
  const queuedTurnHint = createMemo(() =>
    followupsPausedReason() === 'waiting_user'
      ? 'Paused until waiting input is resolved.'
      : 'Flower will send these automatically after the current run finishes.',
  );
  const hasBottomDockPanels = createMemo(() => draftFollowups().length > 0 || shouldShowQueuedTurnsPanel());
  const executionMode = createMemo<ExecutionMode>(() => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) {
      return normalizeExecutionMode(draftExecutionMode());
    }
    const overrides = threadExecutionModeOverrideById();
    const override = overrides[tid];
    if (override) {
      return normalizeExecutionMode(override);
    }
    return normalizeExecutionMode(ai.activeThread()?.execution_mode);
  });

  createEffect(() => {
    const overrides = threadExecutionModeOverrideById();
    const keys = Object.keys(overrides);
    if (keys.length === 0) return;
    const thread = ai.activeThread();
    if (!thread) return;
    const tid = String(thread.thread_id ?? '').trim();
    if (!tid) return;
    const expected = overrides[tid];
    if (!expected) return;
    const serverMode = normalizeExecutionMode(thread.execution_mode);
    if (serverMode !== expected) return;
    setThreadExecutionModeOverrideById((prev) => {
      if (!prev[tid]) return prev;
      const next = { ...prev };
      delete next[tid];
      return next;
    });
  });

  createEffect(() => {
    const overrides = threadExecutionModeOverrideById();
    const keys = Object.keys(overrides);
    if (keys.length === 0) return;
    const existing = new Set((ai.threads()?.threads ?? []).map((item) => String(item.thread_id ?? '').trim()).filter(Boolean));
    let changed = false;
    const next = { ...overrides };
    for (const key of keys) {
      if (existing.has(key)) continue;
      delete next[key];
      changed = true;
    }
    if (changed) {
      setThreadExecutionModeOverrideById(next);
    }
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
  const waitingUserComposerSendBlockReason = (content: string, attachments: Attachment[]): string | null => {
    if (!activeThreadWaitingUser()) return null;

    const waitingPrompt = ai.activeThreadWaitingPrompt();
    const hasDraftPayload = String(content ?? '').trim().length > 0 || attachments.length > 0;
    if (!hasDraftPayload) return null;

    const tid = String(ai.activeThreadId() ?? '').trim();
    const promptId = String(waitingPrompt?.prompt_id ?? '').trim();
    if (!tid || !promptId) {
      return 'The pending input request is no longer available.';
    }

    const plan = buildStructuredComposerSendPlan({
      waitingPrompt,
      composerText: content,
      drafts: ai.getStructuredPromptDrafts(tid, promptId),
    });

    return plan.kind === 'error' ? plan.description : null;
  };

  const activeWorkingDir = createMemo(() => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (tid) {
      return String(ai.activeThread()?.working_dir ?? '').trim();
    }
    return String(ai.draftWorkingDir() ?? '').trim();
  });
  const workingDirLabel = createMemo(() => toHomeDisplayPath(activeWorkingDir(), homePath()));
  const workingDirLocked = createMemo(() => !!String(ai.activeThreadId() ?? '').trim());
  const workingDirDisabled = createMemo(
    () =>
      !canInteract() ||
      sendPending() ||
      ai.creatingThread() ||
      !String(homePath() ?? '').trim(),
  );
  const workingDirPickerInitialPath = createMemo(() => toPickerTreePath(activeWorkingDir(), homePath()));

  const applyAskFlowerIntent = (intent: AskFlowerIntent): boolean => {
    const inputApi = chatInputApi();
    if (!inputApi) return false;

    const suggestedWorkingDirAbs = resolveSuggestedWorkingDirAbsolute({
      suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
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

  const loadWorkingDirTree = async (pickerPath: string) => {
    if (!protocol.client()) return;
    const absolutePath = toPickerTreeAbsolutePath(pickerPath, homePath());
    if (!absolutePath) return;
    if (workingDirCache.has(absolutePath)) {
      setWorkingDirFiles((prev) => replacePickerChildren(prev, pickerPath, workingDirCache.get(absolutePath)!));
      return;
    }
    try {
      const resp = await rpc.fs.list({ path: absolutePath, showHidden: false });
      const entries = resp?.entries ?? [];
      const items = sortPickerFolderItems(
        entries
          .map((entry) => toPickerFolderItem(entry as FsFileInfo, homePath()))
          .filter((item): item is FileItem => !!item),
      );
      workingDirCache.set(absolutePath, items);
      setWorkingDirFiles((prev) => replacePickerChildren(prev, pickerPath, items));
    } catch {
      // ignore
    }
  };

  const handleWorkingDirExpand = (path: string) => {
    void loadWorkingDirTree(path);
  };

  createEffect(() => {
    if (!workingDirPickerOpen()) return;
    if (workingDirFiles().length > 0) return;
    void loadWorkingDirTree('/');
  });

  const updateExecutionMode = async (nextMode: ExecutionMode) => {
    const next = normalizeExecutionMode(nextMode);
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) {
      setDraftExecutionMode(next);
      persistExecutionMode(next);
      return;
    }
    if (!ensureRWX()) return;
    if (executionMode() === next) return;

    setThreadExecutionModeOverrideById((prev) => ({ ...prev, [tid]: next }));
    try {
      await fetchGatewayJSON<{ thread: any }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_mode: next }),
      });
      setDraftExecutionMode(next);
      persistExecutionMode(next);
      ai.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to update execution mode', msg || 'Request failed.');
      setThreadExecutionModeOverrideById((prev) => {
        if (!prev[tid]) return prev;
        const out = { ...prev };
        delete out[tid];
        return out;
      });
    }
  };
  createEffect(() => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (tid) return;
    const mode = normalizeExecutionMode(draftExecutionMode());
    persistExecutionMode(mode);
  });

  const isTerminalRunStatus = (status: string) =>
    status === 'success' || status === 'failed' || status === 'canceled' || status === 'timed_out' || status === 'waiting_user';

  const normalizeMessageID = (m: any): string => String(m?.id ?? '').trim();

  const hasStreamingAssistantMessage = (): boolean => {
    const messages = chat?.messages() ?? [];
    return messages.some((message) => message.role === 'assistant' && message.status === 'streaming');
  };

  const cancelActiveRunSnapshotRecovery = (): void => {
    activeSnapshotRecoverySeq += 1;
    if (activeSnapshotRecoveryTimer !== null) {
      window.clearTimeout(activeSnapshotRecoveryTimer);
      activeSnapshotRecoveryTimer = null;
    }
  };

  const resetActiveTranscriptCursor = (_threadId: string) => {
    activeTranscriptCursor = 0;
    activeTranscriptBaselineLoaded = false;
    activeAssistantMessageSeq = 0;
    cancelActiveRunSnapshotRecovery();
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
        requestScrollToBottom('system');
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
    const assistantSeqAtStart = activeAssistantMessageSeq;

    try {
      const resp = await rpc.ai.getActiveRunSnapshot({ threadId: tid });
      if (!resp.ok || !resp.messageJson) return;

      if (reqSeq !== activeSnapshotReqSeq) return;
      if (tid !== String(ai.activeThreadId() ?? '').trim()) return;
      // Realtime events that arrived during fetch are newer than this snapshot.
      if (assistantSeqAtStart !== activeAssistantMessageSeq) return;

      const decorated = decorateMessageBlocks(resp.messageJson as Message);
      const current = chat.messages() ?? [];
      const next = upsertMessageById(current, decorated);
      chat.setMessages(next);
      rebuildSubagentsFromMessages(next);
      setHasMessages(next.length > 0);
    } catch {
      // Best-effort: ignore snapshot failures (realtime frames / transcript refresh can self-heal).
    }
  };

  const scheduleActiveRunSnapshotRecovery = (threadId: string, runId: string): void => {
    const tid = String(threadId ?? '').trim();
    const rid = String(runId ?? '').trim();
    if (!tid || !rid) return;

    cancelActiveRunSnapshotRecovery();
    const recoverySeq = activeSnapshotRecoverySeq;
    const assistantSeqAtStart = activeAssistantMessageSeq;
    activeSnapshotRecoveryTimer = window.setTimeout(() => {
      activeSnapshotRecoveryTimer = null;
      if (recoverySeq !== activeSnapshotRecoverySeq) return;
      if (tid !== String(ai.activeThreadId() ?? '').trim()) return;
      if (rid !== String(ai.runIdForThread(tid) ?? '').trim()) return;
      if (assistantSeqAtStart !== activeAssistantMessageSeq) return;
      if (hasStreamingAssistantMessage()) return;
      void loadActiveRunSnapshot(tid);
    }, ACTIVE_RUN_SNAPSHOT_RECOVERY_DELAY_MS);
  };

  onCleanup(() => {
    cancelActiveRunSnapshotRecovery();
  });

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

  const resetFollowupsState = () => {
    setQueuedFollowups([]);
    setDraftFollowups([]);
    setFollowupsRevision(null);
    setFollowupsPausedReason('');
    setFollowupsError('');
    setFollowupsLoading(false);
    setFollowupEditOpen(false);
    setFollowupEditID('');
    setFollowupEditLane('queued');
    setFollowupEditText('');
    setFollowupDeletingID(null);
    setFollowupReorderingLane(null);
    setDraggingFollowupID('');
    setDraggingFollowupLane(null);
    setLoadedDraftFollowupID('');
  };

  const normalizePageFollowupLane = (raw: unknown): FollowupLane => {
    const lane = String(raw ?? '').trim().toLowerCase();
    return lane === 'draft' ? 'draft' : 'queued';
  };

  const normalizePageFollowup = (raw: Partial<FollowupItem>): FollowupItem | null => {
    const followupID = String(raw?.followup_id ?? '').trim();
    const messageID = String(raw?.message_id ?? '').trim();
    if (!followupID || !messageID) return null;
    const lane = normalizePageFollowupLane(raw?.lane);
    const executionModeRaw = String(raw?.execution_mode ?? '').trim().toLowerCase();
    return {
      followup_id: followupID,
      lane,
      message_id: messageID,
      text: String(raw?.text ?? ''),
      model_id: String(raw?.model_id ?? '').trim() || undefined,
      execution_mode: executionModeRaw === 'plan' ? 'plan' : executionModeRaw === 'act' ? 'act' : undefined,
      position: Math.max(1, Math.floor(Number(raw?.position ?? 0) || 0)),
      created_at_unix_ms: Math.max(0, Math.floor(Number(raw?.created_at_unix_ms ?? 0) || 0)),
      attachments: Array.isArray(raw?.attachments) ? raw.attachments : undefined,
    };
  };

  const stopFollowupToPageFollowup = (raw: any): FollowupItem | null => {
    const followupID = String(raw?.followupId ?? '').trim();
    const messageID = String(raw?.messageId ?? '').trim();
    if (!followupID || !messageID) return null;
    const lane = normalizePageFollowupLane(raw?.lane);
    const executionModeRaw = String(raw?.executionMode ?? '').trim().toLowerCase();
    return {
      followup_id: followupID,
      lane,
      message_id: messageID,
      text: String(raw?.text ?? ''),
      model_id: String(raw?.modelId ?? '').trim() || undefined,
      execution_mode: executionModeRaw === 'plan' ? 'plan' : executionModeRaw === 'act' ? 'act' : undefined,
      position: Math.max(1, Math.floor(Number(raw?.position ?? 0) || 0)),
      created_at_unix_ms: Math.max(0, Math.floor(Number(raw?.createdAtUnixMs ?? 0) || 0)),
      attachments: Array.isArray(raw?.attachments)
        ? raw.attachments.map((attachment: any) => ({
            name: String(attachment?.name ?? ''),
            mime_type: String(attachment?.mimeType ?? '').trim() || undefined,
            url: String(attachment?.url ?? '').trim() || undefined,
          }))
        : undefined,
    };
  };

  const restoreFollowupAttachments = (item: FollowupItem): Attachment[] => {
    const attachments = Array.isArray(item.attachments) ? item.attachments : [];
    const restored: Attachment[] = [];
    for (const attachment of attachments) {
      const name = String(attachment?.name ?? '').trim();
      const mimeType = String(attachment?.mime_type ?? '').trim();
      const url = String(attachment?.url ?? '').trim();
      if (!name || !url) continue;
      const file = mimeType ? new File([], name, { type: mimeType }) : new File([], name);
      restored.push({
        id: createClientId('attachment'),
        file,
        type: mimeType.startsWith('image/') ? 'image' : 'file',
        preview: mimeType.startsWith('image/') ? url : undefined,
        uploadProgress: 100,
        status: 'uploaded',
        url,
      });
    }
    return restored;
  };

  const applyLoadedDraftExecutionMode = (item: FollowupItem) => {
    const executionModeRaw = String(item.execution_mode ?? '').trim().toLowerCase();
    if (executionModeRaw !== 'act' && executionModeRaw !== 'plan') return;
    const nextMode = executionModeRaw as ExecutionMode;
    setDraftExecutionMode(nextMode);
    persistExecutionMode(nextMode);
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) return;
    setThreadExecutionModeOverrideById((prev) => ({ ...prev, [tid]: nextMode }));
  };

  const loadFollowupIntoComposer = (item: FollowupItem) => {
    const inputApi = chatInputApi();
    if (!inputApi) return;
    inputApi.replaceDraft({
      text: String(item.text ?? ''),
      attachments: restoreFollowupAttachments(item),
    });
    setLoadedDraftFollowupID(String(item.followup_id ?? '').trim());
    applyLoadedDraftExecutionMode(item);
    inputApi.focusInput();
  };

  const requestLoadFollowup = (item: FollowupItem) => {
    const inputApi = chatInputApi();
    if (!inputApi) return;
    const followupID = String(item.followup_id ?? '').trim();
    if (followupID && followupID === String(loadedDraftFollowupID() ?? '').trim()) {
      inputApi.focusInput();
      return;
    }
    const snapshot = inputApi.snapshotDraft();
    if (composerSnapshotHasContent(snapshot)) {
      setPendingDraftLoad({ followup: item });
      setDraftLoadConfirmOpen(true);
      return;
    }
    loadFollowupIntoComposer(item);
  };

  const confirmLoadPendingDraft = () => {
    const pending = pendingDraftLoad();
    if (!pending) return;
    setDraftLoadConfirmOpen(false);
    setPendingDraftLoad(null);
    loadFollowupIntoComposer(pending.followup);
  };

  const applyFollowupList = (lane: FollowupLane, items: FollowupItem[]) => {
    const nextItems = reindexFollowups(items);
    if (lane === 'queued') {
      setQueuedFollowups(nextItems);
      return;
    }
    setDraftFollowups(nextItems);
  };

  const loadFollowups = async (
    threadId: string,
    opts?: {
      silent?: boolean;
    },
  ): Promise<void> => {
    const tid = String(threadId ?? '').trim();
    if (!tid) {
      resetFollowupsState();
      return;
    }

    const reqNo = ++lastFollowupsReq;
    const silent = !!opts?.silent;
    if (!silent) {
      setFollowupsLoading(true);
      setFollowupsError('');
    }

    try {
      const resp = await fetchGatewayJSON<ListFollowupsResponse>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/followups`,
        { method: 'GET' },
      );
      if (reqNo !== lastFollowupsReq) return;
      if (tid !== String(ai.activeThreadId() ?? '').trim()) return;

      const queued = Array.isArray(resp?.queued)
        ? reindexFollowups(resp.queued.map(normalizePageFollowup).filter((item): item is FollowupItem => !!item))
        : [];
      const drafts = Array.isArray(resp?.drafts)
        ? reindexFollowups(resp.drafts.map(normalizePageFollowup).filter((item): item is FollowupItem => !!item))
        : [];

      setQueuedFollowups(queued);
      setDraftFollowups(drafts);
      setFollowupsRevision(Number.isFinite(Number(resp?.revision)) ? Number(resp?.revision) : null);
      setFollowupsPausedReason(String(resp?.paused_reason ?? '').trim());
      setFollowupsError('');

      const loadedDraftID = String(loadedDraftFollowupID() ?? '').trim();
      if (loadedDraftID && !drafts.some((item) => String(item.followup_id ?? '').trim() === loadedDraftID)) {
        setLoadedDraftFollowupID('');
      }
    } catch (e) {
      if (reqNo !== lastFollowupsReq) return;
      if (tid !== String(ai.activeThreadId() ?? '').trim()) return;
      const msg = e instanceof Error ? e.message : String(e);
      setQueuedFollowups([]);
      setDraftFollowups([]);
      setFollowupsRevision(null);
      setFollowupsPausedReason('');
      setFollowupsError(msg || 'Request failed.');
    } finally {
      if (reqNo === lastFollowupsReq && !silent) {
        setFollowupsLoading(false);
      }
    }
  };

  const openFollowupEditor = (item: FollowupItem) => {
    setFollowupEditID(String(item.followup_id ?? '').trim());
    setFollowupEditLane(normalizePageFollowupLane(item.lane));
    setFollowupEditText(String(item.text ?? ''));
    setFollowupEditOpen(true);
  };

  const saveFollowupEdit = async () => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    const followupID = String(followupEditID() ?? '').trim();
    if (!tid || !followupID) return;
    if (!ensureRWX()) return;

    setFollowupEditSaving(true);
    try {
      await fetchGatewayJSON<{ ok: boolean }>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/followups/${encodeURIComponent(followupID)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ text: followupEditText() }),
        },
      );
      setFollowupEditOpen(false);
      await loadFollowups(tid, { silent: true });
      ai.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to update follow-up', msg || 'Request failed.');
    } finally {
      setFollowupEditSaving(false);
    }
  };

  const deleteFollowup = async (item: FollowupItem) => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    const followupID = String(item.followup_id ?? '').trim();
    if (!tid || !followupID) return;
    if (!ensureRWX()) return;

    setFollowupDeletingID(followupID);
    try {
      await fetchGatewayJSON<{ ok: boolean }>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/followups/${encodeURIComponent(followupID)}`,
        { method: 'DELETE' },
      );
      if (followupID === String(loadedDraftFollowupID() ?? '').trim()) {
        setLoadedDraftFollowupID('');
        chatInputApi()?.clearDraft();
      }
      await loadFollowups(tid, { silent: true });
      ai.bumpThreadsSeq();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to remove follow-up', msg || 'Request failed.');
    } finally {
      setFollowupDeletingID((current) => (current === followupID ? null : current));
    }
  };

  const commitFollowupOrder = async (lane: FollowupLane, nextItems: FollowupItem[]) => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) return;
    if (!ensureRWX()) return;

    const previousItems = lane === 'queued' ? queuedFollowups() : draftFollowups();
    applyFollowupList(lane, nextItems);
    setFollowupReorderingLane(lane);
    try {
      await fetchGatewayJSON<{ ok: boolean }>(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}/followups/order`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            lane,
            ordered_followup_ids: composeFollowupOrder(nextItems),
            expected_revision: followupsRevision() ?? undefined,
          }),
        },
      );
      ai.bumpThreadsSeq();
      await loadFollowups(tid, { silent: true });
    } catch (e) {
      applyFollowupList(lane, previousItems);
      void loadFollowups(tid, { silent: true });
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to reorder follow-ups', msg || 'Request failed.');
    } finally {
      setFollowupReorderingLane((current) => (current === lane ? null : current));
      setDraggingFollowupID('');
      setDraggingFollowupLane(null);
    }
  };

  const moveFollowup = (lane: FollowupLane, index: number, delta: number) => {
    const items = lane === 'queued' ? queuedFollowups() : draftFollowups();
    const nextItems = moveFollowupByDelta(items, index, delta);
    if (composeFollowupOrder(nextItems).join('|') === composeFollowupOrder(items).join('|')) {
      return;
    }
    void commitFollowupOrder(lane, nextItems);
  };

  const handleFollowupDragStart = (lane: FollowupLane, followupID: string) => {
    setDraggingFollowupLane(lane);
    setDraggingFollowupID(String(followupID ?? '').trim());
  };

  const handleFollowupDragEnd = () => {
    setDraggingFollowupID('');
    setDraggingFollowupLane(null);
  };

  const handleFollowupDrop = (lane: FollowupLane, targetFollowupID: string) => {
    const sourceFollowupID = String(draggingFollowupID() ?? '').trim();
    if (!sourceFollowupID || draggingFollowupLane() !== lane || sourceFollowupID === targetFollowupID) {
      handleFollowupDragEnd();
      return;
    }
    const items = lane === 'queued' ? queuedFollowups() : draftFollowups();
    const orderedIDs = composeFollowupOrder(items);
    const fromIndex = orderedIDs.indexOf(sourceFollowupID);
    const targetIndex = orderedIDs.indexOf(String(targetFollowupID ?? '').trim());
    if (fromIndex === -1 || targetIndex === -1) {
      handleFollowupDragEnd();
      return;
    }
    orderedIDs.splice(fromIndex, 1);
    orderedIDs.splice(targetIndex, 0, sourceFollowupID);
    const nextItems = reorderFollowupsByIDs(items, orderedIDs);
    void commitFollowupOrder(lane, nextItems);
  };

  const queueDraftForLater = async (item: FollowupItem) => {
    if (!activeThreadWaitingUser()) return;
    if (String(item.followup_id ?? '').trim() === String(loadedDraftFollowupID() ?? '').trim()) {
      return;
    }
    try {
      await sendUserTurn(String(item.text ?? ''), restoreFollowupAttachments(item), {
        sendIntent: 'queue_after_waiting_user',
        sourceFollowupId: String(item.followup_id ?? '').trim(),
      });
    } catch {
      // sendUserTurn already handled user-facing recovery and notifications
    }
  };

  const stopRun = () => {
    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) return;
    if (!ensureRWX()) return;
    setRunPhaseLabel('Stopping...');
    void rpc.ai.stopThread({ threadId: tid }).then(async (resp) => {
      const recovered = Array.isArray(resp?.recoveredFollowups)
        ? resp.recoveredFollowups.map(stopFollowupToPageFollowup).filter((item): item is FollowupItem => !!item)
        : [];
      setQueuedFollowups([]);
      setFollowupsPausedReason('');
      const inputApi = chatInputApi();
      if (inputApi && shouldAutoloadRecoveredFollowup(recovered, inputApi.snapshotDraft())) {
        loadFollowupIntoComposer(recovered[0]);
      } else if (recovered.length > 0) {
        notify.info('Run stopped', recovered.length === 1 ? 'Recovered 1 queued follow-up.' : `Recovered ${recovered.length} queued follow-ups.`);
      }
      await loadFollowups(tid, { silent: true });
      ai.bumpThreadsSeq();
      setRunPhaseLabel('Working');
    }).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to stop run', msg || 'Request failed.');
      setRunPhaseLabel('Working');
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
      resetFollowupsState();
      resetThreadSubagents();
      resetContextTelemetryState();
      setTodosError('');
      setTodosLoading(false);
      resetActiveTranscriptCursor('');
      return;
    }

    const tid = ai.activeThreadId();

    if (!tid) {
      chat?.clearMessages();
      setHasMessages(false);
      setRunPhaseLabel('Working');
      setThreadTodos(null);
      resetFollowupsState();
      resetThreadSubagents();
      resetContextTelemetryState();
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
    resetContextTelemetryState();
    setTodosError('');
    setTodosLoading(true);
    void loadThreadMessages(tid, { scrollToBottom: true, reset: true });
    void loadActiveRunSnapshot(tidStr);
    void loadThreadTodos(tid, { silent: false, notifyError: false });
    void loadFollowups(tidStr);
  });

  createEffect(() => {
    if (!chatReady()) return;

    const unsub = ai.onRealtimeEvent((event) => {
      const tid = String(event.threadId ?? '').trim();
      if (!tid) return;

      if (event.eventType === 'thread_summary') {
        const isActiveTid = tid === String(ai.activeThreadId() ?? '').trim();
        if (isActiveTid) {
          void loadFollowups(tid, { silent: true });
        }
        return;
      }

      if (event.eventType === 'transcript_reset') {
        const isActiveTid = tid === String(ai.activeThreadId() ?? '').trim();
        if (!isActiveTid) return;

        resetActiveTranscriptCursor(tid);
        chat?.clearMessages();
        setHasMessages(false);
        setRunPhaseLabel('Working');
        setThreadTodos(null);
        resetThreadSubagents();
        resetContextTelemetryState();
        setTodosError('');
        setTodosLoading(true);

        void loadThreadMessages(tid, { reset: true });
        void loadActiveRunSnapshot(tid);
        void loadThreadTodos(tid, { silent: true, notifyError: false });
        return;
      }

      if (event.eventType === 'transcript_message') {
        const rowId = Math.max(0, Math.floor(Number((event as any)?.messageRowId ?? 0) || 0));
        const messageJson = (event as any)?.messageJson ?? (event as any)?.message_json;
        const messageID = String(messageJson?.id ?? '').trim();
        if (!messageID) return;

        const decorated = decorateMessageBlocks(messageJson as Message);
        const messageRole = String((decorated as Message)?.role ?? messageJson?.role ?? '').trim().toLowerCase();

        const isActiveTid = tid === String(ai.activeThreadId() ?? '').trim();
        if (isActiveTid) {
          if (messageRole === 'assistant') {
            activeAssistantMessageSeq += 1;
            cancelActiveRunSnapshotRecovery();
          }
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
        }
        return;
      }

      if (event.eventType === 'stream_event') {
        const streamEvent = event.streamEvent as any;
        const streamType = String(streamEvent?.type ?? '').trim().toLowerCase();
        const streamKind = String(event.streamKind ?? '').trim().toLowerCase();
        const eventRunID = String(event.runId ?? '').trim();
        if (tid === String(ai.activeThreadId() ?? '').trim()) {
          if (eventRunID) {
            ensureContextRun(eventRunID);
          }
        }
        if (tid === String(ai.activeThreadId() ?? '').trim() && (streamKind === 'context' || streamType === 'context-usage' || streamType === 'context-compaction')) {
          if (streamType === 'context-usage') {
            applyContextUsagePayload(streamEvent?.payload, {
              atUnixMs: event.atUnixMs,
            });
          } else if (streamType === 'context-compaction') {
            const eventType = String(streamEvent?.eventType ?? '').trim();
            if (eventType) {
              applyContextCompactionPayload(eventType, streamEvent?.payload, {
                atUnixMs: event.atUnixMs,
              });
            }
          }
          return;
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
          const isAssistantProgressEvent =
            streamType === 'message-start' ||
            streamType === 'block-start' ||
            streamType === 'block-delta' ||
            streamType === 'block-set';
          if (isAssistantProgressEvent) {
            activeAssistantMessageSeq += 1;
            cancelActiveRunSnapshotRecovery();
          }
          chat?.handleStreamEvent(decorateStreamEvent(streamEvent) as any);
          rebuildSubagentsFromMessages(chat?.messages() ?? []);
          setHasMessages(true);
        }
        return;
      }

      const status = String(event.runStatus ?? '').trim().toLowerCase();
      if (!isTerminalRunStatus(status)) {
        return;
      }

      if (tid === String(ai.activeThreadId() ?? '').trim()) {
        setRunPhaseLabel('Working');
        cancelActiveRunSnapshotRecovery();
        void loadThreadMessages(tid, { reset: false });
      }

      const runId = String(event.runId ?? '').trim();
      if (tid === String(ai.activeThreadId() ?? '').trim() && runId) {
        void loadContextRunEvents(runId, {
          reset: runId !== activeContextRunID,
          maxPages: RUN_CONTEXT_EVENTS_MAX_PAGES,
        });
      }
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

  createEffect(() => {
    if (!chatReady()) return;
    if (protocol.status() !== 'connected' || !ai.aiEnabled()) return;
    if (!canRWXReady()) return;

    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) return;

    const runId = String(ai.runIdForThread(tid) ?? '').trim();
    if (!runId) return;

    const needReset = runId !== activeContextRunID;
    if (!ensureContextRun(runId, { reset: needReset })) return;
    void loadContextRunEvents(runId, {
      reset: needReset,
      maxPages: RUN_CONTEXT_EVENTS_MAX_PAGES,
    });
  });

  createEffect(() => {
    if (!chatReady()) return;
    if (protocol.status() !== 'connected' || !ai.aiEnabled()) return;
    if (!canRWXReady()) return;

    const tid = String(ai.activeThreadId() ?? '').trim();
    if (!tid) return;
    if (!activeThreadRunning()) return;

    const runId = String(ai.runIdForThread(tid) ?? activeContextRunID).trim();
    if (!runId) return;

    const timer = window.setInterval(() => {
      void loadContextRunEvents(runId, { reset: false, maxPages: 2 });
    }, 2000);
    onCleanup(() => window.clearInterval(timer));
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
    return uploadGatewayFile(file);
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

  type SendUserTurnOptions = {
    userMessageId?: string;
    sendIntent?: SendIntent;
    sourceFollowupId?: string;
    sourceDraftSnapshot?: AIChatInputDraftSnapshot;
  };

  type PendingSendContext = {
    sendIntent: SendIntent;
    sourceFollowupId: string;
    sourceDraftSnapshot?: AIChatInputDraftSnapshot;
    hasOptimisticMessage: boolean;
  };

  type StructuredComposerSendPlan =
    | {
        kind: 'submit';
        promptId: string;
        answers: Record<string, { selectedOptionId?: string; answers: string[] }>;
        inputText: string;
      }
    | {
        kind: 'error';
        title: string;
        description: string;
      };

  class ComposerSendRejectedError extends Error {}

  const consumePendingSendContext = (userMessageId: string, fallback?: Partial<PendingSendContext>): PendingSendContext => {
    const id = String(userMessageId ?? '').trim();
    const context: PendingSendContext = {
      sendIntent: id ? (sendIntentByMessageId.get(id) ?? fallback?.sendIntent ?? 'default') : (fallback?.sendIntent ?? 'default'),
      sourceFollowupId: id
        ? String(sourceFollowupIDByMessageId.get(id) ?? fallback?.sourceFollowupId ?? '').trim()
        : String(fallback?.sourceFollowupId ?? '').trim(),
      sourceDraftSnapshot: id ? (draftSnapshotByMessageId.get(id) ?? fallback?.sourceDraftSnapshot) : fallback?.sourceDraftSnapshot,
      hasOptimisticMessage: id ? true : Boolean(fallback?.hasOptimisticMessage),
    };
    if (id) {
      sendIntentByMessageId.delete(id);
      sourceFollowupIDByMessageId.delete(id);
      draftSnapshotByMessageId.delete(id);
    }
    return context;
  };

  const rollbackRejectedComposerSend = (context?: Partial<PendingSendContext>) => {
    setSendPending(false);
    setRunPhaseLabel('Working');
    const optimisticOffset = context?.hasOptimisticMessage ? 1 : 0;
    const remainingMessages = Math.max(0, (chat?.messages() ?? []).length - optimisticOffset);
    setHasMessages(remainingMessages > 0);

    const sourceFollowupId = String(context?.sourceFollowupId ?? '').trim();
    if (!sourceFollowupId || !context?.sourceDraftSnapshot || !chatInputApi()) {
      return;
    }
    chatInputApi()?.replaceDraft(context.sourceDraftSnapshot);
    setLoadedDraftFollowupID(sourceFollowupId);
    chatInputApi()?.focusInput();
  };

  const normalizeStructuredDraftAnswer = (draft: { selectedOptionId?: string; answers?: string[] } | undefined) => ({
    selectedOptionId: String(draft?.selectedOptionId ?? '').trim() || undefined,
    answers: Array.isArray(draft?.answers) ? draft.answers.map((item) => String(item ?? '').trim()).filter(Boolean) : [],
  });

  const selectedWaitingPromptOption = (question: {
    options?: ReadonlyArray<{ option_id?: string; detail_input_mode?: string }>;
  }, draft: { selectedOptionId?: string; answers?: string[] } | undefined) => {
    const normalized = normalizeStructuredDraftAnswer(draft);
    const selectedOptionId = String(normalized.selectedOptionId ?? '').trim();
    if (!selectedOptionId) return undefined;
    const options = Array.isArray(question.options) ? question.options : [];
    return options.find((option) => String(option?.option_id ?? '').trim() === selectedOptionId);
  };

  const waitingPromptQuestionAllowsText = (question: {
    is_other?: boolean;
    options?: ReadonlyArray<{ option_id?: string; detail_input_mode?: string }>;
  }, draft: { selectedOptionId?: string; answers?: string[] } | undefined): boolean => {
    const options = Array.isArray(question.options) ? question.options : [];
    if (Boolean(question.is_other) || options.length === 0) {
      return true;
    }
    const selectedOption = selectedWaitingPromptOption(question, draft);
    const mode = String(selectedOption?.detail_input_mode ?? '').trim().toLowerCase();
    return mode === 'optional' || mode === 'required';
  };

  const waitingPromptQuestionRequiresText = (question: {
    options?: ReadonlyArray<{ option_id?: string; detail_input_mode?: string }>;
  }, draft: { selectedOptionId?: string; answers?: string[] } | undefined): boolean => {
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length === 0) {
      return true;
    }
    return String(selectedWaitingPromptOption(question, draft)?.detail_input_mode ?? '').trim().toLowerCase() === 'required';
  };

  const waitingPromptQuestionRequiresSelection = (question: {
    is_other?: boolean;
    options?: ReadonlyArray<unknown>;
  }): boolean => {
    const options = Array.isArray(question.options) ? question.options : [];
    return options.length > 0 && !question.is_other;
  };

  const hasStructuredDraftAnswer = (
    question: {
      is_other?: boolean;
      options?: ReadonlyArray<{ option_id?: string; detail_input_mode?: string }>;
    },
    draft: { selectedOptionId?: string; answers?: string[] } | undefined,
  ): boolean => {
    const normalized = normalizeStructuredDraftAnswer(draft);
    const hasSelection = Boolean(normalized.selectedOptionId);
    const hasText = normalized.answers.length > 0;
    if (waitingPromptQuestionRequiresSelection(question) && !hasSelection) {
      return false;
    }
    if (!waitingPromptQuestionRequiresSelection(question) && !hasSelection && !hasText) {
      return false;
    }
    if (!waitingPromptQuestionAllowsText(question, normalized) && hasText) {
      return false;
    }
    if (waitingPromptQuestionRequiresText(question, normalized) && !hasText) {
      return false;
    }
    return true;
  };

  const canComposerAutofillWaitingQuestion = (question: {
    is_secret?: boolean;
    is_other?: boolean;
    options?: ReadonlyArray<{ option_id?: string; detail_input_mode?: string }>;
  }, draft: { selectedOptionId?: string; answers?: string[] } | undefined): boolean => {
    if (question.is_secret) return false;
    return waitingPromptQuestionAllowsText(question, draft);
  };

  const buildStructuredComposerSendPlan = (args: {
    waitingPrompt: ReturnType<typeof ai.activeThreadWaitingPrompt>;
    composerText: string;
    drafts: Record<string, { selectedOptionId?: string; answers: string[] }>;
  }): StructuredComposerSendPlan => {
    const promptId = String(args.waitingPrompt?.prompt_id ?? '').trim();
    if (!promptId) {
      return {
        kind: 'error',
        title: 'Input required',
        description: 'The pending input request is no longer available.',
      };
    }

    const answers: Record<string, { selectedOptionId?: string; answers: string[] }> = {};
    Object.entries(args.drafts ?? {}).forEach(([questionId, draft]) => {
      const qid = String(questionId ?? '').trim();
      if (!qid) return;
      answers[qid] = normalizeStructuredDraftAnswer(draft);
    });

    const questions = Array.isArray(args.waitingPrompt?.questions) ? args.waitingPrompt.questions : [];
    const unanswered = questions.filter((question) => !hasStructuredDraftAnswer(question, answers[String(question.id ?? '').trim()]));
    const composerText = String(args.composerText ?? '').trim();

    if (composerText && unanswered.length === 1) {
      const question = unanswered[0];
      const questionId = String(question.id ?? '').trim();
      const currentDraft = answers[questionId];
      if (question.is_secret) {
        return {
          kind: 'error',
          title: 'Input required',
          description: 'Use the inline input card to answer secret requests.',
        };
      }
      if (!canComposerAutofillWaitingQuestion(question, currentDraft)) {
        return {
          kind: 'error',
          title: 'Input required',
          description: 'Select one of the requested options before replying.',
        };
      }
      answers[questionId] = {
        selectedOptionId: currentDraft?.selectedOptionId,
        answers: [composerText],
      };
    } else if (composerText && unanswered.length > 1) {
      return {
        kind: 'error',
        title: 'Input required',
        description: 'Resolve all requested input fields before replying.',
      };
    }

    const remaining = questions.filter((question) => !hasStructuredDraftAnswer(question, answers[String(question.id ?? '').trim()]));
    if (remaining.length > 0) {
      const secretOnly = remaining.every((question) => Boolean(question.is_secret));
      return {
        kind: 'error',
        title: 'Input required',
        description: secretOnly
          ? 'Use the inline input card to answer the pending secret request.'
          : 'Resolve the pending input request before replying.',
      };
    }

    return {
      kind: 'submit',
      promptId,
      answers,
      inputText: composerText && unanswered.length === 0 ? composerText : '',
    };
  };

  const submitStructuredPromptResponseFromComposer = async (
    threadId: string,
    content: string,
    attachments: Attachment[],
    userMessageId: string,
    context: PendingSendContext,
  ) => {
    const tid = String(threadId ?? '').trim();
    const waitingPrompt = ai.activeThreadWaitingPrompt();
    const promptId = String(waitingPrompt?.prompt_id ?? '').trim();
    if (!tid || !promptId) {
      rollbackRejectedComposerSend(context);
      throw new Error('The pending input request is no longer available.');
    }

    const plan = buildStructuredComposerSendPlan({
      waitingPrompt,
      composerText: content,
      drafts: ai.getStructuredPromptDrafts(tid, promptId),
    });
    if (plan.kind === 'error') {
      rollbackRejectedComposerSend(context);
      notify.error(plan.title, plan.description);
      throw new Error(plan.description);
    }

    const uploaded = attachments.filter((attachment) => attachment.status === 'uploaded' && !!String(attachment.url ?? '').trim());
    const attIn = uploaded.map((attachment) => ({
      name: attachment.file.name,
      mimeType: attachment.file.type,
      url: String(attachment.url ?? '').trim(),
    }));

    try {
      const expectedRunId = String(ai.runIdForThread(tid) ?? '').trim();
      const resp = await ai.submitStructuredPromptResponse({
        threadId: tid,
        promptId: plan.promptId,
        messageId: userMessageId,
        answers: plan.answers,
        text: plan.inputText,
        attachments: attIn,
        expectedRunId: expectedRunId || undefined,
        sourceFollowupId: context.sourceFollowupId || undefined,
      });

      const appliedExecutionModeRaw = String(resp.appliedExecutionMode ?? '').trim();
      if (appliedExecutionModeRaw) {
        const appliedExecutionMode = normalizeExecutionMode(appliedExecutionModeRaw);
        setDraftExecutionMode(appliedExecutionMode);
        persistExecutionMode(appliedExecutionMode);
        setThreadExecutionModeOverrideById((prev) => ({ ...prev, [tid]: appliedExecutionMode }));
      }
      if (context.sourceFollowupId) {
        setLoadedDraftFollowupID((current) => (current === context.sourceFollowupId ? '' : current));
      }

      const runId = String(resp.runId ?? '').trim();
      if (runId) {
        ensureContextRun(runId, { reset: true });
        void loadContextRunEvents(runId, { reset: true });
        scheduleActiveRunSnapshotRecovery(tid, runId);
      } else {
        setRunPhaseLabel('Working');
      }

      ai.bumpThreadsSeq();
      void loadFollowups(tid, { silent: true });
    } catch (error) {
      rollbackRejectedComposerSend(context);
      const msg = error instanceof Error ? error.message : String(error);
      notify.error('AI failed', msg || 'Request failed.');
      void loadThreadMessages(tid);
      void loadFollowups(tid, { silent: true });
      throw error instanceof Error ? error : new Error(msg || 'Request failed.');
    }
  };

  const sendUserTurn = async (content: string, attachments: Attachment[], opts: SendUserTurnOptions = {}) => {
    const context: PendingSendContext = {
      sendIntent: opts.sendIntent ?? 'default',
      sourceFollowupId: String(opts.sourceFollowupId ?? '').trim(),
      sourceDraftSnapshot: opts.sourceDraftSnapshot,
      hasOptimisticMessage: Boolean(String(opts.userMessageId ?? '').trim()),
    };
    if (!chat) {
      notify.error('AI unavailable', 'Chat is not ready.');
      rollbackRejectedComposerSend(context);
      throw new Error('Chat is not ready.');
    }
    if (!ensureRWX()) {
      rollbackRejectedComposerSend(context);
      throw new Error('Read/write/execute permission required.');
    }
    if (!ai.aiEnabled()) {
      notify.error('AI not configured', 'Open Agent Settings to enable AI.');
      rollbackRejectedComposerSend(context);
      throw new Error('AI is not configured.');
    }
    if (ai.models.error) {
      const msg = ai.models.error instanceof Error ? ai.models.error.message : String(ai.models.error);
      notify.error('AI unavailable', msg || 'Failed to load models.');
      rollbackRejectedComposerSend(context);
      throw new Error(msg || 'Failed to load models.');
    }

    const model = ai.selectedModel().trim();
    if (!model) {
      notify.error('Missing model', 'Please select a model.');
      rollbackRejectedComposerSend(context);
      throw new Error('Please select a model.');
    }

    const userMessageId = String(opts.userMessageId ?? '').trim();
    const sendIntent = context.sendIntent;
    const sourceFollowupId = context.sourceFollowupId;

    setHasMessages(true);
    setSendPending(true);
    setRunPhaseLabel('Planning...');
    if (userMessageId) {
      requestScrollToBottom('user');
    }

    let tid = ai.activeThreadId();
    if (!tid) {
      skipNextThreadLoad = true;
      tid = await ai.ensureThreadForSend({ executionMode: executionMode() });
      if (!tid) {
        skipNextThreadLoad = false;
      }
    }
    if (!tid) {
      rollbackRejectedComposerSend(context);
      throw new Error('Send was not started.');
    }

    const userText = String(content ?? '').trim();
    const uploaded = attachments.filter((attachment) => attachment.status === 'uploaded' && !!String(attachment.url ?? '').trim());
    const attIn = uploaded.map((attachment) => ({
      name: attachment.file.name,
      mimeType: attachment.file.type,
      url: String(attachment.url ?? '').trim(),
    }));
    const activeTid = String(ai.activeThreadId() ?? '').trim();
    const activeWaitingPrompt = tid === activeTid ? ai.activeThreadWaitingPrompt() : null;
    const waitingPromptId = String(activeWaitingPrompt?.prompt_id ?? '').trim();

    ai.markThreadPendingRun(tid);

    try {
      try {
        await rpc.ai.subscribeThread({ threadId: tid });
      } catch {
        // Best-effort: sendUserTurn still persists the message and can self-heal via transcript refresh.
      }

      setRunPhaseLabel('Planning...');
      const baseReq = {
        threadId: tid,
        model,
        input: {
          messageId: userMessageId || undefined,
          text: userText,
          attachments: attIn,
        },
        options: { maxSteps: 10, mode: executionMode() },
        queueAfterWaitingUser: sendIntent === 'queue_after_waiting_user' ? true : undefined,
        sourceFollowupId: sourceFollowupId || undefined,
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
      const responseKind = String(resp.kind ?? '').trim().toLowerCase();
      const consumedWaitingPromptId = String(resp.consumedWaitingPromptId ?? '').trim();
      if (consumedWaitingPromptId) {
        ai.consumeWaitingPrompt(tid, consumedWaitingPromptId);
      } else if (waitingPromptId && sendIntent !== 'queue_after_waiting_user') {
        ai.clearThreadPendingRun(tid);
        rollbackRejectedComposerSend(context);
        notify.error('Input required', 'Resolve the requested input before sending a new message.');
        throw new ComposerSendRejectedError('Resolve the requested input before sending a new message.');
      }
      const appliedExecutionModeRaw = String(resp.appliedExecutionMode ?? '').trim();
      if (appliedExecutionModeRaw) {
        const appliedExecutionMode = normalizeExecutionMode(appliedExecutionModeRaw);
        setDraftExecutionMode(appliedExecutionMode);
        persistExecutionMode(appliedExecutionMode);
        setThreadExecutionModeOverrideById((prev) => ({ ...prev, [tid]: appliedExecutionMode }));
      }
      if (sourceFollowupId) {
        setLoadedDraftFollowupID((current) => (current === sourceFollowupId ? '' : current));
      }
      if (responseKind === 'queued') {
        ai.clearThreadPendingRun(tid);
        if (userMessageId) {
          chat?.deleteMessage(userMessageId);
          setHasMessages((chat?.messages() ?? []).length > 0);
        }
        setRunPhaseLabel('Working');
        void loadFollowups(tid, { silent: true });
      }
      if (rid) {
        ai.confirmThreadRun(tid, rid);
        ensureContextRun(rid, { reset: true });
        void loadContextRunEvents(rid, { reset: true });
        scheduleActiveRunSnapshotRecovery(tid, rid);
      }
      ai.bumpThreadsSeq();
      if (responseKind === 'steer' || responseKind === 'queued') {
        setRunPhaseLabel('Working');
      }
    } catch (e) {
      ai.clearThreadPendingRun(tid);
      if (e instanceof ComposerSendRejectedError) {
        throw e;
      }
      rollbackRejectedComposerSend(context);
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('AI failed', msg || 'Request failed.');
      setRunPhaseLabel('Working');
      void loadThreadMessages(tid);
      void loadFollowups(tid, { silent: true });
      throw e instanceof Error ? e : new Error(msg || 'Request failed.');
    } finally {
      setSendPending(false);
    }
  };

  let sendUserTurnQueue: Promise<void> = Promise.resolve();
  const enqueueSendUserTurn = (content: string, attachments: Attachment[], opts: SendUserTurnOptions = {}) => {
    const task = sendUserTurnQueue.then(() => sendUserTurn(content, attachments, opts));
    sendUserTurnQueue = task.catch(() => {});
    return task;
  };

  const callbacks: ChatCallbacks = {
    onWillSend: (content, attachments, userMessageId) => {
      if (import.meta.env.DEV) console.debug('[AI Chat] onWillSend fired at', performance.now().toFixed(1), 'ms');

      const intent = nextSendIntent;
      nextSendIntent = 'default';
      sendIntentByMessageId.set(userMessageId, intent);

      const sourceFollowupId = String(loadedDraftFollowupID() ?? '').trim();
      if (sourceFollowupId) {
        sourceFollowupIDByMessageId.set(userMessageId, sourceFollowupId);
        draftSnapshotByMessageId.set(userMessageId, {
          text: content,
          attachments: attachments.map((attachment) => ({ ...attachment })),
        });
      }

      if (!canInteract()) return;
      setSendPending(true);
      setHasMessages(true);
      setRunPhaseLabel('Planning...');
      requestScrollToBottom('user');
    },
    onSendMessage: async (content, attachments, userMessageId, _addMessage) => {
      const context = consumePendingSendContext(userMessageId);
      if (protocol.status() !== 'connected') {
        rollbackRejectedComposerSend(context);
        notify.error('Not connected', 'Connecting to agent...');
        throw new Error('Connecting to agent...');
      }
      if (!ensureRWX()) {
        rollbackRejectedComposerSend(context);
        throw new Error('Read/write/execute permission required.');
      }

      const activeThreadId = String(ai.activeThreadId() ?? '').trim();
      const activeWaitingPrompt = activeThreadId ? ai.activeThreadWaitingPrompt() : null;
      if (activeThreadId && activeWaitingPrompt && context.sendIntent !== 'queue_after_waiting_user') {
        await submitStructuredPromptResponseFromComposer(activeThreadId, content, attachments, userMessageId, context);
        return;
      }

      await enqueueSendUserTurn(content, attachments, {
        userMessageId,
        sendIntent: context.sendIntent,
        sourceFollowupId: context.sourceFollowupId || undefined,
        sourceDraftSnapshot: context.sourceDraftSnapshot,
      });
    },
    onUploadAttachment: uploadAttachment,
    onToolApproval: sendToolApproval,
  };

  const openRename = () => {
    const t = ai.activeThread();
    setRenameTitle(String(t?.title ?? ''));
    setRenameOpen(true);
  };

  const openDelete = () => {
    setDeleteForce(activeThreadRunning());
    setDeleteOpen(true);
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
      const resp = await fetch(url, await prepareGatewayRequestInit({ method: 'DELETE' }));
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
    void enqueueSendUserTurn(prompt, []).catch(() => {});
  };

  const headerMoreItems = createMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];
    if (ai.activeThreadId() && canRWXReady() && !activeThreadRunning()) {
      items.push({ id: 'rename', label: 'Rename chat' });
    }
    if (ai.activeThreadId() && canRWXReady()) {
      items.push({ id: 'delete', label: 'Delete chat' });
    }
    items.push({ id: 'settings', label: 'AI settings' });
    return items;
  });

  const handleHeaderMoreSelect = (itemId: string) => {
    if (itemId === 'rename') {
      if (!ai.activeThreadId() || activeThreadRunning() || !canRWXReady()) return;
      openRename();
      return;
    }

    if (itemId === 'delete') {
      if (!ai.activeThreadId() || !canRWXReady()) return;
      openDelete();
      return;
    }

    if (itemId === 'settings') {
      env.openSettings('ai');
    }
  };

  const hasInlineRunIndicator = createMemo(() => sendPending() || activeThreadRunning());
  const inlineRunIndicatorMessageId = createMemo(() => {
    if (!chatReady()) return '';

    const currentMessages = chat?.messages() ?? [];
    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      const message = currentMessages[index];
      if (message.role === 'assistant' && message.status === 'streaming') {
        return message.id;
      }
    }

    if (!hasInlineRunIndicator()) return '';

    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      const message = currentMessages[index];
      if (message.role === 'assistant') {
        return message.id;
      }
    }

    return '';
  });

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <ChatProvider
        config={{
          placeholder: 'Describe what you want to do...',
          assistantAvatar: FlowerAssistantAvatar,
          showListWorkingIndicator: false,
          renderMessageOrnament: ({ message, isActiveAssistantStreaming }) => {
            if (message.role !== 'assistant') return null;

            const targetMessageId = inlineRunIndicatorMessageId();
            if (!targetMessageId) return null;
            if (!isActiveAssistantStreaming && message.id !== targetMessageId) return null;

            return <FlowerMessageRunIndicator phaseLabel={runPhaseLabel()} />;
          },
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
                        Configure an AI provider in Agent Settings to start using Flower.
                      </div>
                      <Button size="md" variant="default" onClick={() => env.openSettings('ai')}>
                        <Settings class="w-4 h-4 mr-2" />
                        Open Agent Settings
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
                      Open Agent Settings
                    </Button>
                  </Motion.div>
                </Show>
              }
            >
              {/* Chat area — sidebar is managed by Shell */}
              <div class="flower-chat-shell">
                {/* Header */}
                <div class="chat-header flower-chat-header border-b border-border/80 bg-background/95 backdrop-blur-md">
                  <div class="chat-header-title flower-chat-header-title">
                    <span class="truncate font-medium">{ai.activeThreadTitle()}</span>
                  </div>
                  <div class="flower-chat-header-actions">
                    <Show when={ai.aiEnabled() && ai.modelOptions().length > 0}>
                      <Select
                        value={ai.selectedModel()}
                        onChange={(v) => ai.selectModel(String(v ?? '').trim())}
                        options={ai.modelOptions()}
                        placeholder="Select model..."
                        disabled={ai.models.loading || !!ai.models.error || activeThreadRunning() || !canRWXReady()}
                        class="ai-model-select-trigger flower-chat-model-select min-w-[120px] max-w-[160px] sm:min-w-[140px] sm:max-w-[200px] h-7 text-[11px]"
                      />
                    </Show>

                    <Show when={activeThreadRunning()}>
                      <Tooltip content="Stop generation" placement="bottom" delay={0}>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Stop}
                          onClick={() => stopRun()}
                          disabled={!canRWXReady()}
                          class="flower-chat-stop-button h-7 px-2.5 text-error"
                        >
                          Stop
                        </Button>
                      </Tooltip>
                    </Show>

                    <Dropdown
                      trigger={(
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="More actions"
                          title="More actions"
                          class="flower-chat-header-more-trigger"
                        >
                          <MoreVerticalIcon class="w-4 h-4" />
                        </Button>
                      )}
                      items={headerMoreItems()}
                      onSelect={handleHeaderMoreSelect}
                      align="end"
                    />
                  </div>
                </div>

                <div class="flower-chat-main">
                  <div class="flower-chat-transcript">
                    <Show when={ai.settings.error || (ai.models.error && ai.aiEnabled())}>
                      <div class="flower-chat-status-stack">
                        {/* Error banner: Settings unavailable */}
                        <Show when={ai.settings.error}>
                          <div class="mx-3 mt-3 px-4 py-3 text-xs rounded-xl shadow-sm bg-error/5 border border-error/20">
                            <div class="flex items-center gap-2 font-medium text-error">
                              <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                              </svg>
                              Agent Settings are not available
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
                      </div>
                    </Show>

                    {/* Message list with empty state + file browser FAB */}
                    <div ref={messageAreaRef} class="flower-chat-transcript-main">
                      <MessageListWithEmptyState
                        hasMessages={hasMessages()}
                        loading={messagesLoading()}
                        onSuggestionClick={handleSuggestionClick}
                        disabled={!canInteract()}
                        class="h-full"
                      />
                      <ChatFileBrowserFAB
                        workingDir={activeWorkingDir()}
                        homePath={homePath()}
                        enabled={canInteract() && protocol.status() === 'connected'}
                        containerRef={messageAreaRef}
                      />
                    </div>
                  </div>

                  <div class="flower-chat-bottom-dock">
                    {/* Toolbar: Tasks chip + Execution mode toggle */}
                    <div class="relative px-3 pt-1 pb-1.5 chat-toolbar-separator flower-chat-toolbar">
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
                          <Show when={ai.activeThreadId() && hasContextTelemetry()}>
                            <CompactContextSummary
                              usage={contextUsage()}
                              compactions={contextCompactions()}
                            />
                          </Show>
                          <Show when={!ai.activeThreadId() || (activeThreadTodos().length === 0 && activeThreadSubagents().length === 0 && !hasContextTelemetry())}>
                            <span class="text-[11px] text-muted-foreground">Execution mode</span>
                          </Show>
                        </div>
                        <ExecutionModeToggle
                          value={executionMode()}
                          disabled={activeThreadRunning()}
                          onChange={(mode) => {
                            void updateExecutionMode(mode);
                          }}
                        />
                      </div>
                    </div>

                    <Show when={hasBottomDockPanels()}>
                      <div class="flower-chat-bottom-dock-support">
                        <Show when={draftFollowups().length > 0}>
                          <div class="flower-queued-turns-panel flower-followups-drafts-panel">
                            <div class="flower-queued-turns-header">
                              <div class="flower-queued-turns-header-main">
                                <span class="flower-queued-turns-title">Draft follow-ups</span>
                                <span class="flower-queued-turns-count">{draftFollowups().length}</span>
                              </div>
                              <div class="flower-queued-turns-hint">These stay under your control until you load them or queue them later.</div>
                            </div>
                            <div class="flower-queued-turns-list">
                              <For each={draftFollowups()}>
                                {(item, index) => {
                                  const attachments = () => Array.isArray(item.attachments) ? item.attachments : [];
                                  const attachmentCount = () => attachments().length;
                                  const attachmentLabel = () => attachmentCount() === 1 ? '1 attachment' : `${attachmentCount()} attachments`;
                                  const createdAtLabel = () => formatQueuedTurnTime(item.created_at_unix_ms);
                                  const executionModeLabel = () => {
                                    const mode = String(item.execution_mode ?? '').trim().toLowerCase();
                                    return mode === 'plan' ? 'Plan' : mode === 'act' ? 'Act' : '';
                                  };
                                  const followupID = () => String(item.followup_id ?? '').trim();
                                  const messageText = () => String(item.text ?? '').trim() || 'Attachment-only follow-up';
                                  const deleting = () => followupDeletingID() === followupID();
                                  const isLoaded = () => loadedDraftFollowupID() === followupID();
                                  const reorderDisabled = () => !canInteract() || !!followupReorderingLane() || isLoaded();
                                  return (
                                    <div
                                      class={cn('flower-queued-turn-item', isLoaded() && 'flower-followup-item-loaded')}
                                      draggable={!reorderDisabled()}
                                      onDragStart={() => handleFollowupDragStart('draft', followupID())}
                                      onDragEnd={() => handleFollowupDragEnd()}
                                      onDragOver={(e) => {
                                        if (draggingFollowupLane() !== 'draft') return;
                                        e.preventDefault();
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        handleFollowupDrop('draft', followupID());
                                      }}
                                    >
                                      <div class="flower-queued-turn-item-main">
                                        <div class="flower-followup-leading">
                                          <button
                                            type="button"
                                            class="flower-followup-drag-handle"
                                            disabled={reorderDisabled()}
                                            onMouseDown={(e) => e.preventDefault()}
                                            title="Drag to reorder"
                                          >
                                            ⋮⋮
                                          </button>
                                          <div class="flower-queued-turn-position">{item.position}</div>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                          <div class="flower-queued-turn-item-meta">
                                            <Show when={createdAtLabel()}>
                                              <span class="flower-queued-turn-chip">{createdAtLabel()}</span>
                                            </Show>
                                            <Show when={executionModeLabel()}>
                                              <span class="flower-queued-turn-chip">{executionModeLabel()}</span>
                                            </Show>
                                            <Show when={String(item.model_id ?? '').trim()}>
                                              <span class="flower-queued-turn-chip truncate max-w-[14rem]" title={String(item.model_id ?? '').trim()}>
                                                {String(item.model_id ?? '').trim()}
                                              </span>
                                            </Show>
                                            <Show when={attachmentCount() > 0}>
                                              <span class="flower-queued-turn-chip">{attachmentLabel()}</span>
                                            </Show>
                                            <Show when={isLoaded()}>
                                              <span class="flower-followup-state-chip">Loaded</span>
                                            </Show>
                                          </div>
                                          <p class="flower-queued-turn-text" title={messageText()}>{messageText()}</p>
                                        </div>
                                      </div>
                                      <div class="flower-queued-turn-actions">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Move up"
                                          onClick={() => moveFollowup('draft', index(), -1)}
                                          disabled={reorderDisabled() || index() === 0}
                                        >
                                          <ChevronUp class="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Move down"
                                          onClick={() => moveFollowup('draft', index(), 1)}
                                          disabled={reorderDisabled() || index() === draftFollowups().length - 1}
                                        >
                                          <ChevronUp class="w-3.5 h-3.5 rotate-180" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant={isLoaded() ? 'outline' : 'ghost'}
                                          title={isLoaded() ? 'Draft already loaded' : 'Load into editor'}
                                          onClick={() => requestLoadFollowup(item)}
                                          disabled={deleting()}
                                        >
                                          {isLoaded() ? 'Loaded' : 'Load'}
                                        </Button>
                                        <Show when={activeThreadWaitingUser() && !isLoaded()}>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            title="Queue for later"
                                            onClick={() => void queueDraftForLater(item)}
                                            disabled={!canInteract() || deleting() || followupReorderingLane() === 'draft'}
                                          >
                                            Queue
                                          </Button>
                                        </Show>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Edit draft follow-up"
                                          onClick={() => openFollowupEditor(item)}
                                          disabled={!canInteract() || deleting() || isLoaded()}
                                        >
                                          <Pencil class="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Remove draft follow-up"
                                          onClick={() => void deleteFollowup(item)}
                                          disabled={!canInteract() || deleting() || isLoaded()}
                                        >
                                          <Trash class="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>

                        <Show when={shouldShowQueuedTurnsPanel()}>
                          <div class="flower-queued-turns-panel">
                            <div class="flower-queued-turns-header">
                              <div class="flower-queued-turns-header-main">
                                <span class="flower-queued-turns-title">Queued follow-ups</span>
                                <span class="flower-queued-turns-count">{activeQueuedTurnCount()}</span>
                                <Show when={followupsPausedReason() === 'waiting_user'}>
                                  <span class="flower-followup-state-chip">Paused</span>
                                </Show>
                              </div>
                              <div class="flower-queued-turns-hint">{queuedTurnHint()}</div>
                            </div>
                            <div class="flower-queued-turns-list">
                              <Show when={followupsError() && queuedFollowups().length === 0}>
                                <div class="flower-queued-turns-empty">{followupsError()}</div>
                              </Show>
                              <Show when={followupsLoading() && queuedFollowups().length === 0 && !followupsError()}>
                                <div class="flower-queued-turns-empty">Loading queued follow-ups...</div>
                              </Show>
                              <For each={queuedFollowups()}>
                                {(item, index) => {
                                  const attachments = () => Array.isArray(item.attachments) ? item.attachments : [];
                                  const attachmentCount = () => attachments().length;
                                  const attachmentLabel = () => attachmentCount() === 1 ? '1 attachment' : `${attachmentCount()} attachments`;
                                  const createdAtLabel = () => formatQueuedTurnTime(item.created_at_unix_ms);
                                  const executionModeLabel = () => {
                                    const mode = String(item.execution_mode ?? '').trim().toLowerCase();
                                    return mode === 'plan' ? 'Plan' : mode === 'act' ? 'Act' : '';
                                  };
                                  const followupID = () => String(item.followup_id ?? '').trim();
                                  const messageText = () => String(item.text ?? '').trim() || 'Attachment-only follow-up';
                                  const deleting = () => followupDeletingID() === followupID();
                                  const reorderDisabled = () => !canInteract() || !!followupReorderingLane();
                                  return (
                                    <div
                                      class="flower-queued-turn-item"
                                      draggable={!reorderDisabled()}
                                      onDragStart={() => handleFollowupDragStart('queued', followupID())}
                                      onDragEnd={() => handleFollowupDragEnd()}
                                      onDragOver={(e) => {
                                        if (draggingFollowupLane() !== 'queued') return;
                                        e.preventDefault();
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        handleFollowupDrop('queued', followupID());
                                      }}
                                    >
                                      <div class="flower-queued-turn-item-main">
                                        <div class="flower-followup-leading">
                                          <button
                                            type="button"
                                            class="flower-followup-drag-handle"
                                            disabled={reorderDisabled()}
                                            onMouseDown={(e) => e.preventDefault()}
                                            title="Drag to reorder"
                                          >
                                            ⋮⋮
                                          </button>
                                          <div class="flower-queued-turn-position">{item.position}</div>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                          <div class="flower-queued-turn-item-meta">
                                            <Show when={createdAtLabel()}>
                                              <span class="flower-queued-turn-chip">{createdAtLabel()}</span>
                                            </Show>
                                            <Show when={executionModeLabel()}>
                                              <span class="flower-queued-turn-chip">{executionModeLabel()}</span>
                                            </Show>
                                            <Show when={String(item.model_id ?? '').trim()}>
                                              <span class="flower-queued-turn-chip truncate max-w-[14rem]" title={String(item.model_id ?? '').trim()}>
                                                {String(item.model_id ?? '').trim()}
                                              </span>
                                            </Show>
                                            <Show when={attachmentCount() > 0}>
                                              <span class="flower-queued-turn-chip">{attachmentLabel()}</span>
                                            </Show>
                                          </div>
                                          <p class="flower-queued-turn-text" title={messageText()}>{messageText()}</p>
                                        </div>
                                      </div>
                                      <div class="flower-queued-turn-actions">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Move up"
                                          onClick={() => moveFollowup('queued', index(), -1)}
                                          disabled={reorderDisabled() || index() === 0}
                                        >
                                          <ChevronUp class="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Move down"
                                          onClick={() => moveFollowup('queued', index(), 1)}
                                          disabled={reorderDisabled() || index() === queuedFollowups().length - 1}
                                        >
                                          <ChevronUp class="w-3.5 h-3.5 rotate-180" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Edit queued follow-up"
                                          onClick={() => openFollowupEditor(item)}
                                          disabled={!canInteract() || deleting()}
                                        >
                                          <Pencil class="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="Remove queued follow-up"
                                          onClick={() => void deleteFollowup(item)}
                                          disabled={!canInteract() || deleting()}
                                        >
                                          <Trash class="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </Show>

                    <AIChatInput
                      class="flower-chat-input"
                      disabled={!canInteract()}
                      waitingForUser={activeThreadWaitingUser()}
                      placeholder={chatInputPlaceholder()}
                      workingDirLabel={workingDirLabel() || 'Working dir'}
                      workingDirTitle={activeWorkingDir() || workingDirLabel() || 'Working dir'}
                      workingDirLocked={workingDirLocked()}
                      workingDirDisabled={workingDirDisabled()}
                      onPickWorkingDir={() => setWorkingDirPickerOpen(true)}
                      onSendIntent={(intent) => {
                        nextSendIntent = intent;
                      }}
                      getSendBlockReason={waitingUserComposerSendBlockReason}
                      onApiReady={setChatInputApi}
                    />
                  </div>
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
              onSelect={(selectedPath) => {
                if (workingDirLocked()) return;
                const realPath = toPickerTreeAbsolutePath(selectedPath, homePath());
                if (realPath) {
                  ai.setDraftWorkingDir(realPath);
                }
              }}
            />

            <Dialog
              open={followupEditOpen()}
              onOpenChange={(open) => {
                if (!open) {
                  setFollowupEditOpen(false);
                  setFollowupEditID('');
                  setFollowupEditLane('queued');
                  setFollowupEditText('');
                  return;
                }
                setFollowupEditOpen(true);
              }}
              title={followupEditLane() === 'draft' ? 'Edit Draft Follow-up' : 'Edit Queued Follow-up'}
              footer={
                <div class="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFollowupEditOpen(false)}
                    disabled={followupEditSaving()}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => void saveFollowupEdit()}
                    disabled={followupEditSaving() || !String(followupEditText() ?? '').trim()}
                  >
                    <Show when={followupEditSaving()}>
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
                  <label class="block text-xs font-medium mb-1.5">Message</label>
                  <textarea
                    value={followupEditText()}
                    onInput={(e) => setFollowupEditText(e.currentTarget.value)}
                    rows={6}
                    class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
                    placeholder={followupEditLane() === 'draft' ? 'Edit draft follow-up' : 'Edit queued follow-up'}
                  />
                  <p class="text-[11px] text-muted-foreground mt-1.5">
                    {followupEditLane() === 'draft'
                      ? 'This updates the saved draft before you load or queue it again.'
                      : 'This updates the queued message before Flower sends it.'}
                  </p>
                </div>
              </div>
            </Dialog>

            <ConfirmDialog
              open={draftLoadConfirmOpen()}
              onOpenChange={(open) => {
                setDraftLoadConfirmOpen(open);
                if (!open) {
                  setPendingDraftLoad(null);
                }
              }}
              title="Replace Draft?"
              confirmText="Load Draft"
              onConfirm={() => confirmLoadPendingDraft()}
            >
              <div class="space-y-2">
                <p class="text-sm">
                  Loading <span class="font-semibold">{String(pendingDraftLoad()?.followup.text ?? '').trim() || 'this draft'}</span> will replace the current composer content.
                </p>
                <p class="text-xs text-muted-foreground">
                  Your current unsent text and attachments will be discarded.
                </p>
              </div>
            </ConfirmDialog>

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
