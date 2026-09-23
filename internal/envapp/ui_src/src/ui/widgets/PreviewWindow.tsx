import { Show, createMemo, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
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
  headerActions?: JSX.Element;
  description?: string;
  footer?: JSX.Element;
  children: JSX.Element;
  persistenceKey?: string;
  defaultSize?: WindowSize;
  minSize?: WindowSize;
  maxSize?: WindowSize;
  stackId?: string;
  onActivate?: () => void;
  floatingClass?: string;
  mobileClass?: string;
  surfaceRef?: PersistentFloatingWindowSurfaceRef;
}

export function PreviewWindow(props: PreviewWindowProps) {
  const layout = useLayout();
  const isMobile = createMemo(() => layout.isMobile());

  return (
    <Show
      when={isMobile()}
      fallback={(
        <PersistentFloatingWindow
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={props.title}
          headerActions={props.headerActions}
          footer={props.footer}
          stackId={props.stackId}
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
          {props.children}
        </PersistentFloatingWindow>
      )}
    >
      <Dialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={props.title}
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
        {props.children}
      </Dialog>
    </Show>
  );
}
