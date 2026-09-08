import type { JSX } from 'solid-js';
import { createEffect, onCleanup } from 'solid-js';
import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';

/** Flower menus share projected placement and keyboard/focus ownership. */
export function FlowerContextMenu(props: Readonly<{
  x: number;
  y: number;
  label: string;
  height: number;
  resolveRestore: () => HTMLElement | undefined;
  onClose: () => void;
  children: JSX.Element;
}>): JSX.Element {
  let menuRef: HTMLDivElement | undefined;
  let disposed = false;
  const focusableItems = () => Array.from(menuRef?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
  const focusItem = (delta: number) => {
    const items = focusableItems();
    if (items.length === 0) return;
    const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
    items[(current + delta + items.length) % items.length]?.focus();
  };
  const focusMenu = () => {
    const first = focusableItems()[0];
    if (first) {
      first.focus({ preventScroll: true });
      return;
    }
    menuRef?.focus({ preventScroll: true });
  };
  const eventPathContains = (event: Event, node: Node | undefined): boolean => {
    if (!node) return false;
    const path = event.composedPath();
    return path.includes(node) || (event.target instanceof Node && node.contains(event.target));
  };
  createEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (eventPathContains(event, menuRef)) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!menuRef) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (!(event.target instanceof Node) || !menuRef.contains(event.target)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusItem(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusItem(-1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusableItems()[0]?.focus();
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        const items = focusableItems();
        items[items.length - 1]?.focus();
      }
    };
    const onResize = () => props.onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    const focusFrame = requestAnimationFrame(() => {
      focusMenu();
    });
    onCleanup(() => {
      disposed = true;
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    });
  });
  return (
    <SurfaceFloatingLayer
      owner={props.resolveRestore()}
      position={{ x: props.x, y: props.y }}
      estimatedSize={{ width: 272, height: props.height }}
      class="flower-thread-context-menu-layer"
      data-flower-floating-layer="true"
    >
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        class="flower-thread-context-menu"
        aria-label={props.label}
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && (menuRef?.contains(next) || next === props.resolveRestore())) return;
          queueMicrotask(() => {
            if (disposed) return;
            const active = document.activeElement;
            if (active instanceof Node && (menuRef?.contains(active) || active === props.resolveRestore())) return;
            props.onClose();
          });
        }}
      >
        {props.children}
      </div>
    </SurfaceFloatingLayer>
  );
}
