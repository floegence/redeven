// Chat message input with attachment support, auto-resize textarea, and send button.

import { createSignal, onCleanup, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import { useAttachments } from '../hooks/useAttachments';
import { AttachmentPreview } from './AttachmentPreview';

export interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  class?: string;
}

export const ChatInput: Component<ChatInputProps> = (props) => {
  const ctx = useChatContext();
  const config = ctx.config;

  const allowAttachments = () => config().allowAttachments ?? true;
  const {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
  } = useAttachments({
    maxAttachments: config().maxAttachments ?? 10,
    maxSize: config().maxAttachmentSize ?? 10_485_760,
    acceptedTypes: config().acceptedFileTypes,
    onUpload: (file) => ctx.uploadAttachment(file),
  });

  const [text, setText] = createSignal('');
  const [isFocused, setIsFocused] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);

  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let dragCounter = 0;

  // Auto-resize the textarea based on content
  const autoResize = () => {
    const el = textareaRef;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };

  const canSend = () => text().trim().length > 0 || attachments().length > 0;

  const handleSend = async () => {
    if (!canSend() || props.disabled) return;

    const content = text().trim();
    const atts = [...attachments()];
    setText('');
    clearAttachments();

    // Reset textarea height after clearing
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    await ctx.sendMessage(content, atts);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore key events during IME composition
    if (e.isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement;
    setText(target.value);
    autoResize();
  };

  // Drag & drop handlers
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!allowAttachments()) return;
    dragCounter++;
    if (dragCounter === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    setIsDragging(false);

    if (!allowAttachments()) return;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      addFiles(Array.from(files));
    }
  };

  // Paste handler for clipboard images
  const handlePaste = (e: ClipboardEvent) => {
    if (!allowAttachments()) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      addFiles(files);
    }
  };

  // File picker
  const handleFileSelect = () => {
    fileInputRef?.click();
  };

  const handleFileInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      addFiles(Array.from(input.files));
      input.value = '';
    }
  };

  // Cleanup drag counter on unmount
  onCleanup(() => {
    dragCounter = 0;
  });

  return (
    <div
      class={cn(
        'chat-input-container',
        isFocused() && 'chat-input-container-focused',
        isDragging() && 'chat-input-container-dragging',
        props.class,
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      <Show when={isDragging()}>
        <div class="chat-input-drop-overlay">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Drop files here</span>
        </div>
      </Show>

      {/* Attachment previews */}
      <Show when={attachments().length > 0}>
        <div style={{ padding: '0.5rem 0.75rem 0' }}>
          <AttachmentPreview attachments={attachments()} onRemove={removeAttachment} />
        </div>
      </Show>

      {/* Textarea body */}
      <div class="chat-input-body">
        <textarea
          ref={textareaRef}
          class="chat-input-textarea"
          rows={2}
          placeholder={props.placeholder ?? config().placeholder ?? 'Type a message...'}
          disabled={props.disabled}
          value={text()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
        />
      </div>

      {/* Toolbar */}
      <div class="chat-input-toolbar">
        <div class="chat-input-toolbar-left">
          <Show when={allowAttachments()}>
            <button
              class="chat-input-attachment-btn"
              type="button"
              onClick={handleFileSelect}
              title="Attach files"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={config().acceptedFileTypes}
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </Show>
        </div>
        <div class="chat-input-toolbar-right">
          <span class="chat-input-hint">
            <kbd>Enter</kbd> send&nbsp;&nbsp;<kbd>Shift+Enter</kbd> newline
          </span>
          <button
            class={cn(
              'chat-input-send-btn',
              canSend() && !props.disabled && 'chat-input-send-btn-active',
            )}
            type="button"
            disabled={!canSend() || props.disabled}
            onClick={handleSend}
            title="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
