import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js';
import { SandboxedHtmlFrame } from '@floegence/floe-webapp-core/html-preview';
import { FlowerMarkdownBlock } from './chat/markdown/FlowerMarkdownBlock';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { ArrowLeft, Download, Refresh } from '@floegence/floe-webapp-core/icons';
import type { FlowerAttachmentPreviewSource } from './attachments/FlowerAttachmentPreviewWindow';
import type { TaskFilesCopy } from './taskFilesCopy';

export type FlowerTaskFilePreviewContentProps = { name: string; path?: string; mime: string; blob: Blob };
export type FlowerTaskFilePreviewSource = FlowerAttachmentPreviewSource & { path?: string; download?: () => void };

/** The child Dialog inherits the host layer and owns focus/Escape above the retained list. */
export function FlowerTaskFilePreview(props: {
  source: FlowerTaskFilePreviewSource; copy: TaskFilesCopy; onClose: () => void; downloading: boolean; actionError?: string;
  renderContent?: Component<FlowerTaskFilePreviewContentProps>;
}) {
  const [blob, setBlob] = createSignal<Blob>();
  const [text, setText] = createSignal('');
  const [url, setURL] = createSignal('');
  const [failed, setFailed] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  createEffect(() => {
    const source = props.source; void revision();
    const controller = new AbortController(); let objectURL = '';
    setBlob(undefined); setText(''); setURL(''); setFailed(false);
    void source.load(controller.signal).then(async value => {
      const content = !props.renderContent && (value.type || source.mimeType).startsWith('text/') ? await value.text() : '';
      if (controller.signal.aborted) return;
      objectURL = URL.createObjectURL(value); setURL(objectURL); setText(content); setBlob(value);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    onCleanup(() => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); });
  });
  const mime = () => (blob()?.type || props.source.mimeType).toLowerCase().split(';', 1)[0].trim();
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }} title={props.source.name}
    closeLabel={props.copy.close} class="flower-task-file-preview-dialog w-[min(64rem,96vw)] max-w-none"
    contentClass="flower-task-file-preview-content"
    footer={<><Show when={props.actionError}><p class="flower-task-files-notice text-destructive" role="alert">{props.actionError}</p></Show><div class="flower-task-file-preview-footer">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={props.onClose}>{props.copy.back}</Button>
      <Show when={props.source.download}><Button variant="ghost" size="sm" icon={Download} loading={props.downloading}
        onClick={() => props.source.download?.()}>{props.copy.download}</Button></Show>
    </div></>}>
    <Show when={!failed()} fallback={<div class="flower-task-preview-state" role="alert"><p>{props.copy.previewFailed}</p>
      <Button variant="ghost" size="sm" icon={Refresh} onClick={() => setRevision(value => value + 1)}>{props.copy.retry}</Button></div>}>
      <Show when={blob()} fallback={<div class="flower-task-preview-state" role="status">{props.copy.loading}</div>}>{value =>
        <Show when={props.renderContent} fallback={
          <Show when={mime().startsWith('image/')} fallback={
            <Show when={mime() === 'application/pdf'} fallback={
              <Show when={mime().startsWith('text/')} fallback={<div class="flower-task-preview-state">{props.copy.unsupported}</div>}>
                <Show when={mime().split(';')[0] === 'text/html'} fallback={
                  <Show when={mime().split(';')[0] === 'text/markdown'} fallback={<pre class="flower-attachment-preview-text">{text()}</pre>}>
                    <div class="flower-task-preview-markdown" data-floe-scroll-viewport><FlowerMarkdownBlock content={text()} copyCodeLabel={props.copy.copyCode} codeCopiedLabel={props.copy.copied} /></div>
                  </Show>
                }><SandboxedHtmlFrame class="flower-task-preview-html" html={text()} title={props.source.name}
                  labels={{ linkUnavailable: props.copy.unavailable, anchorUnavailable: props.copy.unavailable }} /></Show>
              </Show>
            }><object class="flower-attachment-preview-document" data={url()} type="application/pdf">{props.copy.unsupported}</object></Show>
          }><img class="flower-attachment-preview-image" src={url()} alt={props.source.name} /></Show>
        }>{Content => { const Renderer = Content(); return <Renderer name={props.source.name} path={props.source.path} mime={mime()} blob={value()} />; }}</Show>
      }</Show>
    </Show>
  </Dialog>;
}
