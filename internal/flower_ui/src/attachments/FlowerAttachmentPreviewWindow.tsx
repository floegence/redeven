import type { Component } from 'solid-js';
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { FileText } from '@floegence/floe-webapp-core/icons';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';

export type FlowerAttachmentPreviewSource = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  load: (signal: AbortSignal) => Promise<Blob>;
}>;

type FlowerAttachmentPreviewWindowProps = Readonly<{
  source: FlowerAttachmentPreviewSource | null;
  zIndex?: number;
  loadingLabel: string;
  unavailableLabel: string;
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
  const margin = viewport.width < 640 ? 8 : 12;
  const maxWidth = Math.max(280, viewport.width - margin * 2);
  const maxHeight = Math.max(280, viewport.height - margin * 2);
  return {
    defaultSize: { width: Math.min(860, maxWidth), height: Math.min(680, maxHeight) },
    minSize: { width: Math.min(340, maxWidth), height: Math.min(280, maxHeight) },
  };
}

function mimeEssence(value: string): string {
  return value.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function previewKind(mimeType: string): 'image' | 'pdf' | 'text' | 'unsupported' {
  const essence = mimeEssence(mimeType);
  if (essence.startsWith('image/')) return 'image';
  if (essence === 'application/pdf') return 'pdf';
  if (essence === 'text/plain' || essence === 'text/markdown') return 'text';
  return 'unsupported';
}

export const FlowerAttachmentPreviewWindow: Component<FlowerAttachmentPreviewWindowProps> = (props) => {
  const viewport = createMemo(currentViewportSize);
  const sizing = createMemo(() => resolveSizing(viewport()));
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [resolvedMimeType, setResolvedMimeType] = createSignal('');
  const [objectURL, setObjectURL] = createSignal('');
  const [text, setText] = createSignal('');
  let activeObjectURL = '';

  const clearContent = () => {
    if (activeObjectURL) URL.revokeObjectURL(activeObjectURL);
    activeObjectURL = '';
    setObjectURL('');
    setText('');
    setResolvedMimeType('');
    setError('');
  };

  createEffect(() => {
    const source = props.source;
    clearContent();
    if (!source) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void source.load(controller.signal).then(async (blob) => {
      if (controller.signal.aborted) return;
      const mimeType = mimeEssence(blob.type) || mimeEssence(source.mimeType);
      setResolvedMimeType(mimeType);
      if (previewKind(mimeType) === 'text') {
        const content = await blob.text();
        if (controller.signal.aborted) return;
        setText(content);
      } else if (previewKind(mimeType) === 'image' || previewKind(mimeType) === 'pdf') {
        activeObjectURL = URL.createObjectURL(blob);
        setObjectURL(activeObjectURL);
      }
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : props.unavailableLabel);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    onCleanup(() => controller.abort());
  });

  onCleanup(clearContent);

  const kind = createMemo(() => previewKind(resolvedMimeType() || props.source?.mimeType || ''));

  return (
    <Show when={props.source}>
      <FloatingWindow
        open
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title={props.source!.name}
        class={cn('flower-attachment-preview-window', 'shadow-[0_28px_72px_-42px_var(--redeven-shadow-color)]')}
        defaultSize={sizing().defaultSize}
        minSize={sizing().minSize}
        resizable
        draggable
        zIndex={props.zIndex ?? 164}
      >
        <div class="flower-attachment-preview-surface">
          <Show when={!loading()} fallback={<div class="flower-attachment-preview-state">{props.loadingLabel}</div>}>
            <Show when={!error()} fallback={<div class="flower-attachment-preview-state flower-attachment-preview-error">{error()}</div>}>
              <Switch fallback={(
                <div class="flower-attachment-preview-state">
                  <FileText aria-hidden="true" />
                  <span>{props.unavailableLabel}</span>
                </div>
              )}>
                <Match when={kind() === 'image' && objectURL()}>
                  <img class="flower-attachment-preview-image" src={objectURL()} alt={props.source!.name} />
                </Match>
                <Match when={kind() === 'pdf' && objectURL()}>
                  <object class="flower-attachment-preview-document" data={objectURL()} type="application/pdf">
                    <div class="flower-attachment-preview-state">{props.unavailableLabel}</div>
                  </object>
                </Match>
                <Match when={kind() === 'text'}>
                  <pre class="flower-attachment-preview-text">{text()}</pre>
                </Match>
              </Switch>
            </Show>
          </Show>
        </div>
      </FloatingWindow>
    </Show>
  );
};
