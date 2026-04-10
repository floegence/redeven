import { Show, createEffect, createMemo, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';

const WINDOW_MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function resolveFocusableElements(container: HTMLElement | undefined): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>(WINDOW_MODAL_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled')) {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    return true;
  });
}

export interface WindowModalProps {
  open: boolean;
  host?: HTMLElement | null;
  title: string;
  description?: string;
  footer?: JSX.Element;
  children?: JSX.Element;
  class?: string;
  bodyClass?: string;
  overlayClass?: string;
  onOpenChange?: (open: boolean) => void;
}

export function WindowModal(props: WindowModalProps) {
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const resolvedHost = createMemo(() => props.host ?? null);
  const requestClose = () => props.onOpenChange?.(false);

  let dialogRef: HTMLDivElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  createEffect(() => {
    const host = resolvedHost();
    if (!props.open || !host) {
      previouslyFocused = null;
      return;
    }

    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusDialog = () => {
      const focusables = resolveFocusableElements(dialogRef);
      const target = focusables[0] ?? dialogRef;
      target?.focus();
    };

    const timer = window.setTimeout(focusDialog, 0);
    onCleanup(() => {
      window.clearTimeout(timer);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
      previouslyFocused = null;
    });
  });

  const handleKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusables = resolveFocusableElements(dialogRef);
    if (focusables.length === 0) {
      event.preventDefault();
      dialogRef?.focus();
      return;
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      return;
    }

    if (event.shiftKey) {
      if (!activeElement || activeElement === first || !dialogRef?.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (!activeElement || activeElement === last || !dialogRef?.contains(activeElement)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <Show when={props.open && resolvedHost()}>
      <Portal mount={resolvedHost()!}>
        <div
          data-testid="window-modal-overlay"
          class={cn('absolute inset-0 z-[20] flex items-center justify-center p-4', props.overlayClass)}
        >
          <div
            data-testid="window-modal-backdrop"
            class="absolute inset-0 cursor-pointer bg-background/56 backdrop-blur-[1.5px]"
            onMouseDown={() => requestClose()}
            onClick={() => requestClose()}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={props.description ? descriptionId : undefined}
            tabIndex={-1}
            class={cn(
              'relative z-[1] flex max-h-full w-[min(32rem,calc(100%-1rem))] max-w-full flex-col overflow-hidden rounded-md border border-border/80 bg-background shadow-[0_28px_72px_-44px_rgba(15,23,42,0.58)] outline-none',
              props.class,
            )}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            <div class="border-b border-border/70 px-4 pt-4 pb-3">
              <div id={titleId} class="text-sm font-semibold text-foreground">{props.title}</div>
              <Show when={props.description}>
                <div id={descriptionId} class="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</div>
              </Show>
            </div>

            <Show when={props.children}>
              <div class={cn('min-h-0 flex-1 overflow-auto', props.bodyClass)}>
                {props.children}
              </div>
            </Show>

            <Show when={props.footer}>
              {props.footer}
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
