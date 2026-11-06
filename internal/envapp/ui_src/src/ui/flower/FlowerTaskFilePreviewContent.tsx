import { createEffect, createSignal, onCleanup, Show, ErrorBoundary } from 'solid-js';
import type { FlowerTaskFilePreviewContentProps } from '../../../../../flower_ui/src/FlowerTaskFilePreview';
import { FileMarkdown } from '../file-markdown/FileMarkdown';
import { useMarkdownPreviewPreferences } from '../services/markdownPreviewPreferences';
import { FilePreviewContent } from '../widgets/FilePreviewContent';
import { describeFilePreview, getExtDot, isLikelyTextContent, isTextFilePreview, mimeFromExtDot, type FilePreviewDescriptor } from '../utils/filePreview';
import { useI18n } from '../i18n';

/** Env App retains its rich report renderers inside the shared dialog-owned preview. */
export function FlowerTaskFilePreviewContent(props: FlowerTaskFilePreviewContentProps) {
  const i18n = useI18n();
  const markdown = useMarkdownPreviewPreferences();
  const [content, setContent] = createSignal<{ descriptor: FilePreviewDescriptor; bytes: Uint8Array<ArrayBuffer>; text: string; url: string }>();
  const [failed, setFailed] = createSignal(false);
  createEffect(() => {
    const blob = props.blob, name = props.name, mime = props.mime.toLowerCase().split(';', 1)[0].trim();
    let active = true, url = '';
    setContent(undefined); setFailed(false);
    void (async () => {
      let descriptor = describeFilePreview(name);
      if (descriptor.mode === 'binary' && (mime === 'text/html' || mime === 'application/xhtml+xml')) descriptor = { mode: 'html' };
      if (descriptor.mode === 'html' && blob.size > 2 * 1024 * 1024) throw new Error('HTML preview exceeds 2 MiB');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (descriptor.mode === 'binary') {
        if (mime.startsWith('image/')) descriptor = { mode: 'image' };
        else if (mime === 'application/pdf') descriptor = { mode: 'pdf' };
        else if (mime === 'text/markdown') descriptor = { mode: 'markdown' };
        else if (mime.startsWith('text/') || isLikelyTextContent(bytes)) descriptor = { mode: 'text', textPresentation: 'plain', wrapText: true };
      }
      const text = isTextFilePreview(descriptor) ? new TextDecoder().decode(bytes) : '';
      if (!active) return;
      url = URL.createObjectURL(new Blob([bytes], { type: mime || mimeFromExtDot(getExtDot(name)) || 'application/octet-stream' }));
      setContent({ descriptor, bytes, text, url });
    })().catch(() => { if (active) setFailed(true); });
    onCleanup(() => { active = false; if (url) URL.revokeObjectURL(url); });
  });
  const renderFailed = () => <div class="flower-task-preview-state" role="alert">{i18n.t('flowerSurface.taskFiles.previewFailed')}</div>;
  const unavailable = () => <div class="flower-task-preview-state" role="alert">{i18n.t('flowerSurface.taskFiles.unsupported')}</div>;
  return <ErrorBoundary fallback={renderFailed}>
    <Show when={!failed()} fallback={renderFailed()}>
      <Show when={content()} fallback={<div class="flower-task-preview-state" role="status">{i18n.t('flowerSurface.taskFiles.loading')}</div>}>{value =>
        <Show when={value().descriptor.mode !== 'binary' && value().descriptor.mode !== 'unsupported'} fallback={unavailable()}>
          <Show when={value().descriptor.mode === 'markdown'} fallback={
            <FilePreviewContent active={props.active} surface="window" showHeader={false} item={{ id: props.name, name: props.name, path: props.path ?? props.name, type: 'file', size: props.blob.size }}
              descriptor={value().descriptor} text={value().text} bytes={value().bytes} objectUrl={value().url} resourceUrl={value().url}
              onRenderError={() => setFailed(true)} onResourceError={() => setFailed(true)} />
          }>
            <div class="flower-task-preview-markdown" data-floe-scroll-viewport>
              <FileMarkdown content={value().text} filePath={props.path} showToc tocPresentation="drawer"
                textScalePercent={markdown.textScalePercent()} onTextScalePercentChange={markdown.setTextScalePercent} />
            </div>
          </Show>
        </Show>
      }</Show>
    </Show>
  </ErrorBoundary>;
}
