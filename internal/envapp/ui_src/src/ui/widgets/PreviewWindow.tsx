import { FlowerContextSource } from '../flower/FlowerContextSource';
import { Show, createMemo, createUniqueId, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import type { EnvAppFloatingWindowStackLayer } from '../utils/envAppFloatingWindowStack';
import { Button } from '@floegence/floe-webapp-core/ui';
import { X } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
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
}

export function PreviewWindow(props: PreviewWindowProps) {
  const sourceID = `preview:${createUniqueId()}`;
  const layout = useLayout();
  const i18n = useI18n();
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
          surfaceRef={props.surfaceRef}
          class={cn('file-preview-floating-window overflow-hidden rounded-md', props.floatingClass)}
          contentClass="min-h-0 flex flex-1 flex-col !overflow-hidden !p-0"
        >
          <FlowerContextSource id={sourceID} pageID={sourceID} pageName={props.title ?? i18n.t('filePreview.previewWindowTitle')} mode="overlay" state={{ title: props.title, detail: props.description }}>{props.children}</FlowerContextSource>
        </PersistentFloatingWindow>
      )}
    >
      <Dialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={props.title}
        header={props.titleContent ? <div class="flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-2">
          {props.titleContent}
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
        <FlowerContextSource id={sourceID} pageID={sourceID} pageName={props.title ?? i18n.t('filePreview.previewWindowTitle')} mode="overlay" state={{ title: props.title, detail: props.description }}>{props.children}</FlowerContextSource>
      </Dialog>
    </Show>
  );
}
