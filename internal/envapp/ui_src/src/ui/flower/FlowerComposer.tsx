import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';

import {
  AttachmentPreview,
  useAttachments,
  useChatContext,
  type Attachment,
} from '../chat';
import {
  findComposerSlashCommandToken,
  replaceComposerTextRange,
  type ComposerTextRange,
} from '../composer/triggerTokens';
import {
  filterFlowerSlashCommands,
  type FlowerComposerExecutionMode,
  type FlowerSlashCommandSpec,
} from './flowerComposerCommands';
import {
  navigateFlowerComposerHistoryDown,
  navigateFlowerComposerHistoryUp,
  pushFlowerComposerHistoryEntry,
  readFlowerComposerHistory,
  type FlowerComposerHistoryEntry,
  type FlowerComposerHistorySession,
} from './flowerComposerHistory';
import { mergeAskFlowerDraft } from '../utils/askFlowerContextTemplate';
import { readLiveTextValue, syncLiveTextValue } from '../utils/liveTextValue';
import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';

export type FlowerComposerSendIntent = 'default' | 'queue_after_waiting_user';
export type FlowerComposerAttachmentDraftSnapshot = {
  text: string;
  attachments: Attachment[];
};

type FlowerComposerReadonlyDraftSnapshot = Readonly<{
  text: string;
  attachments: readonly Attachment[];
}>;

export type FlowerComposerApi = {
  applyDraftText: (nextText: string, mode: 'append' | 'replace') => void;
  addAttachmentFiles: (files: File[]) => void;
  replaceDraft: (nextDraft: FlowerComposerAttachmentDraftSnapshot) => void;
  snapshotDraft: () => FlowerComposerAttachmentDraftSnapshot;
  clearDraft: () => void;
  focusInput: () => void;
};

function cloneAttachments(attachments: readonly Attachment[]): Attachment[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

function removeLeadingSlashCommandToken(text: string, range: ComposerTextRange): {
  text: string;
  selection: number;
} | null {
  const result = replaceComposerTextRange(text, range, '');
  const trimmedText = result.text.replace(/^[ \t]+/, '');
  const selectionOffset = result.text.length - trimmedText.length;
  return {
    text: trimmedText,
    selection: Math.max(0, result.selection - selectionOffset),
  };
}

function isCollapsedSelection(start: number, end: number): boolean {
  return start === end;
}

function isCaretOnFirstLine(text: string, selectionStart: number): boolean {
  return text.slice(0, Math.max(0, selectionStart)).indexOf('\n') === -1;
}

export const FlowerComposer: Component<{
  class?: string;
  placeholder?: string;
  disabled?: boolean;
  waitingForUser?: boolean;
  workingDirLabel?: string;
  workingDirTitle?: string;
  workingDirLocked?: boolean;
  workingDirDisabled?: boolean;
  historyScopeKey: string;
  executionMode?: FlowerComposerExecutionMode;
  onExecutionModeChange?: (mode: FlowerComposerExecutionMode) => void;
  onPickWorkingDir?: () => void;
  onSendIntent?: (intent: FlowerComposerSendIntent) => void;
  getSendBlockReason?: (content: string, attachments: Attachment[]) => string | null;
  onApiReady?: (api: FlowerComposerApi | null) => void;
}> = (props) => {
  const ctx = useChatContext();
  const notify = useNotification();
  const [text, setText] = createSignal('');
  const [isFocused, setIsFocused] = createSignal(false);
  const [isComposing, setIsComposing] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [selectionStart, setSelectionStart] = createSignal(0);
  const [selectionEnd, setSelectionEnd] = createSignal(0);
  const [historyEntries, setHistoryEntries] = createSignal<FlowerComposerHistoryEntry[]>([]);
  const [historySession, setHistorySession] = createSignal<FlowerComposerHistorySession<Attachment> | null>(null);
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = createSignal(0);
  const [dismissedSlashPopupSignature, setDismissedSlashPopupSignature] = createSignal('');

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
  const historyScopeKey = () => String(props.historyScopeKey ?? '').trim() || 'global';
  const syncTextFromTextarea = () => syncLiveTextValue(textareaRef, setText, text());
  const hasDraftPayload = () => currentText().trim().length > 0 || attachments.attachments().length > 0;
  const sendBlockReason = () => {
    if (!hasDraftPayload()) return '';
    return String(props.getSendBlockReason?.(currentText(), attachments.attachments()) ?? '').trim();
  };

  const canSend = () =>
    hasDraftPayload()
    && !props.disabled
    && !sending()
    && !attachments.hasUploading()
    && !sendBlockReason();

  const canPickWorkingDir = () =>
    !!props.onPickWorkingDir
    && !props.disabled
    && !props.workingDirDisabled
    && !props.workingDirLocked;

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

  const syncSelection = () => {
    setSelectionStart(textareaRef?.selectionStart ?? currentText().length);
    setSelectionEnd(textareaRef?.selectionEnd ?? currentText().length);
  };

  const focusComposer = () => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        textareaRef?.focus();
        syncSelection();
      });
      return;
    }
    textareaRef?.focus();
    syncSelection();
  };

  const resetHistoryNavigation = () => {
    setHistorySession(null);
  };

  const snapshotDraft = (): FlowerComposerAttachmentDraftSnapshot => ({
    text: currentText(),
    attachments: cloneAttachments(attachments.attachments()),
  });

  const commitTextValue = (
    nextText: string,
    options?: {
      selection?: number;
      focus?: boolean;
      resetHistory?: boolean;
      clearPopupDismissal?: boolean;
    },
  ) => {
    setIsComposing(false);
    setText(nextText);
    if (options?.resetHistory ?? true) {
      resetHistoryNavigation();
    }
    if (options?.clearPopupDismissal ?? true) {
      setDismissedSlashPopupSignature('');
    }
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    const selection = Math.max(0, Math.min(nextText.length, Math.floor(options?.selection ?? nextText.length)));
    const focus = options?.focus ?? true;

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        scheduleAdjustHeight();
        const el = textareaRef;
        if (!el) return;
        if (focus) {
          el.focus();
        }
        try {
          el.setSelectionRange(selection, selection);
        } catch {
          // ignore cursor placement failures on older browsers
        }
        syncSelection();
      });
      return;
    }

    scheduleAdjustHeight();
    if (focus) {
      focusComposer();
    }
  };

  const applyDraftSnapshot = (
    nextDraft: FlowerComposerReadonlyDraftSnapshot,
    options?: {
      focus?: boolean;
      selection?: number;
      resetHistory?: boolean;
      clearPopupDismissal?: boolean;
    },
  ) => {
    attachments.replaceAttachments(cloneAttachments(Array.isArray(nextDraft?.attachments) ? nextDraft.attachments : []));
    commitTextValue(String(nextDraft?.text ?? ''), options);
  };

  const clearDraft = () => {
    attachments.clearAttachments();
    commitTextValue('', {
      focus: false,
    });
  };

  const replaceDraft = (nextDraft: FlowerComposerAttachmentDraftSnapshot) => {
    applyDraftSnapshot(nextDraft);
  };

  const setHistoryDraft = (
    nextDraft: FlowerComposerReadonlyDraftSnapshot,
    nextSession: FlowerComposerHistorySession<Attachment> | null,
  ) => {
    setHistorySession(nextSession);
    applyDraftSnapshot(nextDraft, {
      resetHistory: false,
    });
  };

  const applySlashCommand = (command: FlowerSlashCommandSpec) => {
    if (props.disabled) return;

    setDismissedSlashPopupSignature('');
    setActiveSlashCommandIndex(0);

    if (command.action === 'clear-composer') {
      clearDraft();
      focusComposer();
      return;
    }

    const token = slashCommandToken();
    const result = token ? removeLeadingSlashCommandToken(currentText(), token.range) : null;
    const nextText = result?.text ?? currentText();
    const nextSelection = result?.selection ?? nextText.length;

    if (command.action === 'set-execution-mode' && command.nextExecutionMode) {
      if (command.nextExecutionMode !== props.executionMode) {
        props.onExecutionModeChange?.(command.nextExecutionMode);
      }
      commitTextValue(nextText, { selection: nextSelection });
      return;
    }

    if (command.action === 'open-working-dir-picker') {
      commitTextValue(nextText, {
        selection: nextSelection,
        focus: false,
      });
      if (canPickWorkingDir()) {
        props.onPickWorkingDir?.();
      }
    }
  };

  const slashCommandToken = createMemo(() => findComposerSlashCommandToken({
    text: currentText(),
    selectionStart: selectionStart(),
    selectionEnd: selectionEnd(),
  }));

  const slashCommandContext = createMemo(() => ({
    workingDirEditable: canPickWorkingDir(),
    supportsExecutionModeSwitching: !!props.onExecutionModeChange,
  }));

  const slashCommands = createMemo(() => {
    const token = slashCommandToken();
    if (!token || props.disabled) return [];
    return filterFlowerSlashCommands({
      query: token.query,
      context: slashCommandContext(),
    });
  });

  const slashPopupSignature = createMemo(() => {
    const token = slashCommandToken();
    if (!token) return '';
    return [
      token.query,
      slashCommandContext().workingDirEditable ? 'dir' : 'no-dir',
      slashCommandContext().supportsExecutionModeSwitching ? 'mode' : 'no-mode',
    ].join(':');
  });

  const slashPopupVisible = createMemo(() => {
    const token = slashCommandToken();
    if (!token || props.disabled) return false;
    return dismissedSlashPopupSignature() !== slashPopupSignature();
  });

  const restoreDraftAfterHistorySession = () => {
    const session = historySession();
    if (!session) return false;
    setHistoryDraft(session.savedDraft, null);
    return true;
  };

  const handlePopupKeyDown = (event: KeyboardEvent): boolean => {
    if (!slashPopupVisible()) return false;

    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissedSlashPopupSignature(slashPopupSignature());
      return true;
    }

    const commands = slashCommands();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (commands.length > 0) {
        setActiveSlashCommandIndex((index) => (index + 1) % commands.length);
      }
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (commands.length > 0) {
        setActiveSlashCommandIndex((index) => (index - 1 + commands.length) % commands.length);
      }
      return true;
    }

    if (event.key === 'Enter') {
      const command = commands[Math.max(0, Math.min(activeSlashCommandIndex(), commands.length - 1))];
      if (!command) return false;
      event.preventDefault();
      applySlashCommand(command);
      return true;
    }

    return false;
  };

  const handleHistoryKeyDown = (event: KeyboardEvent): boolean => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return false;
    }

    if (event.key === 'Escape') {
      if (!historySession()) return false;
      event.preventDefault();
      return restoreDraftAfterHistorySession();
    }

    if (event.key === 'ArrowDown') {
      const session = historySession();
      if (!session) return false;
      event.preventDefault();
      const result = navigateFlowerComposerHistoryDown({
        entries: historyEntries(),
        session,
      });
      if (!result) return true;
      setHistoryDraft(result.draft, result.session);
      return true;
    }

    if (event.key !== 'ArrowUp') return false;

    const textValue = currentText();
    const start = selectionStart();
    const end = selectionEnd();
    if (!isCollapsedSelection(start, end) || !isCaretOnFirstLine(textValue, start)) {
      return false;
    }

    const result = navigateFlowerComposerHistoryUp({
      entries: historyEntries(),
      session: historySession(),
      currentDraft: snapshotDraft(),
    });
    if (!result) return false;

    event.preventDefault();
    setHistoryDraft(result.draft, result.session);
    return true;
  };

  const handleSend = async (intent: FlowerComposerSendIntent = 'default') => {
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
      const restoreDraft: FlowerComposerAttachmentDraftSnapshot = {
        text: content,
        attachments: cloneAttachments(upload.attachments),
      };
      props.onSendIntent?.(intent);
      clearDraft();
      try {
        await ctx.sendMessage(content, files);
        setHistoryEntries(pushFlowerComposerHistoryEntry({
          scopeKey: historyScopeKey(),
          text: content,
        }));
      } catch {
        replaceDraft(restoreDraft);
      }
    } finally {
      setSending(false);
    }
  };

  const handlePaste = async (event: ClipboardEvent) => {
    if (!ctx.config().allowAttachments) return;
    await attachments.handlePaste(event);
    resetHistoryNavigation();
  };

  const applyDraftText = (nextText: string, mode: 'append' | 'replace') => {
    const normalized = String(nextText ?? '').trim();
    if (!normalized) return;

    const merged = mergeAskFlowerDraft({
      currentText: currentText(),
      nextText: normalized,
      mode,
    });
    commitTextValue(merged);
  };

  const addAttachmentFiles = (files: File[]) => {
    if (!ctx.config().allowAttachments) return;
    if (!Array.isArray(files) || files.length <= 0) return;
    attachments.addFiles(files);
    resetHistoryNavigation();
  };

  const removeAttachment = (attachmentID: string) => {
    attachments.removeAttachment(attachmentID);
    resetHistoryNavigation();
  };

  const focusInput = () => {
    focusComposer();
  };

  createEffect(() => {
    const scopeKey = historyScopeKey();
    setHistoryEntries(readFlowerComposerHistory(scopeKey));
    resetHistoryNavigation();
  });

  createEffect(() => {
    const signature = slashPopupSignature();
    const dismissed = dismissedSlashPopupSignature();
    if (!signature) {
      setDismissedSlashPopupSignature('');
      setActiveSlashCommandIndex(0);
      return;
    }
    if (dismissed && dismissed !== signature) {
      setDismissedSlashPopupSignature('');
    }
    setActiveSlashCommandIndex((index) => {
      const commands = slashCommands();
      if (commands.length <= 0) return 0;
      return Math.min(index, commands.length - 1);
    });
  });

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
      onDrop={(event) => {
        attachments.handleDrop(event);
        resetHistoryNavigation();
      }}
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
          onRemove={removeAttachment}
        />
      </Show>

      <div class="chat-input-body flower-chat-input-body">
        <div class="flower-chat-input-primary-row">
          <textarea
            ref={textareaRef}
            class="chat-input-textarea flower-chat-input-textarea"
            value={text()}
            onInput={(event) => {
              setText(event.currentTarget.value);
              resetHistoryNavigation();
              setDismissedSlashPopupSignature('');
              syncSelection();
              scheduleAdjustHeight();
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionUpdate={() => {
              syncTextFromTextarea();
              syncSelection();
              scheduleAdjustHeight();
            }}
            onCompositionEnd={() => {
              setIsComposing(false);
              syncTextFromTextarea();
              syncSelection();
              scheduleAdjustHeight();
            }}
            onKeyDown={(event) => {
              if (!isComposing() && handlePopupKeyDown(event)) return;
              if (!isComposing() && handleHistoryKeyDown(event)) return;
              if (!shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) return;
              event.preventDefault();
              void handleSend();
            }}
            onKeyUp={() => {
              syncSelection();
            }}
            onSelect={() => {
              syncSelection();
            }}
            onClick={() => {
              syncSelection();
            }}
            onPaste={handlePaste}
            onFocus={() => {
              setIsFocused(true);
              syncSelection();
            }}
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

        <Show when={slashPopupVisible()}>
          <div class="flower-chat-popup-overlay">
            <div
              class="flower-chat-popup"
              role="listbox"
              aria-label="Flower slash commands"
              data-testid="flower-composer-slash-popup"
            >
              <Show
                when={slashCommands().length > 0}
                fallback={<div class="flower-chat-popup-empty">No matching Flower commands.</div>}
              >
                <For each={slashCommands()}>
                  {(command, index) => (
                    <button
                      type="button"
                      role="option"
                      class={cn(
                        'flower-chat-popup-item',
                        activeSlashCommandIndex() === index() && 'flower-chat-popup-item-active',
                      )}
                      aria-selected={activeSlashCommandIndex() === index()}
                      data-testid={`flower-composer-command-${command.id}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySlashCommand(command)}
                    >
                      <span class="flower-chat-popup-item-title">{command.title}</span>
                      <span class="flower-chat-popup-item-detail">{command.description}</span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>

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
                onClick={() => {
                  attachments.openFilePicker();
                  resetHistoryNavigation();
                }}
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

const UploadIcon: Component = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
