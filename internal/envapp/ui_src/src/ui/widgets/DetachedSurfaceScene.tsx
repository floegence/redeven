import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useNotification } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from '../pages/EnvContext';
import type { DetachedSurface } from '../services/detachedSurface';
import { basenameFromAbsolutePath } from '../services/detachedSurface';
import { writeTextToClipboard } from '../utils/clipboard';
import { buildFilePreviewAskFlowerIntent } from '../utils/filePreviewAskFlower';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import {
  requestDesktopAskFlowerMainWindowHandoff,
  shouldRequireDesktopAskFlowerMainWindowHandoff,
} from '../services/desktopAskFlowerBridge';
import { createDebugConsoleController } from '../debugConsole/createDebugConsoleController';
import { DebugConsoleFooter, DebugConsolePanel } from '../debugConsole/DebugConsoleWindow';
import { DesktopDetachedWindowFrame } from './DesktopDetachedWindowFrame';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewControllerContent } from './FilePreviewControllerContent';
import { RemoteFileBrowser } from './RemoteFileBrowser';

export interface DetachedSurfaceSceneProps {
  surface: DetachedSurface;
  accessGateVisible: boolean;
  accessGatePanel: JSX.Element;
  connectError?: string | null;
}

type DetachedSurfaceFrameModel = Readonly<{
  title: string;
  subtitle?: string;
  headerActions?: JSX.Element;
  footer?: JSX.Element;
  body: JSX.Element;
}>;

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
  if (surface.kind === 'debug_console') {
    return 'Debug Console';
  }
  return `${surface.path} - File Browser`;
}

export function DetachedSurfaceScene(props: DetachedSurfaceSceneProps) {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notification = useNotification();
  const filePreview = useFilePreviewContext();
  const previewSurface = createMemo(() => props.surface.kind === 'file_preview' ? props.surface : null);
  const fileBrowserSurface = createMemo(() => props.surface.kind === 'file_browser' ? props.surface : null);
  const [pathCopied, setPathCopied] = createSignal(false);
  let previewContentEl: HTMLDivElement | undefined;
  let openedPreviewPath = '';
  let pathCopiedResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const debugConsole = props.surface.kind === 'debug_console'
    ? createDebugConsoleController({
        protocolStatus: () => protocol.status(),
        initialVisible: true,
        persistUIState: false,
        allowMinimize: false,
      })
    : null;

  createEffect(() => {
    const previousTitle = document.title;
    document.title = detachedSceneTitle(props.surface);
    onCleanup(() => {
      document.title = previousTitle;
    });
  });

  createEffect(() => {
    const surface = previewSurface();
    if (!surface) return;
    if (props.accessGateVisible) return;
    if (protocol.status() !== 'connected' || !protocol.client()) return;
    if (openedPreviewPath === surface.path) return;

    openedPreviewPath = surface.path;
    const item = buildDetachedPreviewItem(surface.path);
    void filePreview.controller.openPreview(item);
  });

  const resolvedPreviewPath = () => String(filePreview.controller.item()?.path ?? previewSurface()?.path ?? '').trim();
  const previewCanShowEditorActions = () => (
    Boolean(previewSurface())
    && filePreview.controller.descriptor().mode === 'text'
    && Boolean(filePreview.controller.canEdit())
  );

  createEffect(() => {
    resolvedPreviewPath();
    if (pathCopiedResetTimer !== undefined) {
      globalThis.clearTimeout(pathCopiedResetTimer);
      pathCopiedResetTimer = undefined;
    }
    setPathCopied(false);
  });

  onCleanup(() => {
    if (pathCopiedResetTimer !== undefined) {
      globalThis.clearTimeout(pathCopiedResetTimer);
      pathCopiedResetTimer = undefined;
    }
    openedPreviewPath = '';
    filePreview.controller.closePreview();
  });

  const handleCopyPath = async (): Promise<boolean> => {
    const path = resolvedPreviewPath();
    if (!path) {
      notification.error('Copy failed', 'Missing file path');
      return false;
    }

    try {
      await writeTextToClipboard(path);
      return true;
    } catch (error) {
      notification.error('Copy failed', error instanceof Error ? error.message : 'Failed to copy text to clipboard.');
      return false;
    }
  };

  const handleCopyPathWithFeedback = async () => {
    const copied = await handleCopyPath();
    if (!copied) return;
    setPathCopied(true);
    if (pathCopiedResetTimer !== undefined) {
      globalThis.clearTimeout(pathCopiedResetTimer);
    }
    pathCopiedResetTimer = globalThis.setTimeout(() => {
      pathCopiedResetTimer = undefined;
      setPathCopied(false);
    }, 1600);
  };

  const handleAskFlower = () => {
    const selectionText = String(filePreview.controller.selectedText() ?? '').trim() || readSelectionTextFromPreview(previewContentEl);
    const path = resolvedPreviewPath();
    if (
      requestDesktopAskFlowerMainWindowHandoff({
        source: 'file_preview',
        path,
        selectionText,
      })
    ) {
      return;
    }
    if (shouldRequireDesktopAskFlowerMainWindowHandoff()) {
      notification.error('Ask Flower unavailable', 'Redeven Desktop could not route Ask Flower to the main window. Reopen the main window and try again.');
      return;
    }

    const result = buildFilePreviewAskFlowerIntent({
      item: filePreview.controller.item(),
      selectionText,
    });
    if (result.error) {
      notification.error('Ask Flower unavailable', result.error);
      return;
    }
    if (!result.intent) return;
    env.openAskFlowerComposer(result.intent);
  };

  const previewHeaderActions = () => (
    <>
      <button
        type="button"
        class={`inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 ${
          pathCopied() ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        disabled={!resolvedPreviewPath()}
        aria-label={pathCopied() ? 'Path copied' : 'Copy path'}
        title={pathCopied() ? 'Path copied' : 'Copy path'}
        onClick={() => {
          void handleCopyPathWithFeedback();
        }}
      >
        <Show when={pathCopied()} fallback={<Copy class="size-4" />}>
          <Check class="size-4" />
        </Show>
      </button>

      <Show when={previewCanShowEditorActions() && !filePreview.controller.editing()}>
        <Button
          size="sm"
          variant="outline"
          class="cursor-pointer"
          onClick={() => filePreview.controller.beginEditing()}
        >
          Edit
        </Button>
      </Show>

      <Show when={previewCanShowEditorActions() && filePreview.controller.editing()}>
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            class="cursor-pointer"
            disabled={filePreview.controller.saving()}
            onClick={() => filePreview.controller.revertCurrent()}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            class="cursor-pointer"
            loading={filePreview.controller.saving()}
            disabled={!filePreview.controller.dirty()}
            onClick={() => {
              void filePreview.controller.saveCurrent();
            }}
          >
            Save
          </Button>
        </div>
      </Show>
    </>
  );

  const previewBody = () => (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="flex-1 min-h-0 overflow-hidden">
        <FilePreviewControllerContent
          controller={filePreview.controller}
          showHeader={false}
          contentRef={(element) => {
            previewContentEl = element;
          }}
        />
      </div>
    </div>
  );

  const previewFooter = () => (
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
          class="w-full cursor-pointer sm:w-auto"
          disabled={!filePreview.controller.item() || filePreview.controller.loading()}
          onClick={handleAskFlower}
        >
          Ask Flower
        </Button>

        <Button
          size="sm"
          variant="outline"
          class="w-full cursor-pointer sm:w-auto"
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
  );

  const fileBrowserScene = () => (
    <div class="h-full min-h-0 overflow-hidden bg-background">
      <RemoteFileBrowser
        stateScope="detached-surface"
        initialPathOverride={fileBrowserSurface()?.path}
        homePathOverride={fileBrowserSurface()?.homePath}
      />
    </div>
  );
  const debugConsoleScene = () => (
    <div class="h-full min-h-0 overflow-hidden bg-background">
      <DebugConsolePanel
        controller={debugConsole!}
        onClose={() => window.close()}
        closeLabel="Close Window"
        showMinimize={false}
      />
    </div>
  );

  const sceneModel = createMemo<DetachedSurfaceFrameModel>(() => {
    if (props.surface.kind === 'file_preview') {
      const path = resolvedPreviewPath() || previewSurface()?.path || '';
      return {
        title: basenameFromAbsolutePath(path),
        subtitle: path,
        headerActions: props.accessGateVisible ? undefined : previewHeaderActions(),
        footer: props.accessGateVisible ? undefined : previewFooter(),
        body: props.accessGateVisible ? props.accessGatePanel : previewBody(),
      };
    }

    if (props.surface.kind === 'debug_console') {
      return {
        title: 'Debug Console',
        subtitle: 'Detached desktop diagnostics window',
        footer: props.accessGateVisible ? undefined : <DebugConsoleFooter controller={debugConsole!} />,
        body: props.accessGateVisible ? props.accessGatePanel : debugConsoleScene(),
      };
    }

    return {
      title: 'File Browser',
      subtitle: fileBrowserSurface()?.path,
      body: props.accessGateVisible ? props.accessGatePanel : fileBrowserScene(),
    };
  });

  return (
    <DesktopDetachedWindowFrame
      title={sceneModel().title}
      subtitle={sceneModel().subtitle}
      headerActions={sceneModel().headerActions}
      footer={sceneModel().footer}
      banner={props.connectError
        ? (
            <div class="border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
              {props.connectError}
            </div>
          )
        : undefined}
    >
      {sceneModel().body}
    </DesktopDetachedWindowFrame>
  );
}
