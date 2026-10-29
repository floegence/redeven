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
  const [content, setContent] = createSignal<{ descriptor: FilePreviewDescriptor; bytes: Uint8Array<ArrayBuffer>; text: string; url: string; rows?: string[][]; sheet?: string }>();
  const [failed, setFailed] = createSignal(false);
  createEffect(() => {
    const blob = props.blob, name = props.name, mime = props.mime;
    let active = true, url = '';
    setContent(undefined); setFailed(false);
    void (async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let descriptor = describeFilePreview(name);
      if (descriptor.mode === 'binary') {
        if (mime.startsWith('image/')) descriptor = { mode: 'image' };
        else if (mime === 'application/pdf') descriptor = { mode: 'pdf' };
        else if (mime === 'text/markdown') descriptor = { mode: 'markdown' };
        else if (mime === 'text/html') descriptor = { mode: 'html' };
        else if (mime.startsWith('text/') || isLikelyTextContent(bytes)) descriptor = { mode: 'text', textPresentation: 'plain', wrapText: true };
      }
      const text = isTextFilePreview(descriptor) ? new TextDecoder().decode(bytes) : '';
      let rows: string[][] | undefined, sheet: string | undefined;
      if (descriptor.mode === 'xlsx') {
        const { default: ExcelJS } = await import('exceljs');
        if (!active) return;
        const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes.buffer);
        const worksheet = book.worksheets[0];
        if (!worksheet) throw new Error('No worksheet');
        sheet = worksheet.name;
        rows = Array.from({ length: Math.min(worksheet.rowCount, 200) }, (_, row) =>
          Array.from({ length: Math.min(worksheet.columnCount, 50) }, (_, col) => worksheet.getCell(row + 1, col + 1).text));
      }
      if (!active) return;
      url = URL.createObjectURL(new Blob([bytes], { type: mime || mimeFromExtDot(getExtDot(name)) || 'application/octet-stream' }));
      setContent({ descriptor, bytes, text, url, rows, sheet });
    })().catch(() => { if (active) setFailed(true); });
    onCleanup(() => { active = false; if (url) URL.revokeObjectURL(url); });
  });
  const unavailable = () => <div class="flower-task-preview-state" role="alert">{i18n.t('flowerSurface.taskFiles.unsupported')}</div>;
  return <ErrorBoundary fallback={unavailable}>
    <Show when={!failed()} fallback={unavailable()}>
      <Show when={content()} fallback={<div class="flower-task-preview-state" role="status">{i18n.t('flowerSurface.taskFiles.loading')}</div>}>{value =>
        <Show when={value().descriptor.mode !== 'binary' && value().descriptor.mode !== 'unsupported'} fallback={unavailable()}>
          <Show when={value().descriptor.mode === 'markdown'} fallback={
            <FilePreviewContent surface="window" showHeader={false} item={{ id: props.name, name: props.name, path: props.path ?? props.name, type: 'file', size: props.blob.size }}
              descriptor={value().descriptor} text={value().text} bytes={value().bytes} objectUrl={value().url} resourceUrl={value().url}
              xlsxRows={value().rows} xlsxSheetName={value().sheet} onRenderError={() => setFailed(true)} onResourceError={() => setFailed(true)} />
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
