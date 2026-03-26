import { For, Show, createEffect, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Send } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Select } from '@floegence/floe-webapp-core/ui';

import { shouldSubmitOnEnterKeydown } from '../utils/shouldSubmitOnEnterKeydown';
import type { CodexComposerAttachmentDraft } from './types';

type SelectOption = Readonly<{
  value: string;
  label: string;
}>;

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
  const attachmentHint = () => {
    if (!props.hostAvailable) return 'Host unavailable';
    if (!props.supportsImages) return 'Model has no image input';
    return props.capabilitiesLoading ? 'Loading…' : 'Image only';
  };
  const statusNote = () => {
    if (!props.hostAvailable) {
      return 'Install `codex` on the host to enable Codex chat.';
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

        <div class="codex-chat-input-controls">
          <label class="codex-chat-input-field codex-chat-input-field--workspace">
            <span class="codex-chat-input-field-label">Working directory</span>
            <Input
              value={props.workspaceLabel}
              onInput={(event) => props.onWorkspaceInput(event.currentTarget.value)}
              placeholder="Use host default working directory"
              class="w-full codex-chat-input-field-control"
            />
          </label>

          <div class="codex-chat-input-field codex-chat-input-field--attachment">
            <span class="codex-chat-input-field-label">Attachment</span>
            <div class="codex-chat-input-attachment-row">
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="codex-chat-input-attachment-btn"
                onClick={() => fileInputRef?.click()}
                disabled={!props.hostAvailable || !props.supportsImages}
              >
                Attach image
              </Button>
              <span class="codex-chat-input-inline-note">{attachmentHint()}</span>
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
            </div>
          </div>

          <label class="codex-chat-input-field">
            <span class="codex-chat-input-field-label">Model</span>
            <Select
              value={props.modelValue}
              onChange={(value) => props.onModelChange(String(value ?? ''))}
              options={[...props.modelOptions]}
              placeholder="Use host default model"
              disabled={!props.hostAvailable || props.modelOptions.length === 0}
              class="w-full codex-chat-input-field-control"
            />
          </label>

          <label class="codex-chat-input-field">
            <span class="codex-chat-input-field-label">Effort</span>
            <Select
              value={props.effortValue}
              onChange={(value) => props.onEffortChange(String(value ?? ''))}
              options={[...props.effortOptions]}
              placeholder="Use model default effort"
              disabled={!props.hostAvailable || props.effortOptions.length === 0}
              class="w-full codex-chat-input-field-control"
            />
          </label>

          <label class="codex-chat-input-field">
            <span class="codex-chat-input-field-label">Approval</span>
            <Select
              value={props.approvalPolicyValue}
              onChange={(value) => props.onApprovalPolicyChange(String(value ?? ''))}
              options={[...props.approvalPolicyOptions]}
              placeholder="Use host default approval"
              disabled={!props.hostAvailable || props.approvalPolicyOptions.length === 0}
              class="w-full codex-chat-input-field-control"
            />
          </label>

          <label class="codex-chat-input-field">
            <span class="codex-chat-input-field-label">Sandbox</span>
            <Select
              value={props.sandboxModeValue}
              onChange={(value) => props.onSandboxModeChange(String(value ?? ''))}
              options={[...props.sandboxModeOptions]}
              placeholder="Use host default sandbox"
              disabled={!props.hostAvailable || props.sandboxModeOptions.length === 0}
              class="w-full codex-chat-input-field-control"
            />
          </label>
        </div>

        <Show when={statusNote()}>
          <div class={cn(
            'codex-chat-input-status',
            !props.hostAvailable && 'text-error',
          )}>
            {statusNote()}
          </div>
        </Show>
      </div>
    </div>
  );
}
