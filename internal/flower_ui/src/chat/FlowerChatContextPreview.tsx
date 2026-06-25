import type { Component } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { FlowerChatContextChip, FlowerChatContextAction } from '../contracts/flowerChatContextTypes';

type FlowerChatContextPreviewProps = Readonly<{
  chip: FlowerChatContextChip | null;
  open: boolean;
  zIndex?: number;
  onClose: () => void;
}>;

function currentViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveSizing(viewport: { width: number; height: number }) {
  const compact = viewport.width < 640;
  const margin = compact ? 8 : 12;
  const maxWidth = Math.max(280, viewport.width - margin * 2);
  const maxHeight = Math.max(280, viewport.height - margin * 2);
  const defaultWidth = Math.min(compact ? Math.min(520, maxWidth) : 520, maxWidth);
  const defaultHeight = Math.min(compact ? Math.min(420, maxHeight) : 420, maxHeight);
  const minWidth = Math.min(340, maxWidth);
  const minHeight = Math.min(280, maxHeight);
  return { compact, margin, defaultSize: { width: defaultWidth, height: defaultHeight }, minSize: { width: minWidth, height: minHeight } };
}

const TextPreviewPanel: Component<{ action: Extract<FlowerChatContextAction, { type: 'open_text_preview' }> }> = (props) => {
  return (
    <div class="flower-chat-context-preview-body">
      <div class="flower-chat-context-preview-title">{props.action.title}</div>
      <Show when={props.action.subtitle}>
        <div class="flower-chat-context-preview-subtitle">{props.action.subtitle}</div>
      </Show>
      <pre class="flower-chat-context-preview-content">{props.action.body}</pre>
    </div>
  );
};

const ProcessPreviewPanel: Component<{ action: Extract<FlowerChatContextAction, { type: 'open_process_preview' }> }> = (props) => {
  return (
    <div class="flower-chat-context-preview-body">
      <div class="flower-chat-context-preview-title">{props.action.title}</div>
      <Show when={props.action.subtitle}>
        <div class="flower-chat-context-preview-subtitle">{props.action.subtitle}</div>
      </Show>
      <pre class="flower-chat-context-preview-content">{props.action.body}</pre>
    </div>
  );
};

const FilePreviewPanel: Component<{ action: Extract<FlowerChatContextAction, { type: 'open_file_preview' }> }> = (props) => {
  return (
    <div class="flower-chat-context-preview-body">
      <div class="flower-chat-context-preview-title">File</div>
      <div class="flower-chat-context-preview-subtitle">{props.action.path}</div>
      <div class="flower-chat-context-preview-content" style="color: var(--muted-foreground);">
        Open this file in the editor to preview its contents.
      </div>
    </div>
  );
};

const DirectoryPreviewPanel: Component<{ action: Extract<FlowerChatContextAction, { type: 'open_directory_browser' }> }> = (props) => {
  return (
    <div class="flower-chat-context-preview-body">
      <div class="flower-chat-context-preview-title">Directory</div>
      <div class="flower-chat-context-preview-subtitle">{props.action.path}</div>
      <div class="flower-chat-context-preview-content" style="color: var(--muted-foreground);">
        Open this directory in the file browser to explore its contents.
      </div>
    </div>
  );
};

const PreviewPanel: Component<{ chip: FlowerChatContextChip }> = (props) => {
  const action = props.chip.action;
  if (!action) return null;

  switch (action.type) {
    case 'open_text_preview':
      return <TextPreviewPanel action={action} />;
    case 'open_process_preview':
      return <ProcessPreviewPanel action={action} />;
    case 'open_file_preview':
      return <FilePreviewPanel action={action} />;
    case 'open_directory_browser':
      return <DirectoryPreviewPanel action={action} />;
    default:
      return null;
  }
};

export const FlowerChatContextPreview: Component<FlowerChatContextPreviewProps> = (props) => {
  const viewport = createMemo(() => currentViewportSize());
  const sizing = createMemo(() => resolveSizing(viewport()));

  const chip = () => props.chip;

  return (
    <Show when={props.open && chip() != null}>
      <FloatingWindow
        open
        onOpenChange={(next) => {
          if (!next) props.onClose();
        }}
        title={chip()!.label}
        class={cn('flower-chat-context-preview-window', 'shadow-[0_28px_72px_-42px_rgba(15,23,42,0.38)]')}
        defaultSize={sizing().defaultSize}
        minSize={sizing().minSize}
        resizable
        draggable
        zIndex={props.zIndex ?? 162}
      >
        <div class="flower-chat-context-preview-surface">
          <PreviewPanel chip={chip()!} />
        </div>
      </FloatingWindow>
    </Show>
  );
};
