import { handlePreviewSearchShortcut } from './previewSearchShortcut';
import type { FlowerPageContextState } from '../flower/flowerPageContext';
import { FlowerContextSource, type FlowerSourceFacts } from '../flower/FlowerContextSource';
import { Show, createMemo, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import type { EnvAppFloatingWindowStackLayer } from '../utils/envAppFloatingWindowStack';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { X } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import { PersistentFloatingWindow, type PersistentFloatingWindowSurfaceRef } from './PersistentFloatingWindow';

const PREVIEW_WINDOW_MARGIN_DESKTOP = 16;
const PREVIEW_WINDOW_DEFAULT_SIZE = { width: 1040, height: 760 };
const PREVIEW_WINDOW_MIN_SIZE = { width: 420, height: 320 };
type WindowSize = { width: number; height: number };

export interface PreviewWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  titleContent?: JSX.Element;
  headerActions?: JSX.Element;
  description?: string;
  footer?: JSX.Element;
  children: JSX.Element;
  persistenceKey?: string;
  defaultSize?: WindowSize;
  minSize?: WindowSize;
  maxSize?: WindowSize;
  stackId?: string;
  stackLayer?: EnvAppFloatingWindowStackLayer;
  onActivate?: () => void;
  floatingClass?: string;
  mobileClass?: string;
  surfaceRef?: PersistentFloatingWindowSurfaceRef;
  context?: Readonly<{ pageID: string; pageName: string; resourceKey?: string; state?: FlowerPageContextState; file?: FlowerSourceFacts['file'] }>;

}

export function PreviewWindow(props: PreviewWindowProps) {
  const sourceID = `preview:${createUniqueId()}`;
  const layout = useLayout();
  const i18n = useI18n();
  let shortcutHost: HTMLElement | null = null;
  const keydown = (event: KeyboardEvent) => handlePreviewSearchShortcut(event as KeyboardEvent & { currentTarget: HTMLElement });
  const bindSurface = (element: HTMLElement | null) => {
    shortcutHost?.removeEventListener('keydown', keydown);
    shortcutHost = element;
    shortcutHost?.addEventListener('keydown', keydown);
    props.surfaceRef?.(element);
  };
  onCleanup(() => shortcutHost?.removeEventListener('keydown', keydown));
  const isMobile = createMemo(() => layout.isMobile());

  return (
    <Show
      when={isMobile()}
      fallback={(
        <PersistentFloatingWindow
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={props.title}
          titleContent={props.titleContent}
          headerActions={props.headerActions}
          footer={props.footer}
          stackId={props.stackId}
          stackLayer={props.stackLayer}
          onActivate={props.onActivate}
          persistenceKey={props.persistenceKey}
          defaultSize={props.defaultSize ?? PREVIEW_WINDOW_DEFAULT_SIZE}
          minSize={props.minSize ?? PREVIEW_WINDOW_MIN_SIZE}
          maxSize={props.maxSize}
          viewportInsets={{ top: PREVIEW_WINDOW_MARGIN_DESKTOP, right: PREVIEW_WINDOW_MARGIN_DESKTOP, bottom: PREVIEW_WINDOW_MARGIN_DESKTOP, left: PREVIEW_WINDOW_MARGIN_DESKTOP }}
          surfaceRef={bindSurface}
          class={cn('file-preview-floating-window overflow-hidden rounded-md', props.floatingClass)}
          contentClass="min-h-0 flex flex-1 flex-col !overflow-hidden !p-0"
        >
          <FlowerContextSource class="flex min-h-0 w-full flex-1 flex-col overflow-hidden" id={sourceID} pageID={props.context?.pageID ?? sourceID} pageName={props.context?.pageName ?? props.title ?? i18n.t('filePreview.previewWindowTitle')} mode="overlay" resourceKey={props.context?.resourceKey} file={props.context?.file} enabled={props.open}
            boundary={body => body.closest<HTMLElement>('[data-floe-geometry-surface="floating-window"], [role="dialog"]') ?? body}
            state={props.context?.state ?? { title: props.title, detail: props.description }}>{props.children}</FlowerContextSource>
        </PersistentFloatingWindow>
      )}
    >
      <Dialog
        globalZIndex={props.stackLayer === 'flowerContext' ? ENV_APP_FLOATING_LAYER.mobileFlowerContext : ENV_APP_FLOATING_LAYER.productModal}
        escapeKeyPhase="bubble"
        onKeyDown={handlePreviewSearchShortcut}
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={props.title}
        header={props.titleContent || props.headerActions ? <div class="flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-2">
          {props.titleContent ?? <span class="min-w-0 flex-1 truncate text-sm font-semibold">{props.title}</span>}
          {props.headerActions}
          <Button size="icon" variant="ghost" class="size-8 shrink-0" aria-label={i18n.t('common.actions.close')} onClick={() => props.onOpenChange(false)}><X class="size-4" /></Button>
        </div> : undefined}
        bodyDescription={props.description}
        contentClass="flex min-h-0 flex-1 flex-col overflow-hidden p-0 [&>p]:px-4 [&>p]:pt-3 [&>p]:break-words"
        footer={props.footer}
        class={cn(
          'flex max-w-none flex-col overflow-hidden rounded-md p-0',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          'h-full w-full',
          props.mobileClass,
        )}
      >
        <FlowerContextSource class="flex min-h-0 w-full flex-1 flex-col overflow-hidden" id={sourceID} pageID={props.context?.pageID ?? sourceID} pageName={props.context?.pageName ?? props.title ?? i18n.t('filePreview.previewWindowTitle')} mode="overlay" resourceKey={props.context?.resourceKey} file={props.context?.file} enabled={props.open}
            boundary={body => body.closest<HTMLElement>('[data-floe-geometry-surface="floating-window"], [role="dialog"]') ?? body}
            state={props.context?.state ?? { title: props.title, detail: props.description }}>{props.children}</FlowerContextSource>
      </Dialog>
    </Show>
  );
}
