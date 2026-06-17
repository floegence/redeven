import { Show, createSignal, onCleanup } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button } from '@floegence/floe-webapp-core/ui';
import {
  FlowerTurnLauncherWindow as SharedFlowerTurnLauncherWindow,
  type FlowerTurnLauncherSubmitInput,
} from '../../../../../flower_ui/src/FlowerTurnLauncherWindow';
import type { FlowerTurnLauncherIntent } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type {
  FlowerTurnLauncherContextAction,
  FlowerTurnLauncherContextChip,
  FlowerTurnLauncherWindowCopyInput,
} from '../../../../../flower_ui/src/flowerTurnLauncherCopy';
import {
  describeFilePreview,
  FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
  getExtDot,
  isLikelyTextContent,
  mimeFromExtDot,
  type FilePreviewDescriptor,
} from '../utils/filePreview';
import { basenameFromPath, fileItemFromPath } from '../utils/filePreviewItem';
import { useI18n } from '../i18n';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewContent } from './FilePreviewContent';
import { PreviewWindow } from './PreviewWindow';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

const INLINE_TEXT_PREVIEW_MAX_CHARS = 120_000;
const CONTEXT_PREVIEW_DEFAULT_SIZE = { width: 880, height: 640 };
const CONTEXT_PREVIEW_MIN_SIZE = { width: 380, height: 280 };
const FLOWER_TURN_LAUNCHER_Z_INDEX = ENV_APP_FLOATING_LAYER.flowerTurnLauncher;
const FLOWER_TURN_CONTEXT_BROWSER_Z_INDEX = ENV_APP_FLOATING_LAYER.flowerTurnContextBrowser;
const FLOWER_TURN_CONTEXT_PREVIEW_Z_INDEX = ENV_APP_FLOATING_LAYER.flowerTurnContextPreview;

function createFlowerTurnLauncherCopy(i18n: ReturnType<typeof useI18n>): FlowerTurnLauncherWindowCopyInput {
  return {
    window_title: i18n.t('flowerTurnLauncher.windowTitle'),
    working_dir_label: i18n.t('flowerTurnLauncher.workingDirLabel'),
    working_directory_unavailable: i18n.t('flowerTurnLauncher.workingDirectoryUnavailable'),
    sending: i18n.t('flowerTurnLauncher.sending'),
    linked_context_label: i18n.t('flowerTurnLauncher.linkedContextLabel'),
    you_label: i18n.t('flowerTurnLauncher.youLabel'),
    reply_to_flower_label: i18n.t('flowerTurnLauncher.replyToFlowerLabel'),
    send_turn: i18n.t('flowerTurnLauncher.launchTurn'),
    empty_message: i18n.t('flowerTurnLauncher.validation.emptyMessage'),
    ready: i18n.t('common.status.ready'),
    close: i18n.t('common.actions.close'),
    launch_failed_title: i18n.t('shell.notifications.failedToSendToFlowerTitle'),
    context: {
      environment_fallback: i18n.t('flowerTurnLauncher.context.environmentFallback'),
      context_fallback: i18n.t('flowerTurnLauncher.contextFallback'),
      terminal_fallback: i18n.t('flowerTurnLauncher.terminalFallback'),
      selected_content: i18n.t('flowerTurnLauncher.context.selectedContent'),
      selected_content_title: i18n.t('flowerTurnLauncher.context.selectedContentTitle'),
      selected_output: i18n.t('flowerTurnLauncher.context.selectedOutput'),
      selected_terminal_output_title: i18n.t('flowerTurnLauncher.context.selectedTerminalOutputTitle'),
      process_snapshot: i18n.t('flowerTurnLauncher.context.processSnapshot'),
      snapshot_fallback: i18n.t('flowerTurnLauncher.context.snapshotFallback'),
      snapshot_detail_fallback: i18n.t('flowerTurnLauncher.context.snapshotDetailFallback'),
      queued_attachment: i18n.t('flowerTurnLauncher.context.queuedAttachment'),
      browse_folder_target: i18n.t('flowerTurnLauncher.context.browseFolderTarget'),
      open_live_file_preview_for_target: i18n.t('flowerTurnLauncher.context.openLiveFilePreviewForTarget'),
      preview_selected_content_from_target: i18n.t('flowerTurnLauncher.context.previewSelectedContentFromTarget'),
      preview_monitoring_snapshot_for_pid: i18n.t('flowerTurnLauncher.context.previewMonitoringSnapshotForPid'),
      preview_target: i18n.t('flowerTurnLauncher.context.previewTarget'),
      preview_selected_terminal_output: i18n.t('flowerTurnLauncher.context.previewSelectedTerminalOutput'),
      attachment_snapshot_title: i18n.t('flowerTurnLauncher.context.attachmentSnapshotTitle'),
      preview_attachment_target: i18n.t('flowerTurnLauncher.context.previewAttachmentTarget'),
      preview_attached_snapshot_for_target: i18n.t('flowerTurnLauncher.context.previewAttachedSnapshotForTarget'),
    },
    prompt: {
      environment_placeholder: i18n.t('flowerTurnLauncher.prompt.environmentPlaceholder'),
      environment_question: i18n.t('flowerTurnLauncher.prompt.environmentQuestion'),
      selection_placeholder: i18n.t('flowerTurnLauncher.prompt.selectionPlaceholder'),
      selection_question: i18n.t('flowerTurnLauncher.prompt.selectionQuestion'),
      terminal_output_placeholder: i18n.t('flowerTurnLauncher.prompt.terminalOutputPlaceholder'),
      terminal_context_placeholder: i18n.t('flowerTurnLauncher.prompt.terminalContextPlaceholder'),
      terminal_question: i18n.t('flowerTurnLauncher.prompt.terminalQuestion'),
      process_placeholder: i18n.t('flowerTurnLauncher.prompt.processPlaceholder'),
      inspect_explain_question: i18n.t('flowerTurnLauncher.prompt.inspectExplainQuestion'),
      git_placeholder: i18n.t('flowerTurnLauncher.prompt.gitPlaceholder'),
      git_question: i18n.t('flowerTurnLauncher.prompt.gitQuestion'),
      context_placeholder: i18n.t('flowerTurnLauncher.prompt.contextPlaceholder'),
      file_placeholder: i18n.t('flowerTurnLauncher.prompt.filePlaceholder'),
      focus_question: i18n.t('flowerTurnLauncher.prompt.focusQuestion'),
      folder_placeholder: i18n.t('flowerTurnLauncher.prompt.folderPlaceholder'),
      folder_question: i18n.t('flowerTurnLauncher.prompt.folderQuestion'),
      file_question: i18n.t('flowerTurnLauncher.prompt.fileQuestion'),
      files_and_folders_placeholder: i18n.t('flowerTurnLauncher.prompt.filesAndFoldersPlaceholder'),
      files_placeholder: i18n.t('flowerTurnLauncher.prompt.filesPlaceholder'),
      files_question: i18n.t('flowerTurnLauncher.prompt.filesQuestion'),
      help_question: i18n.t('flowerTurnLauncher.prompt.helpQuestion'),
      attachment_placeholder: i18n.t('flowerTurnLauncher.prompt.attachmentPlaceholder'),
      attachment_question: i18n.t('flowerTurnLauncher.prompt.attachmentQuestion'),
      default_placeholder: i18n.t('flowerTurnLauncher.prompt.defaultPlaceholder'),
      default_question: i18n.t('flowerTurnLauncher.prompt.defaultQuestion'),
    },
  };
}

type FlowerTurnLauncherWindowProps = Readonly<{
  open: boolean;
  intent: FlowerTurnLauncherIntent | null;
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
  onSubmit: (input: FlowerTurnLauncherSubmitInput) => Promise<void>;
}>;

type ContextPreviewState = Readonly<{
  title: string;
  subtitle: string;
  item: FileItem;
  descriptor: FilePreviewDescriptor;
  text?: string;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
}>;

type ContextBrowserState = Readonly<{
  path: string;
  title: string;
  subtitle: string;
}>;

function trimPreviewBody(content: string): { body: string; truncated: boolean } {
  if (content.length <= INLINE_TEXT_PREVIEW_MAX_CHARS) {
    return { body: content, truncated: false };
  }
  return {
    body: content.slice(0, INLINE_TEXT_PREVIEW_MAX_CHARS),
    truncated: true,
  };
}

function fileItemForContextPreview(path: string, name: string | undefined, fallbackTitle: string): FileItem {
  const normalizedPath = String(path ?? '').trim() || name || fallbackTitle;
  return fileItemFromPath(normalizedPath, String(name ?? '').trim() || basenameFromPath(normalizedPath));
}

function revokeContextPreviewResources(preview: ContextPreviewState | null) {
  const objectUrl = String(preview?.objectUrl ?? '').trim();
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  }

  if (typeof FileReader !== 'undefined') {
    return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result) as Uint8Array<ArrayBuffer>);
          return;
        }
        reject(new Error('Failed to read file.'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  return new Uint8Array(await new Response(blob).arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

async function resolveSpreadsheetPreview(bytes: Uint8Array<ArrayBuffer>): Promise<{ sheetName: string; rows: string[][] } | null> {
  const module = await import('exceljs');
  const ExcelJS: any = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer);
  const worksheet = workbook.worksheets?.[0] ?? workbook.getWorksheet?.(1);
  if (!worksheet) return null;

  const cellToText = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const maybeCell = value as any;
      if (typeof maybeCell.text === 'string') return maybeCell.text;
      if (Array.isArray(maybeCell.richText)) {
        return maybeCell.richText.map((part: any) => String(part?.text ?? '')).join('');
      }
      if (maybeCell.result != null) return cellToText(maybeCell.result);
      try {
        return JSON.stringify(maybeCell);
      } catch {
        return String(maybeCell);
      }
    }
    return String(value);
  };

  const rows: string[][] = [];
  const takeRows = Math.min(typeof worksheet.rowCount === 'number' ? worksheet.rowCount : 200, 200);
  for (let rowIndex = 1; rowIndex <= takeRows; rowIndex += 1) {
    const row = worksheet.getRow?.(rowIndex);
    if (!row) continue;
    const nextRow: string[] = [];
    for (let colIndex = 1; colIndex <= 50; colIndex += 1) {
      nextRow.push(cellToText(row.getCell?.(colIndex)?.value));
    }
    rows.push(nextRow);
  }

  return {
    sheetName: String(worksheet.name ?? 'Sheet1'),
    rows,
  };
}

function contextPreviewStateForText(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  text: string;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
}): ContextPreviewState {
  return {
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    descriptor: FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
    text: params.text,
    helper: params.helper,
    actionLabel: params.actionLabel,
    onAction: params.onAction,
  };
}

function contextPreviewStateForMessage(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  descriptor?: FilePreviewDescriptor;
  message: string;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
  error?: string | null;
}): ContextPreviewState {
  return {
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    descriptor: params.descriptor ?? { mode: 'unsupported' },
    message: params.message,
    helper: params.helper,
    actionLabel: params.actionLabel,
    onAction: params.onAction,
    error: params.error ?? null,
  };
}

function contextPreviewStateLoading(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  helper?: string;
}): ContextPreviewState {
  return {
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    descriptor: FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
    loading: true,
    helper: params.helper,
  };
}

function friendlyAttachmentPreviewError(error: unknown, copy: ReturnType<typeof useI18n>): string {
  const message = error instanceof Error ? String(error.message ?? '').trim() : String(error ?? '').trim();
  if (message.toLowerCase().includes('maximum call stack size exceeded')) {
    return copy.t('flowerTurnLauncher.preview.attachmentRendererFailed');
  }
  if (!message) {
    return copy.t('flowerTurnLauncher.preview.attachmentPreviewFailedShort');
  }
  return copy.t('flowerTurnLauncher.preview.attachmentPreviewFailed');
}

async function buildFileLikeContextPreview(params: {
  title: string;
  subtitle: string;
  item: FileItem;
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  truncated?: boolean;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
  blob?: Blob;
  copy: ReturnType<typeof useI18n>;
}): Promise<ContextPreviewState> {
  const descriptor = describeFilePreview(params.name);
  const helperParts = params.helper ? [params.helper] : [];
  const truncated = !!params.truncated;

  if (descriptor.mode === 'text') {
    const preview = trimPreviewBody(new TextDecoder('utf-8', { fatal: false }).decode(params.bytes));
    if (truncated) helperParts.push(params.copy.t('flowerTurnLauncher.preview.showingPartialContent'));
    if (preview.truncated) helperParts.push(params.copy.t('flowerTurnLauncher.preview.showingFirstContentPart'));
    return contextPreviewStateForText({
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      text: preview.body,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    });
  }

  if (descriptor.mode === 'image') {
    if (truncated) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: params.copy.t('flowerTurnLauncher.preview.imageTooLarge'),
        helper: helperParts.join(' ') || undefined,
      });
    }
    const mime = mimeFromExtDot(getExtDot(params.name)) ?? 'application/octet-stream';
    return {
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      descriptor,
      objectUrl: URL.createObjectURL(params.blob ?? new Blob([params.bytes], { type: mime })),
      bytes: params.bytes,
      truncated,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    };
  }

  if (descriptor.mode === 'pdf' || descriptor.mode === 'docx') {
    if (truncated) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: descriptor.mode === 'pdf'
          ? params.copy.t('flowerTurnLauncher.preview.pdfTooLarge')
          : params.copy.t('flowerTurnLauncher.preview.documentTooLarge'),
        helper: helperParts.join(' ') || undefined,
      });
    }
    return {
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      descriptor,
      bytes: params.bytes,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    };
  }

  if (descriptor.mode === 'xlsx') {
    if (truncated) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: params.copy.t('flowerTurnLauncher.preview.spreadsheetTooLarge'),
        helper: helperParts.join(' ') || undefined,
      });
    }
    const spreadsheetPreview = await resolveSpreadsheetPreview(params.bytes);
    if (!spreadsheetPreview) {
      return contextPreviewStateForMessage({
        title: params.title,
        subtitle: params.subtitle,
        item: params.item,
        message: params.copy.t('flowerTurnLauncher.preview.noWorksheetFound'),
        helper: helperParts.join(' ') || undefined,
      });
    }
    return {
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      descriptor,
      bytes: params.bytes,
      xlsxSheetName: spreadsheetPreview.sheetName,
      xlsxRows: spreadsheetPreview.rows,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    };
  }

  if (isLikelyTextContent(params.bytes)) {
    const preview = trimPreviewBody(new TextDecoder('utf-8', { fatal: false }).decode(params.bytes));
    if (truncated) helperParts.push(params.copy.t('flowerTurnLauncher.preview.showingPartialContent'));
    if (preview.truncated) helperParts.push(params.copy.t('flowerTurnLauncher.preview.showingFirstContentPart'));
    return contextPreviewStateForText({
      title: params.title,
      subtitle: params.subtitle,
      item: params.item,
      text: preview.body,
      helper: helperParts.join(' ') || undefined,
      actionLabel: params.actionLabel,
      onAction: params.onAction,
    });
  }

  return contextPreviewStateForMessage({
    title: params.title,
    subtitle: params.subtitle,
    item: params.item,
    message: params.copy.t('flowerTurnLauncher.preview.unavailableFileType'),
    helper: helperParts.join(' ') || undefined,
    actionLabel: params.actionLabel,
    onAction: params.onAction,
  });
}

export function FlowerTurnLauncherWindow(props: FlowerTurnLauncherWindowProps) {
  const filePreview = useFilePreviewContext();
  const i18n = useI18n();
  const [contextPreview, setContextPreview] = createSignal<ContextPreviewState | null>(null);
  const [contextBrowser, setContextBrowser] = createSignal<ContextBrowserState | null>(null);
  let previewRequestSeq = 0;

  const updateContextPreview = (next: ContextPreviewState | null) => {
    setContextPreview((current) => {
      if (current?.objectUrl && current.objectUrl !== next?.objectUrl) {
        revokeContextPreviewResources(current);
      }
      return next;
    });
  };

  const closeContextPreview = () => {
    previewRequestSeq += 1;
    updateContextPreview(null);
  };

  const closeContextBrowser = () => {
    setContextBrowser(null);
  };

  onCleanup(() => {
    closeContextPreview();
    closeContextBrowser();
  });

  const openFullFilePreview = async (path: string) => {
    closeContextPreview();
    closeContextBrowser();
    await filePreview.openPreview(fileItemFromPath(path));
  };

  const openAttachmentPreview = async (
    action: Extract<FlowerTurnLauncherContextAction, { type: 'open_attachment_snapshot_preview' }>,
  ) => {
    const seq = ++previewRequestSeq;
    const livePath = String(action.live_path ?? '').trim();
    const queuedAttachmentLabel = i18n.t('flowerTurnLauncher.context.queuedAttachment');
    const item = fileItemForContextPreview(
      livePath || (action.subtitle === queuedAttachmentLabel ? action.file.name : action.subtitle),
      action.file.name,
      i18n.t('flowerTurnLauncher.contextPreviewTitle'),
    );
    const descriptor = describeFilePreview(action.file.name || item.name);
    const helper = livePath
      ? i18n.t('flowerTurnLauncher.preview.showingAttachedSnapshot')
      : i18n.t('flowerTurnLauncher.preview.queuedWithMessage');
    const actionLabel = livePath ? i18n.t('flowerTurnLauncher.preview.openLiveFilePreviewAction') : undefined;
    const onAction = livePath ? () => void openFullFilePreview(livePath) : undefined;

    if (descriptor.mode !== 'text' && descriptor.mode !== 'markdown' && descriptor.mode !== 'binary') {
      const message = descriptor.mode === 'image'
        ? i18n.t('flowerTurnLauncher.preview.imageSnapshotNotice')
        : descriptor.mode === 'pdf'
          ? i18n.t('flowerTurnLauncher.preview.pdfSnapshotNotice')
          : descriptor.mode === 'docx'
            ? i18n.t('flowerTurnLauncher.preview.documentSnapshotNotice')
            : descriptor.mode === 'xlsx'
              ? i18n.t('flowerTurnLauncher.preview.spreadsheetSnapshotNotice')
              : i18n.t('flowerTurnLauncher.preview.genericSnapshotNotice');
      updateContextPreview(contextPreviewStateForMessage({
        title: action.title,
        subtitle: action.subtitle,
        item,
        message,
        helper,
        actionLabel,
        onAction,
      }));
      return;
    }

    updateContextPreview(contextPreviewStateLoading({
      title: action.title,
      subtitle: action.subtitle,
      item,
      helper: i18n.t('flowerTurnLauncher.preview.loadingPreview'),
    }));

    try {
      const bytes = await readBlobBytes(action.file);
      if (seq !== previewRequestSeq) return;
      const nextPreview = await buildFileLikeContextPreview({
        title: action.title,
        subtitle: action.subtitle,
        item,
        name: action.file.name || item.name,
        bytes,
        copy: i18n,
        helper,
        actionLabel,
        onAction,
        blob: action.file,
      });
      if (seq !== previewRequestSeq) {
        revokeContextPreviewResources(nextPreview);
        return;
      }
      updateContextPreview(nextPreview);
    } catch (error) {
      if (seq !== previewRequestSeq) return;
      const message = friendlyAttachmentPreviewError(error, i18n);
      updateContextPreview(contextPreviewStateForMessage({
        title: action.title,
        subtitle: action.subtitle,
        item,
        message,
        helper: actionLabel ? i18n.t('flowerTurnLauncher.preview.openLiveFilePreviewHelper') : undefined,
        error: message,
        actionLabel,
        onAction,
      }));
    }
  };

  const executeContextAction = async (action: FlowerTurnLauncherContextAction, _entry: FlowerTurnLauncherContextChip): Promise<void> => {
    if (action.type === 'open_live_file_preview') {
      await openFullFilePreview(action.path);
      return;
    }
    if (action.type === 'open_directory_browser') {
      setContextBrowser({
        path: action.path,
        title: basenameFromPath(action.path),
        subtitle: action.path,
      });
      return;
    }
    if (action.type === 'open_text_context_preview') {
      const preview = trimPreviewBody(action.body);
      updateContextPreview(contextPreviewStateForText({
        title: action.title,
        subtitle: action.subtitle,
        item: fileItemForContextPreview(action.source_path || action.subtitle, action.title, i18n.t('flowerTurnLauncher.contextPreviewTitle')),
        text: preview.body,
        helper: preview.truncated ? i18n.t('flowerTurnLauncher.preview.showingFirstContextPart') : undefined,
      }));
      return;
    }
    if (action.type === 'open_process_snapshot_preview') {
      const preview = trimPreviewBody(action.body);
      updateContextPreview(contextPreviewStateForText({
        title: action.title,
        subtitle: action.subtitle,
        item: fileItemForContextPreview(`process://${action.pid}`, action.title, i18n.t('flowerTurnLauncher.contextPreviewTitle')),
        text: preview.body,
        helper: preview.truncated ? i18n.t('flowerTurnLauncher.preview.showingFirstProcessSnapshotPart') : undefined,
      }));
      return;
    }
    await openAttachmentPreview(action);
  };

  return (
    <>
      <SharedFlowerTurnLauncherWindow
        open={props.open}
        intent={props.intent}
        anchor={props.anchor}
        copy={createFlowerTurnLauncherCopy(i18n)}
        onClose={props.onClose}
        onSubmit={props.onSubmit}
        onContextAction={executeContextAction}
        zIndex={FLOWER_TURN_LAUNCHER_Z_INDEX}
        windowClass="flower-turn-launcher-window"
        localScrollProps={REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
      />

      <PreviewWindow
        open={!!contextBrowser()}
        onOpenChange={(open) => {
          if (!open) closeContextBrowser();
        }}
        title={contextBrowser()?.title || i18n.t('flowerTurnLauncher.linkedContextTitle')}
        description={contextBrowser()?.subtitle || undefined}
        persistenceKey="flower-turn-context-browser"
        defaultSize={{ width: 760, height: 580 }}
        minSize={{ width: 420, height: 320 }}
        zIndex={FLOWER_TURN_CONTEXT_BROWSER_Z_INDEX}
        floatingClass="flower-turn-launcher-related-surface flower-turn-context-surface"
        mobileClass="flower-turn-launcher-related-surface flower-turn-context-surface"
      >
        <div class="h-full min-h-0 overflow-hidden bg-background">
          <Show when={contextBrowser()} keyed>
            {(browser) => (
              <RemoteFileBrowser
                stateScope="flower-turn-context-browser"
                initialPathOverride={browser.path}
              />
            )}
          </Show>
        </div>
      </PreviewWindow>

      <PreviewWindow
        open={!!contextPreview()}
        onOpenChange={(open) => {
          if (!open) closeContextPreview();
        }}
        title={contextPreview()?.title || i18n.t('flowerTurnLauncher.contextPreviewTitle')}
        description={contextPreview()?.subtitle || undefined}
        persistenceKey="flower-turn-context-preview"
        defaultSize={CONTEXT_PREVIEW_DEFAULT_SIZE}
        minSize={CONTEXT_PREVIEW_MIN_SIZE}
        zIndex={FLOWER_TURN_CONTEXT_PREVIEW_Z_INDEX}
        floatingClass="flower-turn-launcher-related-surface flower-turn-context-surface"
        mobileClass="flower-turn-launcher-related-surface flower-turn-context-surface"
        footer={(
          <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button size="sm" variant="outline" class="cursor-pointer" onClick={closeContextPreview}>
              {i18n.t('common.actions.close')}
            </Button>
            <Show when={contextPreview()?.actionLabel && contextPreview()?.onAction}>
              <Button
                size="sm"
                variant="default"
                class="cursor-pointer"
                onClick={() => {
                  contextPreview()?.onAction?.();
                }}
              >
                {contextPreview()?.actionLabel}
              </Button>
            </Show>
          </div>
        )}
      >
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <Show when={contextPreview()?.helper}>
            <div class={`shrink-0 border-b px-3 py-2 text-xs ${contextPreview()?.error ? 'border-error/20 bg-error/5 text-error' : 'border-border/70 bg-muted/25 text-muted-foreground'}`}>
              {contextPreview()?.helper}
            </div>
          </Show>
          <div class="min-h-0 flex-1 overflow-hidden">
            <Show when={contextPreview()}>
              {(preview) => (
                <FilePreviewContent
                  item={preview().item}
                  descriptor={preview().descriptor}
                  text={preview().text}
                  message={preview().message}
                  objectUrl={preview().objectUrl}
                  bytes={preview().bytes}
                  truncated={preview().truncated}
                  loading={preview().loading}
                  error={preview().error}
                  xlsxSheetName={preview().xlsxSheetName}
                  xlsxRows={preview().xlsxRows}
                />
              )}
            </Show>
          </div>
        </div>
      </PreviewWindow>
    </>
  );
}
