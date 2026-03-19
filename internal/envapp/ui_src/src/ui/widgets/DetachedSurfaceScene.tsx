import { Show, createEffect, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useNotification } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from '../pages/EnvContext';
import type { DetachedSurface } from '../services/detachedSurface';
import { basenameFromAbsolutePath } from '../services/detachedSurface';
import { buildFilePreviewAskFlowerIntent } from '../utils/filePreviewAskFlower';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewContent } from './FilePreviewContent';
import { RemoteFileBrowser } from './RemoteFileBrowser';

export interface DetachedSurfaceSceneProps {
  surface: DetachedSurface;
  accessGateVisible: boolean;
  accessGatePanel: JSX.Element;
  connectError?: string | null;
}

function buildDetachedPreviewItem(path: string): FileItem {
  const name = basenameFromAbsolutePath(path);
  return {
    id: path,
    name,
    path,
    type: 'file',
  };
}

function detachedSceneTitle(surface: DetachedSurface): string {
  if (surface.kind === 'file_preview') {
    return `${basenameFromAbsolutePath(surface.path)} - File Preview`;
  }
  return `${surface.path} - File Browser`;
}

export function DetachedSurfaceScene(props: DetachedSurfaceSceneProps) {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notification = useNotification();
  const filePreview = useFilePreviewContext();
  let previewContentEl: HTMLDivElement | undefined;
  let openedPreviewPath = '';

  createEffect(() => {
    const previousTitle = document.title;
    document.title = detachedSceneTitle(props.surface);
    onCleanup(() => {
      document.title = previousTitle;
    });
  });

  createEffect(() => {
    if (props.surface.kind !== 'file_preview') return;
    if (props.accessGateVisible) return;
    if (protocol.status() !== 'connected' || !protocol.client()) return;
    if (openedPreviewPath === props.surface.path) return;

    openedPreviewPath = props.surface.path;
    const item = buildDetachedPreviewItem(props.surface.path);
    void filePreview.controller.openPreview(item);
  });

  onCleanup(() => {
    openedPreviewPath = '';
    filePreview.controller.closePreview();
  });

  const handleAskFlower = () => {
    const result = buildFilePreviewAskFlowerIntent({
      item: filePreview.controller.item(),
      selectionText: readSelectionTextFromPreview(previewContentEl),
    });
    if (result.error) {
      notification.error('Ask Flower unavailable', result.error);
      return;
    }
    if (!result.intent) return;
    env.openAskFlowerComposer(result.intent);
  };

  const previewScene = () => (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="flex-1 min-h-0 overflow-hidden">
        <FilePreviewContent
          item={filePreview.controller.item()}
          descriptor={filePreview.controller.descriptor()}
          text={filePreview.controller.text()}
          message={filePreview.controller.message()}
          objectUrl={filePreview.controller.objectUrl()}
          bytes={filePreview.controller.bytes()}
          truncated={filePreview.controller.truncated()}
          loading={filePreview.controller.loading()}
          error={filePreview.controller.error()}
          xlsxSheetName={filePreview.controller.xlsxSheetName()}
          xlsxRows={filePreview.controller.xlsxRows()}
          contentRef={(element) => {
            previewContentEl = element;
          }}
        />
      </div>

      <div class="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-h-4 min-w-0 text-[11px] text-muted-foreground">
          <Show when={filePreview.controller.truncated()}>
            <div class="truncate">Truncated preview</div>
          </Show>
        </div>

        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            class="w-full sm:w-auto"
            disabled={!filePreview.controller.item() || filePreview.controller.loading()}
            onClick={handleAskFlower}
          >
            Ask Flower
          </Button>

          <Button
            size="sm"
            variant="outline"
            class="w-full sm:w-auto"
            loading={filePreview.controller.downloadLoading()}
            disabled={!filePreview.controller.item() || filePreview.controller.loading()}
            onClick={() => {
              void filePreview.controller.downloadCurrent();
            }}
          >
            Download
          </Button>
        </div>
      </div>
    </div>
  );

  const fileBrowserScene = () => (
    <div class="h-full min-h-0 overflow-hidden bg-background">
      <RemoteFileBrowser
        stateScope="detached-surface"
        initialPathOverride={props.surface.path}
        homePathOverride={props.surface.kind === 'file_browser' ? props.surface.homePath : undefined}
      />
    </div>
  );

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <Show when={props.connectError}>
        <div class="shrink-0 border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {props.connectError}
        </div>
      </Show>

      <div class="flex-1 min-h-0 overflow-hidden">
        <Show
          when={!props.accessGateVisible}
          fallback={props.accessGatePanel}
        >
          <Show when={props.surface.kind === 'file_preview'} fallback={fileBrowserScene()}>
            {previewScene()}
          </Show>
        </Show>
      </div>
    </div>
  );
}
