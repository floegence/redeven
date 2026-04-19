import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { PersistentFloatingWindow, type PersistentFloatingWindowSurfaceRef } from './PersistentFloatingWindow';
import { ENV_APP_FLOATING_LAYER, ENV_APP_FLOATING_LAYER_CLASS } from '../utils/envAppLayers';

const PREVIEW_WINDOW_MARGIN_DESKTOP = 16;
const PREVIEW_WINDOW_DEFAULT_WIDTH = 1040;
const PREVIEW_WINDOW_DEFAULT_HEIGHT = 760;
const PREVIEW_WINDOW_MIN_WIDTH = 420;
const PREVIEW_WINDOW_MIN_HEIGHT = 320;
export const PREVIEW_WINDOW_Z_INDEX = ENV_APP_FLOATING_LAYER.previewWindow;

type ViewportSize = {
  width: number;
  height: number;
};

type WindowSize = {
  width: number;
  height: number;
};

function currentViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveWindowSize(value: WindowSize | undefined, fallback: WindowSize): WindowSize {
  if (!value) return fallback;
  return {
    width: value.width,
    height: value.height,
  };
}

function resolveDesktopWindowSizing(
  viewport: ViewportSize,
  sizes: {
    defaultSize?: WindowSize;
    minSize?: WindowSize;
    maxSize?: WindowSize;
  },
) {
  const maxWidth = Math.max(320, viewport.width - PREVIEW_WINDOW_MARGIN_DESKTOP * 2);
  const maxHeight = Math.max(320, viewport.height - PREVIEW_WINDOW_MARGIN_DESKTOP * 2);
  const resolvedMaxSize = resolveWindowSize(sizes.maxSize, { width: maxWidth, height: maxHeight });
  const resolvedDefaultSize = resolveWindowSize(sizes.defaultSize, { width: PREVIEW_WINDOW_DEFAULT_WIDTH, height: PREVIEW_WINDOW_DEFAULT_HEIGHT });
  const resolvedMinSize = resolveWindowSize(sizes.minSize, { width: PREVIEW_WINDOW_MIN_WIDTH, height: PREVIEW_WINDOW_MIN_HEIGHT });

  return {
    defaultSize: {
      width: Math.min(resolvedDefaultSize.width, resolvedMaxSize.width),
      height: Math.min(resolvedDefaultSize.height, resolvedMaxSize.height),
    },
    minSize: {
      width: Math.min(resolvedMinSize.width, resolvedMaxSize.width),
      height: Math.min(resolvedMinSize.height, resolvedMaxSize.height),
    },
    maxSize: {
      width: Math.min(resolvedMaxSize.width, maxWidth),
      height: Math.min(resolvedMaxSize.height, maxHeight),
    },
  };
}

export interface PreviewWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  footer?: JSX.Element;
  children: JSX.Element;
  persistenceKey?: string;
  defaultSize?: WindowSize;
  minSize?: WindowSize;
  maxSize?: WindowSize;
  zIndex?: number;
  floatingClass?: string;
  mobileClass?: string;
  surfaceRef?: PersistentFloatingWindowSurfaceRef;
}

export function PreviewWindow(props: PreviewWindowProps) {
  const layout = useLayout();
  const isMobile = createMemo(() => layout.isMobile());
  const [viewport, setViewport] = createSignal(currentViewportSize());

  onMount(() => {
    const syncViewport = () => setViewport(currentViewportSize());
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    onCleanup(() => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    });
  });

  const desktopSizing = createMemo(() => resolveDesktopWindowSizing(viewport(), {
    defaultSize: props.defaultSize,
    minSize: props.minSize,
    maxSize: props.maxSize,
  }));

  return (
    <Show
      when={isMobile()}
      fallback={(
        <PersistentFloatingWindow
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={props.title}
          footer={props.footer}
          persistenceKey={props.persistenceKey}
          defaultSize={desktopSizing().defaultSize}
          minSize={desktopSizing().minSize}
          maxSize={desktopSizing().maxSize}
          zIndex={props.zIndex ?? PREVIEW_WINDOW_Z_INDEX}
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
        description={props.description}
        footer={props.footer}
        class={cn(
          ENV_APP_FLOATING_LAYER_CLASS.previewWindow,
          'flex max-w-none flex-col overflow-hidden rounded-md p-0',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:!overflow-hidden [&>div:nth-child(2)]:!p-0',
          'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none',
          props.mobileClass,
        )}
      >
        {props.children}
      </Dialog>
    </Show>
  );
}
