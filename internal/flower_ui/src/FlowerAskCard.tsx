import { Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, untrack, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { X } from '@floegence/floe-webapp-core/icons';
import { Button, createFloatingPresence, type FloatingWindowViewportInsets } from '@floegence/floe-webapp-core/ui';
import { observeViewport, readViewportSnapshot } from '@floegence/floe-webapp-core/viewport';
import { FlowerIcon } from './icons/FlowerIcon';

type FlowerAskCardProps = Readonly<{
  open: boolean;
  anchor?: Readonly<{ x: number; y: number }> | null;
  viewportInsets?: FloatingWindowViewportInsets;
  title: string;
  closeLabel: string;
  busy: boolean;
  zIndex?: number;
  class?: string;
  children: JSX.Element;
  onActivate?: () => void;
  onClose: () => void;
}>;

/** A brief contextual question, not a draggable conversation window. */
export function FlowerAskCard(props: FlowerAskCardProps) {
  const titleID = createUniqueId();
  const [viewport, setViewport] = createSignal(readViewportSnapshot(window));
  const [card, setCard] = createSignal<HTMLDivElement>();
  const [height, setHeight] = createSignal(0);
  const anchor = createMemo<FlowerAskCardProps['anchor']>(previous => props.open ? props.anchor : previous);
  const presence = createFloatingPresence({ open: () => props.open, element: card });
  let returnFocus: HTMLElement | undefined;

  createEffect(() => {
    if (presence.mounted()) onCleanup(observeViewport(window, setViewport));
  });
  createEffect(() => {
    const element = card();
    if (!presence.mounted() || !element) return;
    const measure = () => setHeight(element.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    onCleanup(() => observer.disconnect());
  });

  const geometry = createMemo(() => {
    const view = viewport();
    const margin = view.visible.width < 640 ? 8 : 12;
    const insets = props.viewportInsets;
    const left = view.visible.left + Math.max(view.safeArea.left, insets?.left ?? 0) + margin;
    const top = view.visible.top + Math.max(view.safeArea.top, insets?.top ?? 0) + margin;
    const right = view.visible.right - Math.max(view.safeArea.right, insets?.right ?? 0) - margin;
    const bottom = view.visible.bottom - Math.max(view.safeArea.bottom, insets?.bottom ?? 0) - margin;
    const width = Math.max(0, Math.min(512, right - left));
    const maxHeight = Math.max(0, bottom - top);
    const renderedHeight = Math.min(height() * view.fixedScale, maxHeight);
    const point = anchor();
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const x = clamp(point ? point.x + 10 : left + (right - left - width) / 2, left, right - width);
    const preferredY = point
      ? (point.y + 10 + renderedHeight <= bottom ? point.y + 10 : point.y - renderedHeight - 10)
      : top + Math.max(0, (maxHeight - renderedHeight) * 0.32);
    const y = clamp(preferredY, top, bottom - renderedHeight);
    return { x, y, width, maxHeight, originX: point ? clamp(point.x - x, 24, width - 24) : width / 2,
      originY: point && point.y > y + renderedHeight / 2 ? '100%' : '0%' };
  });

  const close = (restoreFocus: boolean) => {
    if (props.busy || !props.open) return;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    props.onClose();
  };

  createEffect(() => {
    if (!props.open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !untrack(card)?.contains(active)) returnFocus = active;
    const belongsToCard = (event: Event) => event.composedPath().some(node =>
      node instanceof Element && (node === card() || node.classList.contains('flower-turn-launcher-related-surface')
        || (node.matches('[data-floe-geometry-surface="floating-window"]')
          && node.querySelector(':scope > .flower-turn-launcher-related-surface'))));
    const pointerDown = (event: PointerEvent) => {
      if (belongsToCard(event)) return;
      close(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || props.busy) return;
      // A preview or nested control owns its own Escape first.
      if (!(event.target instanceof Node) || !card()?.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    window.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown);
    onCleanup(() => {
      window.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('keydown', keyDown);
    });
  });

  return (
    <Show when={presence.mounted()}>
      <Portal>
        <div class="flower-ask-card-positioner" style={{
          left: `${(geometry().x + viewport().fixedOffset.left) / viewport().fixedScale}px`,
          top: `${(geometry().y + viewport().fixedOffset.top) / viewport().fixedScale}px`,
          width: `${geometry().width / viewport().fixedScale}px`,
          '--flower-ask-max-height': `${geometry().maxHeight / viewport().fixedScale}px`,
          '--flower-ask-origin-x': `${geometry().originX / viewport().fixedScale}px`,
          '--flower-ask-origin-y': geometry().originY,
          'z-index': props.zIndex ?? 100,
        }}>
          <div ref={setCard} role="dialog" aria-labelledby={titleID} tabIndex={-1}
            class={cn('flower-ask-card flower-turn-launcher-window', props.class)}
            data-flower-ask-card data-floe-input-surface data-floating-presence={presence.state()}
            data-floe-local-interaction-surface="true"
            inert={presence.exiting()} aria-hidden={presence.exiting() ? 'true' : undefined}
            onPointerDown={() => props.onActivate?.()} onFocusIn={() => props.onActivate?.()}>
            <header class="flower-ask-card-header">
              <span class="flower-ask-card-mark" aria-hidden="true"><FlowerIcon /></span>
              <h2 id={titleID}>{props.title}</h2>
              <Button variant="ghost" size="icon" icon={X} class="flower-ask-card-close"
                data-testid="flower-ask-card-close" disabled={props.busy}
                title={props.closeLabel} aria-label={props.closeLabel} onClick={() => close(true)} />
            </header>
            {props.children}
          </div>
        </div>
      </Portal>
    </Show>
  );
}
