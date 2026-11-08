import { useEnvContext } from '../pages/EnvContext';
import { buildFilePreviewFlowerTurnLauncherIntent } from '../utils/filePreviewAskFlower';
import { FlowerContextSource } from '../flower/FlowerContextSource';
import { DownloadTaskButton } from '../downloads/DownloadTaskButton';
import { useDownloadManager } from '../downloads/DownloadContext';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { readFilePreviewWindowRequest } from '../../../../../../desktop/src/shared/filePreviewWindow';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewDocument } from './FilePreviewHost';
import { FilePreviewPanel } from './FilePreviewPanel';
import { FilePreviewActions } from './FilePreviewActions';
import { FilePreviewSearchScope } from './FilePreviewSearch';
import type { FilePreviewSurfaceProps } from './FilePreviewSurface';
import { useI18n } from '../i18n';

function StandaloneSurface(props: FilePreviewSurfaceProps) {
  const downloads = useDownloadManager();
  const [content, setContent] = createSignal<HTMLDivElement>();
  const originalTitle = document.title;
  createEffect(() => { document.title = props.item?.name ?? originalTitle; });
  onCleanup(() => { document.title = originalTitle; });
  return <FilePreviewSearchScope>
    <section class="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground" data-file-preview-standalone>
      <header class="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3"
        data-redeven-desktop-titlebar-drag-region="true" data-redeven-desktop-window-titlebar="true" data-redeven-desktop-window-titlebar-content="true">
        <h1 class="min-w-0 flex-1 truncate text-sm font-medium" title={props.item?.path}>{props.item?.name}</h1>
        <Show when={downloads.tasks().length > 0}><DownloadTaskButton /></Show>
        <FilePreviewActions {...props} active compact presentation="header" contentElement={content()} />
      </header>
      <FlowerContextSource class="min-h-0 flex-1" selected boundary={body => body.closest('[data-file-preview-standalone]') as HTMLElement} id="standalone-file-preview" pageID="file-preview" pageName={props.item?.name ?? ''} mode="overlay" state={{ path: props.item?.path }}>
        <FilePreviewPanel {...props} active surface="main" showHeader={false} contentRef={setContent} />
      </FlowerContextSource>
    </section>
  </FilePreviewSearchScope>;
}

export function FilePreviewStandalone(props: { onAskFlowerReady: (action: (() => void) | undefined) => void }) {
  const env = useEnvContext();
  const context = useFilePreviewContext();
  const i18n = useI18n();
  const request = readFilePreviewWindowRequest(window.location.search);
  onMount(() => {
    if (!request) return;
    props.onAskFlowerReady(() => {
      const { intent } = buildFilePreviewFlowerTurnLauncherIntent({ item: context.controller.item() });
      if (intent) env.openFlowerTurnLauncher(intent);
    });
    onCleanup(() => props.onAskFlowerReady(undefined));
    const name = request.path.slice(request.path.lastIndexOf('/') + 1);
    void context.workspace?.openPreview({ id: request.path, path: request.path, name, type: 'file' });
  });
  return <Show when={request} fallback={<div class="p-6 text-sm" role="alert">{i18n.t('shell.notifications.invalidFilePath')}</div>}>
    <FilePreviewDocument controller={context.controller} surface={StandaloneSurface} standalone />
  </Show>;
}
