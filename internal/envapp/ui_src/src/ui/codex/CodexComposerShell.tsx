import { For, Show, createEffect, createSignal, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Send } from '@floegence/floe-webapp-core/icons';
import { Input, Select } from '@floegence/floe-webapp-core/ui';

import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';
import { compactPathLabel } from './presentation';
import type { CodexComposerAttachmentDraft } from './types';

type SelectOption = Readonly<{
  value: string;
  label: string;
}>;

function ComposerSelectChip(props: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div class={cn(
      'codex-chat-select-chip',
      props.disabled && 'codex-chat-select-chip-disabled',
    )}>
      <span class="codex-chat-select-chip-label">{props.label}</span>
      <Select
        value={props.value}
        onChange={(value) => props.onChange(String(value ?? ''))}
        options={[...props.options]}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-label={props.label}
        class="codex-chat-select-chip-control"
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

export function CodexComposerShell(props: {
  workspaceLabel: string;
  modelValue: string;
  modelOptions: readonly SelectOption[];
  effortValue: string;
  effortOptions: readonly SelectOption[];
  approvalPolicyValue: string;
  approvalPolicyOptions: readonly SelectOption[];
  sandboxModeValue: string;
  sandboxModeOptions: readonly SelectOption[];
  attachments: readonly CodexComposerAttachmentDraft[];
  supportsImages: boolean;
  capabilitiesLoading: boolean;
  composerText: string;
  submitting: boolean;
  hostAvailable: boolean;
  hostDisabledReason: string;
  onWorkspaceInput: (value: string) => void;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
  onApprovalPolicyChange: (value: string) => void;
  onSandboxModeChange: (value: string) => void;
  onAddAttachments: (files: readonly File[]) => Promise<void>;
  onRemoveAttachment: (attachmentID: string) => void;
  onComposerInput: (value: string) => void;
  onSend: () => void;
}) {
  const [isComposing, setIsComposing] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [showWorkspaceEditor, setShowWorkspaceEditor] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let rafId: number | null = null;

  const canSend = () =>
    props.hostAvailable &&
    (!!String(props.composerText ?? '').trim() || props.attachments.length > 0) &&
    !props.submitting;

  const scheduleAdjustHeight = () => {
    if (!textareaRef) return;
    if (rafId !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 320)}px`;
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!textareaRef) return;
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 320)}px`;
    });
  };

  createEffect(() => {
    void props.composerText;
    scheduleAdjustHeight();
  });

  const sendLabel = () => 'Send to Codex';
  const workspaceTitle = () => String(props.workspaceLabel ?? '').trim() || 'Working directory';
  const workspaceChipLabel = () => compactPathLabel(props.workspaceLabel, 'Working dir');
  const attachmentSupportNote = () => {
    if (!props.hostAvailable) return '';
    if (props.capabilitiesLoading) return 'Checking image support…';
    if (!props.supportsImages) return 'Image attachments unavailable for the current model.';
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

  return (
    <div data-codex-surface="composer" class={cn(
      'chat-input-container codex-chat-input',
      isFocused() && 'chat-input-container-focused',
    )}>
      <Show when={props.attachments.length > 0}>
        <div class="codex-chat-attachment-strip">
          <For each={props.attachments}>
            {(attachment) => (
              <AttachmentCard attachment={attachment} onRemove={props.onRemoveAttachment} />
            )}
          </For>
        </div>
      </Show>

      <div class="chat-input-body codex-chat-input-body">
        <div class="codex-chat-input-primary-row">
          <textarea
            ref={textareaRef}
            value={props.composerText}
            disabled={!props.hostAvailable}
            onInput={(event) => {
              props.onComposerInput(event.currentTarget.value);
              scheduleAdjustHeight();
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionUpdate={scheduleAdjustHeight}
            onCompositionEnd={() => {
              setIsComposing(false);
              scheduleAdjustHeight();
            }}
            onKeyDown={(event) => {
              if (!shouldSubmitOnEnterKeydown({ event, isComposing: isComposing() })) return;
              event.preventDefault();
              props.onSend();
            }}
            onFocus={() => setIsFocused(true)}
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
              title={props.submitting ? 'Sending…' : sendLabel()}
            >
              <Send class="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <div class="codex-chat-input-meta">
          <div class="codex-chat-input-meta-rail" role="toolbar" aria-label="Codex input controls">
            <button
              type="button"
              class={cn(
                'codex-chat-chip codex-chat-working-dir-chip codex-chat-chip-actionable',
              )}
              disabled={!props.hostAvailable}
              onClick={() => setShowWorkspaceEditor((value) => !value)}
              title={props.hostAvailable ? workspaceTitle() : statusNote() || workspaceTitle()}
              aria-label="Edit working directory"
              aria-expanded={showWorkspaceEditor()}
            >
              <FolderIcon />
              <span class="codex-chat-working-dir-chip-label">{workspaceChipLabel()}</span>
            </button>

            <button
              type="button"
              class="codex-chat-meta-btn"
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

            <ComposerSelectChip
              label="Model"
              value={props.modelValue}
              options={props.modelOptions}
              placeholder="Default"
              disabled={!props.hostAvailable || props.modelOptions.length === 0}
              onChange={props.onModelChange}
            />

            <ComposerSelectChip
              label="Effort"
              value={props.effortValue}
              options={props.effortOptions}
              placeholder="Default"
              disabled={!props.hostAvailable || props.effortOptions.length === 0}
              onChange={props.onEffortChange}
            />

            <ComposerSelectChip
              label="Approval"
              value={props.approvalPolicyValue}
              options={props.approvalPolicyOptions}
              placeholder="Default"
              disabled={!props.hostAvailable || props.approvalPolicyOptions.length === 0}
              onChange={props.onApprovalPolicyChange}
            />

            <ComposerSelectChip
              label="Sandbox"
              value={props.sandboxModeValue}
              options={props.sandboxModeOptions}
              placeholder="Default"
              disabled={!props.hostAvailable || props.sandboxModeOptions.length === 0}
              onChange={props.onSandboxModeChange}
            />
          </div>

          <Show when={showWorkspaceEditor()}>
            <div class="codex-chat-input-workspace-editor">
              <Input
                value={props.workspaceLabel}
                disabled={!props.hostAvailable}
                onInput={(event) => props.onWorkspaceInput(event.currentTarget.value)}
                placeholder="Use host default working directory"
                aria-label="Working directory"
                class="w-full codex-chat-input-workspace-input"
              />
            </div>
          </Show>

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
