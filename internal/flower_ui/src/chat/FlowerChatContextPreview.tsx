import type { Component } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button, FloatingWindow } from '@floegence/floe-webapp-core/ui';

export type FlowerContextSnapshotPreviewProps = Readonly<{
  title: string;
  subtitle: string;
  body: string;
  sourcePath?: string;
  truncated?: boolean;
  truncatedLabel: string;
  zIndex?: number;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  statusMessage?: string;
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

/** Default snapshot host for consumers without a product preview window. */
export const FlowerChatContextPreview: Component<FlowerContextSnapshotPreviewProps> = (props) => {
  let previewBody: HTMLDivElement | undefined;
  const viewport = createMemo(() => currentViewportSize());
  const sizing = createMemo(() => resolveSizing(viewport()));
  return (
    <FloatingWindow
      open
      onOpenChange={next => { if (!next) props.onClose(); }}
      title={props.title}
      class={cn('flower-chat-context-preview-window', 'shadow-[0_28px_72px_-42px_var(--redeven-shadow-color)]')}
      defaultSize={sizing().defaultSize}
      minSize={sizing().minSize}
      resizable
      draggable
      zIndex={props.zIndex ?? 162}
    >
      <div class="flower-chat-context-preview-surface">
        <div ref={previewBody} tabIndex={-1} class="flower-chat-context-preview-body">
          <div class="flower-chat-context-preview-title">{props.title}</div>
          <Show when={props.subtitle}><div class="flower-chat-context-preview-subtitle">{props.subtitle}</div></Show>
          <Show when={props.actionLabel && props.onAction}>
            <Button size="sm" class="mb-3 cursor-pointer" disabled={props.actionDisabled} onClick={() => {
              previewBody?.focus({ preventScroll: true });
              props.onAction?.();
            }}>{props.actionLabel}</Button>
          </Show>
          <Show when={props.statusMessage}><p role="status" class="mb-3 text-xs text-muted-foreground">{props.statusMessage}</p></Show>
          <pre class="flower-chat-context-preview-content">{props.body}</pre>
          <Show when={props.truncated}><span class="flower-chat-context-preview-truncated" role="note">{props.truncatedLabel}</span></Show>
        </div>
      </div>
    </FloatingWindow>
  );
};
