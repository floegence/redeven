import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import type { BarItemContextMenuRequest } from '@floegence/floe-webapp-core/layout';
import { Pin } from '@floegence/floe-webapp-core/icons';
import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';

export type PluginPinContextMenuProps = Readonly<{
  request: BarItemContextMenuRequest | null;
  label: string;
  onSelect: () => void | Promise<void>;
  onClose: () => void;
  onLayerRef?: (element: HTMLDivElement | null) => void;
}>;

export function PluginPinContextMenu(props: PluginPinContextMenuProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;
  let itemRef: HTMLButtonElement | undefined;
  let restoreFocus = false;

  const close = (shouldRestoreFocus = true) => {
    restoreFocus = shouldRestoreFocus;
    props.onClose();
  };

  const select = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await props.onSelect();
    } finally {
      setBusy(false);
      close();
    }
  };

  createEffect(() => {
    const request = props.request;
    if (!request) return;
    restoreFocus = false;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef?.contains(event.target as Node) || request.trigger.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) itemRef?.focus({ preventScroll: true });
    });
    onCleanup(() => {
      cancelled = true;
      document.removeEventListener('pointerdown', handlePointerDown, true);
      props.onLayerRef?.(null);
      if (restoreFocus && request.trigger.isConnected) {
        request.trigger.focus({ preventScroll: true });
      }
    });
  });

  const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      itemRef?.focus({ preventScroll: true });
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement === itemRef) {
      event.preventDefault();
      event.stopPropagation();
      void select();
    }
  };

  return (
    <Show when={props.request}>
      {(request) => (
        <SurfaceFloatingLayer
          position={{ x: request().clientX, y: request().clientY }}
          owner={request().trigger}
          estimatedSize={{ width: 232, height: 48 }}
          layerRef={(element) => {
            menuRef = element;
            props.onLayerRef?.(element);
          }}
          role="menu"
          aria-label={props.label}
          data-plugin-pin-menu
          class="min-w-[14.5rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none animate-in fade-in zoom-in-95 duration-100 motion-reduce:animate-none"
          onKeyDown={handleKeyDown}
        >
          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            disabled={busy()}
            data-plugin-pin-menu-action
            class="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
            onClick={() => void select()}
          >
            <Pin class="h-4 w-4 shrink-0" />
            <span>{props.label}</span>
          </button>
        </SurfaceFloatingLayer>
      )}
    </Show>
  );
}
