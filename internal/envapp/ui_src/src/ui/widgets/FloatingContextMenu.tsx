import { For, createUniqueId, onCleanup, onMount, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SurfaceFloatingLayer, type MenuDismissReason } from '@floegence/floe-webapp-core/ui';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';

export const FLOATING_CONTEXT_MENU_WIDTH_PX = 180;

const FLOATING_CONTEXT_MENU_VERTICAL_PADDING_PX = 16;
const FLOATING_CONTEXT_MENU_ACTION_HEIGHT_PX = 30;
const FLOATING_CONTEXT_MENU_SEPARATOR_HEIGHT_PX = 9;
const FLOATING_CONTEXT_MENU_BOUNDARY_MARGIN_PX = 8;
const FLOATING_CONTEXT_MENU_MAX_HEIGHT_PX = 512;

type FloatingContextMenuActionItem = Readonly<{
  id: string;
  kind: 'action';
  label: string;
  icon: Component<{ class?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
}>;

type FloatingContextMenuSeparatorItem = Readonly<{
  id: string;
  kind: 'separator';
}>;

export type FloatingContextMenuItem = FloatingContextMenuActionItem | FloatingContextMenuSeparatorItem;

export interface FloatingContextMenuProps {
  x: number;
  y: number;
  ariaLabel: string;
  focusAnchor?: HTMLElement | null;
  boundarySize?: Readonly<{ width: number; height: number }>;
  width?: number;
  estimatedActionHeight?: number;
  focusDisabledItems?: boolean;
  restoreFocusOnEscape?: boolean;
  restoreFocusOnTab?: boolean;
  roomy?: boolean;
  items: readonly FloatingContextMenuItem[];
  menuRef?: (el: HTMLDivElement) => void;
  onDismiss: (reason: MenuDismissReason) => void;
}

function isActionItem(item: FloatingContextMenuItem): item is FloatingContextMenuActionItem {
  return item.kind === 'action';
}

export function estimateFloatingContextMenuHeight(actionCount: number, separatorCount = 0): number {
  return FLOATING_CONTEXT_MENU_VERTICAL_PADDING_PX
    + Math.max(1, actionCount) * FLOATING_CONTEXT_MENU_ACTION_HEIGHT_PX
    + Math.max(0, separatorCount) * FLOATING_CONTEXT_MENU_SEPARATOR_HEIGHT_PX;
}

export const FloatingContextMenu: Component<FloatingContextMenuProps> = (props) => {
  let menuEl: HTMLDivElement | null = null;
  const disabledDescriptionPrefix = createUniqueId();

  const actionElements = (): HTMLButtonElement[] => (
    menuEl
      ? Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
          (element) => props.focusDisabledItems
            || (!element.disabled && element.getAttribute('aria-disabled') !== 'true'),
        )
      : []
  );

  const focusAt = (index: number) => {
    const actions = actionElements();
    if (actions.length === 0) return;
    actions[(index + actions.length) % actions.length]?.focus();
  };

  const dismiss = (reason: MenuDismissReason) => {
    const focusAnchor = props.focusAnchor;
    const restoreFocus = reason === 'tab'
      || reason === 'shift-tab'
      || (reason === 'escape' && props.restoreFocusOnEscape);
    props.onDismiss(reason);
    if (restoreFocus && focusAnchor?.isConnected) {
      focusAnchor.focus({ preventScroll: true });
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const actions = actionElements();
    const activeIndex = actions.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(activeIndex < 0 ? 0 : activeIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(activeIndex < 0 ? actions.length - 1 : activeIndex - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(actions.length - 1);
        return;
      case 'Enter':
      case ' ':
        if (activeIndex < 0) return;
        event.preventDefault();
        actions[activeIndex]?.click();
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        dismiss('escape');
        return;
      case 'Tab':
        if (props.restoreFocusOnTab) event.preventDefault();
        dismiss(event.shiftKey ? 'shift-tab' : 'tab');
        return;
      default:
        return;
    }
  };

  onMount(() => {
    const frame = requestAnimationFrame(() => focusAt(0));
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <SurfaceFloatingLayer
      layerRef={(element) => {
        menuEl = element;
        props.menuRef?.(element);
      }}
      position={{ x: props.x, y: props.y }}
      estimatedSize={{
        width: props.width ?? FLOATING_CONTEXT_MENU_WIDTH_PX,
        height: FLOATING_CONTEXT_MENU_VERTICAL_PADDING_PX
          + Math.max(1, props.items.filter((item) => item.kind === 'action').length)
            * (props.estimatedActionHeight ?? FLOATING_CONTEXT_MENU_ACTION_HEIGHT_PX)
          + props.items.filter((item) => item.kind === 'separator').length
            * FLOATING_CONTEXT_MENU_SEPARATOR_HEIGHT_PX,
      }}
      role="menu"
      aria-label={props.ariaLabel}
      style={{
        width: props.width ? `${props.width}px` : undefined,
        'max-width': `${Math.max(
          0,
          (props.boundarySize?.width || document.documentElement.clientWidth || window.innerWidth)
            - FLOATING_CONTEXT_MENU_BOUNDARY_MARGIN_PX * 2,
        )}px`,
        'max-height': `${Math.min(
          FLOATING_CONTEXT_MENU_MAX_HEIGHT_PX,
          Math.max(
            0,
            (props.boundarySize?.height || document.documentElement.clientHeight || window.innerHeight)
              - FLOATING_CONTEXT_MENU_BOUNDARY_MARGIN_PX * 2,
          ),
        )}px`,
      }}
      class={cn(
        'min-w-[180px] overflow-y-auto py-1 border rounded-lg shadow-lg animate-in fade-in zoom-in-95 duration-100',
        redevenSurfaceRoleClass('overlay'),
      )}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      <For each={props.items}>
        {(item, index) => {
          if (!isActionItem(item)) {
            return <div role="separator" aria-orientation="horizontal" class={cn('my-1 border-t', redevenDividerRoleClass('strong'))} />;
          }

          const Icon = item.icon;
          const itemDisabled = Boolean(item.disabled || item.disabledReason);
          const focusableDisabled = Boolean(props.focusDisabledItems && itemDisabled);
          const disabledDescriptionID = item.disabledReason
            ? `${disabledDescriptionPrefix}-disabled-${index()}`
            : undefined;
          const itemClass = props.roomy
            ? item.destructive
              ? 'w-full min-h-9 flex items-start gap-2 px-3 py-2 text-xs cursor-pointer transition-colors duration-75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive'
              : 'w-full min-h-9 flex items-start gap-2 px-3 py-2 text-xs cursor-pointer transition-colors duration-75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground'
            : item.destructive
              ? 'w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive'
              : 'w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground';
          return (
            <button
              type="button"
              role="menuitem"
              class={itemClass}
              disabled={itemDisabled && !focusableDisabled}
              aria-disabled={focusableDisabled ? 'true' : undefined}
              aria-describedby={disabledDescriptionID}
              title={item.disabledReason}
              onClick={() => {
                if (!itemDisabled) item.onSelect();
              }}
            >
              <Icon class={props.roomy ? 'mt-0.5 w-3.5 h-3.5 shrink-0 opacity-60' : 'w-3.5 h-3.5 opacity-60'} />
              <span class={props.roomy ? 'min-w-0 flex-1 whitespace-normal break-words text-left leading-4' : 'flex-1 text-left'}>{item.label}</span>
              {item.disabledReason ? (
                <span id={disabledDescriptionID} class="sr-only">{item.disabledReason}</span>
              ) : null}
            </button>
          );
        }}
      </For>
    </SurfaceFloatingLayer>
  );
};
