import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Send } from '@floegence/floe-webapp-core/icons';
import { Select } from '@floegence/floe-webapp-core/ui';

import { useRedevenRpc } from '../protocol/redeven_v1';
import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';
import {
  findComposerMentionToken,
  findComposerSlashCommandToken,
  replaceComposerTextRange,
} from './composerController';
import {
  filterCodexSlashCommands,
  type CodexSlashCommandSpec,
} from './composerCommands';
import {
  createCodexComposerFileIndex,
  type CodexFileSearchEntry,
} from './composerFileIndex';
import { createCodexComposerAutosizeController } from './createCodexComposerAutosizeController';
import { compactPathLabel } from './presentation';
import type {
  CodexComposerAttachmentDraft,
  CodexComposerMentionDraft,
} from './types';

type SelectOption = Readonly<{
  value: string;
  label: string;
}>;

type ComposerPopupKind = 'none' | 'file-mentions' | 'slash-commands';
type ComposerSelectVariant = 'value' | 'policy';
type ComposerSelectLabelMode = 'always' | 'auto';

function ComposerSelectChip(props: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder: string;
  disabled: boolean;
  variant: ComposerSelectVariant;
  labelMode?: ComposerSelectLabelMode;
  onChange: (value: string) => void;
  containerRef?: (element: HTMLDivElement) => void;
}) {
  const hasValue = () => String(props.value ?? '').trim().length > 0;
  const showLabel = () => (props.labelMode ?? 'auto') === 'always' || !hasValue();
  return (
    <div
      ref={props.containerRef}
      data-codex-command-focus={props.label.toLowerCase()}
      data-codex-select-variant={props.variant}
      data-codex-select-collapsed={showLabel() ? 'false' : 'true'}
      class={cn(
        'codex-chat-select-chip',
        props.variant === 'value'
          ? 'codex-chat-select-chip-value'
          : 'codex-chat-select-chip-policy',
        !showLabel() && 'codex-chat-select-chip-value-only',
        props.disabled && 'codex-chat-select-chip-disabled',
      )}
    >
      <Show when={showLabel()}>
        <span class="codex-chat-select-chip-label">{props.label}</span>
      </Show>
      <Select
        value={props.value}
        onChange={(value) => props.onChange(String(value ?? ''))}
        options={[...props.options]}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-label={props.label}
        class={cn(
          'codex-chat-select-chip-control',
          props.variant === 'value'
            ? 'codex-chat-select-chip-control-value'
            : 'codex-chat-select-chip-control-policy',
        )}
      />
    </div>
  );
}

function AttachmentCard(props: {
  attachment: CodexComposerAttachmentDraft;
  onRemove: (attachmentID: string) => void;
}) {
  return (
    <div class="codex-chat-attachment-card">
      <img
        class="codex-chat-attachment-thumb"
        src={props.attachment.preview_url}
        alt={props.attachment.name}
        loading="lazy"
        decoding="async"
      />
      <div class="codex-chat-attachment-copy">
        <div class="codex-chat-attachment-name" title={props.attachment.name}>
          {props.attachment.name}
        </div>
      </div>
      <button
        type="button"
        class="codex-chat-attachment-remove"
        onClick={() => props.onRemove(props.attachment.id)}
        aria-label={`Remove ${props.attachment.name}`}
        title={`Remove ${props.attachment.name}`}
      >
        ×
      </button>
    </div>
  );
}

function MentionChip(props: {
  mention: CodexComposerMentionDraft;
  onRemove: (mentionID: string) => void;
}) {
  return (
    <div class="codex-chat-mention-chip">
      <span class="codex-chat-mention-chip-kicker">@</span>
      <span class="codex-chat-mention-chip-copy" title={props.mention.path}>
        <span class="codex-chat-mention-chip-name">{props.mention.name}</span>
        <span class="codex-chat-mention-chip-path">{compactPathLabel(props.mention.path, props.mention.path)}</span>
      </span>
      <button
        type="button"
        class="codex-chat-mention-chip-remove"
        onClick={() => props.onRemove(props.mention.id)}
        aria-label={`Remove ${props.mention.name}`}
        title={`Remove ${props.mention.name}`}
      >
        ×
      </button>
    </div>
  );
}

function focusFirstInteractiveDescendant(container: HTMLElement | undefined) {
  if (!container) return;
  const target = container.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
  target?.focus();
}

export function CodexComposerShell(props: {
  workingDirPath: string;
  workingDirLabel: string;
  workingDirTitle: string;
  workingDirLocked: boolean;
  workingDirDisabled: boolean;
  modelValue: string;
  modelOptions: readonly SelectOption[];
  effortValue: string;
  effortOptions: readonly SelectOption[];
  approvalPolicyValue: string;
  approvalPolicyOptions: readonly SelectOption[];
  sandboxModeValue: string;
  sandboxModeOptions: readonly SelectOption[];
  attachments: readonly CodexComposerAttachmentDraft[];
  mentions: readonly CodexComposerMentionDraft[];
  supportsImages: boolean;
  capabilitiesLoading: boolean;
  composerText: string;
  submitting: boolean;
  hostAvailable: boolean;
  hostDisabledReason: string;
  onOpenWorkingDirPicker: () => void;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
  onApprovalPolicyChange: (value: string) => void;
  onSandboxModeChange: (value: string) => void;
  onAddAttachments: (files: readonly File[]) => Promise<void>;
  onRemoveAttachment: (attachmentID: string) => void;
  onAddFileMentions: (mentions: ReadonlyArray<{
    name: string;
    path: string;
    is_image: boolean;
  }>) => void;
  onRemoveMention: (mentionID: string) => void;
  onComposerInput: (value: string) => void;
  onResetComposer: () => void;
  onStartNewThreadDraft: () => void;
  onSend: () => void;
}) {
  const rpc = useRedevenRpc();
  const fileIndex = createCodexComposerFileIndex({
    listDirectory: async (path) => {
      const response = await rpc.fs.list({ path, showHidden: true });
      return response?.entries ?? [];
    },
  });
  const [isComposing, setIsComposing] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [selectionStart, setSelectionStart] = createSignal(0);
  const [selectionEnd, setSelectionEnd] = createSignal(0);
  const [activePopupIndex, setActivePopupIndex] = createSignal(0);
  const [dismissedPopupSignature, setDismissedPopupSignature] = createSignal('');
  const [fileIndexRevision, setFileIndexRevision] = createSignal(0);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let workingDirChipRef: HTMLButtonElement | undefined;
  let modelContainerRef: HTMLDivElement | undefined;
  let effortContainerRef: HTMLDivElement | undefined;
  let approvalContainerRef: HTMLDivElement | undefined;
  let sandboxContainerRef: HTMLDivElement | undefined;
  const autosizeController = createCodexComposerAutosizeController();

  const canSend = () =>
    props.hostAvailable &&
    (
      !!String(props.composerText ?? '').trim() ||
      props.attachments.length > 0 ||
      props.mentions.length > 0
    ) &&
    !props.submitting;

  const syncSelection = () => {
    setSelectionStart(textareaRef?.selectionStart ?? 0);
    setSelectionEnd(textareaRef?.selectionEnd ?? 0);
  };

  const restoreSelection = (selection: number) => {
    requestAnimationFrame(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      textareaRef.setSelectionRange(selection, selection);
      syncSelection();
    });
  };

  const requestAutosize = (text = textareaRef?.value ?? props.composerText) => {
    autosizeController.requestMeasure(text);
  };

  const mentionToken = createMemo(() => findComposerMentionToken({
    text: props.composerText,
    selectionStart: selectionStart(),
    selectionEnd: selectionEnd(),
  }));

  const slashCommandToken = createMemo(() => (
    mentionToken()
      ? null
      : findComposerSlashCommandToken({
          text: props.composerText,
          selectionStart: selectionStart(),
          selectionEnd: selectionEnd(),
        })
  ));

  const popupKind = createMemo<ComposerPopupKind>(() => {
    if (mentionToken()) return 'file-mentions';
    if (slashCommandToken()) return 'slash-commands';
    return 'none';
  });

  const popupSignature = createMemo(() => {
    if (popupKind() === 'file-mentions') {
      const token = mentionToken();
      return token ? `file:${props.workingDirPath}:${token.range.start}:${token.query}` : '';
    }
    if (popupKind() === 'slash-commands') {
      const token = slashCommandToken();
      return token ? `slash:${token.query}` : '';
    }
    return '';
  });

  const popupVisible = createMemo(() => {
    const signature = popupSignature();
    if (!signature) return false;
    return signature !== dismissedPopupSignature();
  });

  const slashCommands = createMemo<CodexSlashCommandSpec[]>(() => (
    popupKind() === 'slash-commands'
      ? filterCodexSlashCommands({
          query: slashCommandToken()?.query ?? '',
          context: {
            hostAvailable: props.hostAvailable,
            workingDirEditable: props.hostAvailable && !props.workingDirLocked && !props.workingDirDisabled,
          },
        })
      : []
  ));

  createEffect(() => {
    if (!popupVisible() || popupKind() !== 'file-mentions') return;
    const cwd = String(props.workingDirPath ?? '').trim();
    if (!cwd) return;
    void fileIndex.ensureIndexed(cwd);
  });

  createEffect(() => {
    const unsubscribe = fileIndex.subscribe(() => {
      setFileIndexRevision((value) => value + 1);
    });
    onCleanup(unsubscribe);
  });

  const fileMentionCandidates = createMemo<CodexFileSearchEntry[]>(() => {
    void fileIndexRevision();
    if (popupKind() !== 'file-mentions') return [];
    const cwd = String(props.workingDirPath ?? '').trim();
    if (!cwd) return [];
    return fileIndex.query(cwd, mentionToken()?.query ?? '');
  });

  const fileIndexLoading = createMemo(() => {
    void fileIndexRevision();
    if (popupKind() !== 'file-mentions') return false;
    const cwd = String(props.workingDirPath ?? '').trim();
    if (!cwd) return false;
    return fileIndex.getSnapshot(cwd)?.complete === false;
  });

  const popupItemCount = createMemo(() => (
    popupKind() === 'file-mentions'
      ? fileMentionCandidates().length
      : slashCommands().length
  ));

  createEffect(() => {
    const count = popupItemCount();
    setActivePopupIndex((current) => {
      if (count <= 0) return 0;
      return Math.min(current, count - 1);
    });
  });

  createEffect(() => {
    popupSignature();
    setActivePopupIndex(0);
  });

  createEffect(() => {
    void props.composerText;
    requestAutosize(props.composerText);
  });

  onCleanup(() => {
    autosizeController.dispose();
    fileIndex.dispose();
  });

  const sendLabel = () => 'Send to Codex';
  const canOpenWorkingDirPicker = () => props.hostAvailable && !props.workingDirDisabled && !props.workingDirLocked;
  const workingDirChipTitle = () => {
    const absolutePath = String(props.workingDirTitle ?? '').trim() || 'Working directory';
    if (!props.hostAvailable) {
      return statusNote() || absolutePath;
    }
    if (props.workingDirLocked) {
      return `${absolutePath} (locked to this thread)`;
    }
    return absolutePath;
  };
  const workingDirChipLabel = () => String(props.workingDirLabel ?? '').trim() || compactPathLabel(props.workingDirPath, 'Working dir');
  const attachmentSupportNote = () => {
    if (!props.hostAvailable) return '';
    if (props.capabilitiesLoading) return 'Checking image support...';
    if (
      isFocused() &&
      props.supportsImages &&
      !String(props.composerText ?? '').trim() &&
      props.attachments.length === 0 &&
      props.mentions.length === 0
    ) {
      return 'Type @ for file context, / for commands, or paste an image.';
    }
    return '';
  };
  const statusNote = () => {
    if (!props.hostAvailable) {
      return String(props.hostDisabledReason ?? '').trim() || 'Install `codex` on the host to enable Codex chat.';
    }
    if (props.attachments.length > 0 && !props.supportsImages) {
      return 'The selected model does not currently accept image input.';
    }
    return '';
  };

  const applyComposerText = (nextText: string, nextSelection?: number) => {
    props.onComposerInput(nextText);
    if (typeof nextSelection === 'number') {
      restoreSelection(nextSelection);
    }
  };

  const commitFileMention = (entry: CodexFileSearchEntry) => {
    const token = mentionToken();
    if (!token) return;
    props.onAddFileMentions([{
      name: entry.name,
      path: entry.path,
      is_image: entry.is_image,
    }]);
    const result = replaceComposerTextRange(props.composerText, token.range, '');
    setDismissedPopupSignature('');
    applyComposerText(result.text, result.selection);
  };

  const runSlashCommand = (command: CodexSlashCommandSpec) => {
    let nextText = props.composerText;
    let nextSelection = selectionStart();
    const token = slashCommandToken();
    if (token) {
      const result = replaceComposerTextRange(nextText, token.range, '');
      nextText = result.text;
      nextSelection = result.selection;
    }
    setDismissedPopupSignature('');

    switch (command.action) {
      case 'insert-mention-trigger': {
        const result = replaceComposerTextRange(nextText, { start: nextSelection, end: nextSelection }, '@');
        applyComposerText(result.text, result.selection);
        return;
      }
      case 'start-new-thread': {
        applyComposerText(nextText);
        props.onStartNewThreadDraft();
        return;
      }
      case 'clear-composer': {
        props.onResetComposer();
        restoreSelection(0);
        return;
      }
      case 'focus-working-dir': {
        applyComposerText(nextText, nextSelection);
        requestAnimationFrame(() => {
          if (canOpenWorkingDirPicker()) {
            props.onOpenWorkingDirPicker();
            return;
          }
          workingDirChipRef?.focus();
        });
        return;
      }
      case 'focus-model': {
        applyComposerText(nextText, nextSelection);
        requestAnimationFrame(() => focusFirstInteractiveDescendant(modelContainerRef));
        return;
      }
      case 'focus-effort': {
        applyComposerText(nextText, nextSelection);
        requestAnimationFrame(() => focusFirstInteractiveDescendant(effortContainerRef));
        return;
      }
      case 'focus-approval': {
        applyComposerText(nextText, nextSelection);
        requestAnimationFrame(() => focusFirstInteractiveDescendant(approvalContainerRef));
        return;
      }
      case 'focus-sandbox': {
        applyComposerText(nextText, nextSelection);
        requestAnimationFrame(() => focusFirstInteractiveDescendant(sandboxContainerRef));
        return;
      }
      default:
        return;
    }
  };

  const handlePopupKeydown = (event: KeyboardEvent): boolean => {
    if (!popupVisible()) return false;

    const itemCount = popupItemCount();
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissedPopupSignature(popupSignature());
      return true;
    }
    if (itemCount <= 0) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        return true;
      }
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActivePopupIndex((current) => (current + 1) % itemCount);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActivePopupIndex((current) => (current - 1 + itemCount) % itemCount);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      if (popupKind() === 'file-mentions') {
        const candidate = fileMentionCandidates()[activePopupIndex()];
        if (candidate) {
          commitFileMention(candidate);
        }
        return true;
      }
      const command = slashCommands()[activePopupIndex()];
      if (command) {
        runSlashCommand(command);
      }
      return true;
    }
    return false;
  };

  return (
    <div data-codex-surface="composer" class={cn(
      'chat-input-container codex-chat-input',
      isFocused() && 'chat-input-container-focused',
    )}>
      <div class="chat-input-body codex-chat-input-body">
        <div class="codex-chat-input-primary-row">
          <textarea
            ref={(element) => {
              textareaRef = element;
              autosizeController.setTextarea(element);
            }}
            value={props.composerText}
            disabled={!props.hostAvailable}
            onInput={(event) => {
              props.onComposerInput(event.currentTarget.value);
              setDismissedPopupSignature('');
              syncSelection();
              requestAutosize(event.currentTarget.value);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.items ?? [])
                .map((item) => item.kind === 'file' ? item.getAsFile() : null)
                .filter((file): file is File => file instanceof File && String(file.type ?? '').startsWith('image/'));
              if (files.length === 0 || !props.hostAvailable || !props.supportsImages) {
                return;
              }
              event.preventDefault();
              void props.onAddAttachments(files);
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionUpdate={() => requestAutosize()}
            onCompositionEnd={() => {
              setIsComposing(false);
              syncSelection();
              requestAutosize();
            }}
            onKeyDown={(event) => {
              if (!isComposing() && handlePopupKeydown(event)) return;
              if (!shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) return;
              event.preventDefault();
              props.onSend();
            }}
            onKeyUp={() => {
              setDismissedPopupSignature('');
              syncSelection();
            }}
            onSelect={() => {
              setDismissedPopupSignature('');
              syncSelection();
            }}
            onClick={() => {
              setDismissedPopupSignature('');
              syncSelection();
            }}
            onFocus={() => {
              setIsFocused(true);
              syncSelection();
            }}
            onBlur={() => setIsFocused(false)}
            rows={2}
            placeholder="Ask Codex to review a change, inspect a failure, summarize a diff, or plan the next step..."
            class="chat-input-textarea codex-chat-input-textarea"
          />

          <div class="codex-chat-input-send-slot">
            <button
              type="button"
              class={cn(
                'chat-input-send-btn codex-chat-input-send-btn',
                canSend() && 'chat-input-send-btn-active',
              )}
              onClick={props.onSend}
              disabled={!canSend()}
              aria-label={sendLabel()}
              title={props.submitting ? 'Sending...' : sendLabel()}
            >
              <Send class="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <Show when={popupVisible()}>
          <div
            class="codex-chat-popup"
            data-codex-popup-kind={popupKind()}
            role="listbox"
            aria-label={popupKind() === 'file-mentions' ? 'File reference suggestions' : 'Command suggestions'}
          >
            <Show when={popupKind() === 'file-mentions'} fallback={(
              <For each={slashCommands()}>
                {(command, index) => (
                  <button
                    type="button"
                    role="option"
                    class={cn(
                      'codex-chat-popup-item',
                      activePopupIndex() === index() && 'codex-chat-popup-item-active',
                    )}
                    aria-selected={activePopupIndex() === index()}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runSlashCommand(command)}
                  >
                    <span class="codex-chat-popup-item-title">{command.title}</span>
                    <span class="codex-chat-popup-item-detail">{command.description}</span>
                  </button>
                )}
              </For>
            )}>
              <Show
                when={fileMentionCandidates().length > 0}
                fallback={(
                  <div class="codex-chat-popup-empty">
                    {fileIndexLoading()
                      ? 'Indexing files in the current working directory...'
                      : 'No matching files found in the current working directory.'}
                  </div>
                )}
              >
                <For each={fileMentionCandidates()}>
                  {(entry, index) => (
                    <button
                      type="button"
                      role="option"
                      class={cn(
                        'codex-chat-popup-item',
                        activePopupIndex() === index() && 'codex-chat-popup-item-active',
                      )}
                      aria-selected={activePopupIndex() === index()}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commitFileMention(entry)}
                    >
                      <span class="codex-chat-popup-item-title">{entry.name}</span>
                      <span class="codex-chat-popup-item-detail">{compactPathLabel(entry.parent, entry.parent)}</span>
                    </button>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </Show>

        <div class="codex-chat-input-meta">
          <div class="codex-chat-input-meta-rail" role="toolbar" aria-label="Codex input controls">
            <div class="codex-chat-input-meta-group codex-chat-input-meta-group-context">
              <button
                type="button"
                class="codex-chat-meta-btn codex-chat-attachment-trigger"
                onClick={() => fileInputRef?.click()}
                disabled={!props.hostAvailable || !props.supportsImages}
                aria-label="Add attachments"
                title="Add attachments"
              >
                <PaperclipIcon />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                class="hidden"
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (!files || files.length === 0) return;
                  void props.onAddAttachments(Array.from(files));
                  event.currentTarget.value = '';
                }}
              />

              <button
                ref={workingDirChipRef}
                type="button"
                class={cn(
                  'codex-chat-chip codex-chat-working-dir-chip codex-chat-path-chip',
                  canOpenWorkingDirPicker()
                    ? 'codex-chat-chip-actionable'
                    : 'codex-chat-chip-disabled',
                  props.workingDirLocked && 'codex-chat-working-dir-chip-locked',
                )}
                onClick={() => {
                  if (!canOpenWorkingDirPicker()) return;
                  props.onOpenWorkingDirPicker();
                }}
                disabled={props.workingDirDisabled}
                title={workingDirChipTitle()}
                aria-label={props.workingDirLocked ? 'Working directory locked' : 'Select working directory'}
                aria-disabled={!canOpenWorkingDirPicker()}
                tabIndex={canOpenWorkingDirPicker() ? 0 : -1}
              >
                <FolderIcon />
                <span class="codex-chat-working-dir-chip-label">{workingDirChipLabel()}</span>
                <Show when={props.workingDirLocked}>
                  <LockIcon />
                </Show>
              </button>
            </div>

            <div class="codex-chat-input-meta-group codex-chat-input-meta-group-strategy">
              <ComposerSelectChip
                label="Model"
                value={props.modelValue}
                options={props.modelOptions}
                placeholder="Default"
                disabled={!props.hostAvailable || props.modelOptions.length === 0}
                variant="value"
                onChange={props.onModelChange}
                containerRef={(element) => {
                  modelContainerRef = element;
                }}
              />

              <ComposerSelectChip
                label="Effort"
                value={props.effortValue}
                options={props.effortOptions}
                placeholder="Default"
                disabled={!props.hostAvailable || props.effortOptions.length === 0}
                variant="value"
                onChange={props.onEffortChange}
                containerRef={(element) => {
                  effortContainerRef = element;
                }}
              />

              <ComposerSelectChip
                label="Approval"
                value={props.approvalPolicyValue}
                options={props.approvalPolicyOptions}
                placeholder="Default"
                disabled={!props.hostAvailable || props.approvalPolicyOptions.length === 0}
                variant="policy"
                onChange={props.onApprovalPolicyChange}
                containerRef={(element) => {
                  approvalContainerRef = element;
                }}
              />

              <ComposerSelectChip
                label="Sandbox"
                value={props.sandboxModeValue}
                options={props.sandboxModeOptions}
                placeholder="Default"
                disabled={!props.hostAvailable || props.sandboxModeOptions.length === 0}
                variant="policy"
                onChange={props.onSandboxModeChange}
                containerRef={(element) => {
                  sandboxContainerRef = element;
                }}
              />
            </div>
          </div>

          <Show when={attachmentSupportNote() || statusNote()}>
            <div class="codex-chat-input-support">
              <Show when={attachmentSupportNote()}>
                <div class="codex-chat-input-inline-note">{attachmentSupportNote()}</div>
              </Show>
              <Show when={statusNote()}>
                <div class={cn(
                  'codex-chat-input-status',
                  !props.hostAvailable && 'text-error',
                )}>
                  {statusNote()}
                </div>
              </Show>
            </div>
          </Show>

          <Show when={props.mentions.length > 0 || props.attachments.length > 0}>
            <div class="codex-chat-draft-objects">
              <Show when={props.mentions.length > 0}>
                <div class="codex-chat-mention-strip codex-chat-draft-strip">
                  <For each={props.mentions}>
                    {(mention) => (
                      <MentionChip mention={mention} onRemove={props.onRemoveMention} />
                    )}
                  </For>
                </div>
              </Show>

              <Show when={props.attachments.length > 0}>
                <div class="codex-chat-attachment-strip codex-chat-draft-strip">
                  <For each={props.attachments}>
                    {(attachment) => (
                      <AttachmentCard attachment={attachment} onRemove={props.onRemoveAttachment} />
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

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
