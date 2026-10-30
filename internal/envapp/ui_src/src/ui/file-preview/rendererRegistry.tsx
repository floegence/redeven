import { Show, Suspense, lazy, type JSX } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import type { FilePreviewDescriptor, FilePreviewSurface, PreviewMode } from '../utils/filePreview';
import { DocxPreviewPane } from '../widgets/DocxPreviewPane';
import { FilePreviewErrorState } from '../widgets/FilePreviewErrorState';
import { MarkdownPreviewPane } from '../widgets/MarkdownPreviewPane';
import { HtmlPreviewPane } from '../widgets/HtmlPreviewPane';
import type { BindPdfPreviewEditor } from '../widgets/pdfPreviewEditor';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
const PptxPreviewPane = lazy(() => import('../widgets/PptxPreviewPane').then(module => ({ default: module.PptxPreviewPane })));
const PdfPreviewPane = lazy(() => import('../widgets/PdfPreviewPane').then(module => ({ default: module.PdfPreviewPane })));
import { TextFilePreviewPane } from '../widgets/TextFilePreviewPane';
import { ImagePreviewPane } from '../widgets/ImagePreviewPane';
import { useI18n } from '../i18n';
import { DelimitedTextPreview, delimitedFormat } from '../../../../../flower_ui/src/preview/DelimitedTextPreview';
import { SpreadsheetPreview } from '../../../../../flower_ui/src/preview/SpreadsheetPreview';
import { taskFilesEnUS, type TaskFilesCopy } from '../../../../../flower_ui/src/taskFilesCopy';

export type RedevenFilePreviewRendererId =
  | 'text'
  | 'markdown'
  | 'html'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'video'
  | 'audio'
  | 'binary'
  | 'unsupported';

export type RedevenFilePreviewRenderProps = Readonly<{
  surface?: FilePreviewSurface;
  allowLocalWheel?: boolean;
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  text?: string;
  draftText?: string;
  editing?: boolean;
  saving?: boolean;
  bindPdfEditor?: BindPdfPreviewEditor;
  message?: string;
  objectUrl?: string;
  resourceUrl?: string;
  onRetry?: () => void;
  onOpenParent?: () => void | Promise<void>;
  onCopyPath?: () => boolean | Promise<boolean>;
  onRenderError?: (path: string, message?: string) => void;
  onResourceError?: (path:string,source:string) => void;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
}>;

export type RedevenFilePreviewRenderer = Readonly<{
  id: RedevenFilePreviewRendererId;
  modes: readonly PreviewMode[];
  render: (props: RedevenFilePreviewRenderProps) => JSX.Element;
}>;

function renderMarkdownPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  return (
    <MarkdownPreviewPane
      path={props.item?.path ?? 'preview.md'}
      descriptor={props.descriptor}
      text={props.text ?? ''}
      draftText={props.draftText ?? props.text ?? ''}
      editing={props.editing}
      onDraftChange={props.onDraftChange}
      onSelectionChange={props.onSelectionChange}
      surface={props.surface}
    />
  );
}

function renderTextPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  const i18n = useI18n();
  const format = () => delimitedFormat(props.item?.name ?? props.item?.path ?? '');
  const copy = () => Object.fromEntries(Object.keys(taskFilesEnUS).map(key => [key, i18n.t(('flowerSurface.taskFiles.' + key) as Parameters<typeof i18n.t>[0])])) as TaskFilesCopy;
  const source = () => <TextFilePreviewPane path={props.item?.path ?? 'preview.txt'} descriptor={props.descriptor}
    text={props.text ?? ''} draftText={props.draftText ?? props.text ?? ''} truncated={props.truncated}
    editing={props.editing} onDraftChange={props.onDraftChange} onSelectionChange={props.onSelectionChange} surface={props.surface} />;
  return <Show when={props.bytes && format()} fallback={source()}>{kind =>
    <DelimitedTextPreview bytes={props.bytes!} format={kind()} copy={copy()}
      source={source()} editing={props.editing} truncated={props.truncated} allowLocalWheel={props.allowLocalWheel} />
  }</Show>;
}

function renderImagePreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  return <ImagePreviewPane onRenderError={() => props.onRenderError?.(props.item?.path ?? '')} item={props.item} descriptor={props.descriptor} objectUrl={props.objectUrl} surface={props.surface} allowLocalWheel={props.allowLocalWheel} />;
}

function renderVideoPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  const i18n = useI18n();
  return (
    <div class={`flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden p-3${props.surface === 'window' ? ' redeven-file-preview-surface-window' : ' bg-black'}`}>
      <video
        src={props.resourceUrl}
        controls
        preload="metadata"
        onError={() => props.onResourceError?.(props.item?.path ?? '',props.resourceUrl ?? '')}
        class="h-full max-h-full w-full max-w-full cursor-pointer object-contain"
      >
        {props.item?.name ?? i18n.t('uiCopy.preview.videoFallback')}
      </video>
    </div>
  );
}

function renderAudioPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  const i18n = useI18n();
  return (
    <div class={`flex h-full min-h-0 min-w-0 overflow-auto p-3${props.surface === 'window' ? ' redeven-file-preview-surface-window' : ''}`}>
      <audio
        src={props.resourceUrl}
        controls
        preload="metadata"
        onError={() => props.onResourceError?.(props.item?.path ?? '',props.resourceUrl ?? '')}
        class="m-auto w-full max-w-2xl shrink-0 cursor-pointer"
      >
        {props.item?.name ?? i18n.t('uiCopy.preview.audioFallback')}
      </audio>
    </div>
  );
}

function renderSpreadsheetPreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  const i18n = useI18n();
  const copy = () => Object.fromEntries(Object.keys(taskFilesEnUS).map(key => [key, i18n.t(('flowerSurface.taskFiles.' + key) as Parameters<typeof i18n.t>[0])])) as TaskFilesCopy;
  return <div class="h-full min-h-0 overflow-hidden" classList={{ 'redeven-file-preview-surface-window': props.surface === 'window' }}><Show when={props.bytes} fallback={<div role="alert">{copy().previewFailed}</div>}>{bytes =>
    <SpreadsheetPreview bytes={bytes()} format="xlsx" copy={copy()} allowLocalWheel={props.allowLocalWheel} />
  }</Show></div>;
}

function renderUnavailablePreview(props: RedevenFilePreviewRenderProps): JSX.Element {
  return (
    <FilePreviewErrorState
      errorType="unsupported"
      message={props.message}
      path={props.item?.path}
      onRetry={props.onRetry}
      onOpenParent={props.item?.path && props.item.path !== '/' ? props.onOpenParent : undefined}
      onCopyPath={props.onCopyPath}
      busy={props.loading}
    />
  );
}

export const REDEVEN_FILE_PREVIEW_RENDERERS: readonly RedevenFilePreviewRenderer[] = [
  {
    id: 'text',
    modes: ['text'],
    render: renderTextPreview,
  },
  {
    id: 'markdown',
    modes: ['markdown'],
    render: renderMarkdownPreview,
  },
  {
    id: 'html',
    modes: ['html'],
    render: (props) => <HtmlPreviewPane {...props} path={props.item?.path ?? 'preview.html'} text={props.text ?? ''} />,
  },
  {
    id: 'image',
    modes: ['image'],
    render: renderImagePreview,
  },
  {
    id: 'pdf',
    modes: ['pdf'],
    render: (props) => {
      const i18n = useI18n();
      return <Suspense fallback={<RedevenLoadingCurtain visible eyebrow={i18n.t('uiCopy.preview.eyebrow')} message={i18n.t('uiCopy.preview.loadingPdf')} />}><PdfPreviewPane onRenderError={message => props.onRenderError?.(props.item?.path ?? '', message)} bytes={props.bytes} surface={props.surface} editing={props.editing} saving={props.saving} bindPdfEditor={props.bindPdfEditor} onSelectionChange={props.onSelectionChange} /></Suspense>;
    },
  },
  {
    id: 'docx',
    modes: ['docx'],
    render: (props) => <DocxPreviewPane onRenderError={message => props.onRenderError?.(props.item?.path ?? '', message)} bytes={props.bytes} surface={props.surface} />,
  },
  {
    id: 'pptx',
    modes: ['pptx'],
    render: (props) => {
      const i18n = useI18n();
      return <Suspense fallback={<RedevenLoadingCurtain visible eyebrow={i18n.t('uiCopy.preview.eyebrow')} message={i18n.t('uiCopy.preview.loadingPptx')} />}><PptxPreviewPane onRenderError={message => props.onRenderError?.(props.item?.path ?? '', message)} bytes={props.bytes} surface={props.surface} /></Suspense>;
    },
  },
  {
    id: 'xlsx',
    modes: ['xlsx'],
    render: renderSpreadsheetPreview,
  },
  {
    id: 'video',
    modes: ['video'],
    render: renderVideoPreview,
  },
  {
    id: 'audio',
    modes: ['audio'],
    render: renderAudioPreview,
  },
  {
    id: 'binary',
    modes: ['binary'],
    render: renderUnavailablePreview,
  },
  {
    id: 'unsupported',
    modes: ['unsupported'],
    render: renderUnavailablePreview,
  },
] as const;

export function resolveRedevenFilePreviewRenderer(descriptor: FilePreviewDescriptor): RedevenFilePreviewRenderer {
  return REDEVEN_FILE_PREVIEW_RENDERERS.find((renderer) => renderer.modes.includes(descriptor.mode))
    ?? REDEVEN_FILE_PREVIEW_RENDERERS[REDEVEN_FILE_PREVIEW_RENDERERS.length - 1];
}

export function renderRedevenFilePreviewBody(props: RedevenFilePreviewRenderProps): JSX.Element {
  return resolveRedevenFilePreviewRenderer(props.descriptor).render(props);
}
