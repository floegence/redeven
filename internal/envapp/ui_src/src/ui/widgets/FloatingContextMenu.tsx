import { For, type Component } from 'solid-js';

export const FLOATING_CONTEXT_MENU_WIDTH_PX = 180;

const FLOATING_CONTEXT_MENU_VERTICAL_PADDING_PX = 16;
const FLOATING_CONTEXT_MENU_ACTION_HEIGHT_PX = 30;
const FLOATING_CONTEXT_MENU_SEPARATOR_HEIGHT_PX = 9;

type FloatingContextMenuActionItem = Readonly<{
  id: string;
  kind: 'action';
  label: string;
  icon: Component<{ class?: string }>;
  onSelect: () => void;
  disabled?: boolean;
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
  items: readonly FloatingContextMenuItem[];
  menuRef?: (el: HTMLDivElement) => void;
}

function isActionItem(item: FloatingContextMenuItem): item is FloatingContextMenuActionItem {
  return item.kind === 'action';
}

export function estimateFloatingContextMenuHeight(actionCount: number, separatorCount = 0): number {
  return FLOATING_CONTEXT_MENU_VERTICAL_PADDING_PX
    + Math.max(1, actionCount) * FLOATING_CONTEXT_MENU_ACTION_HEIGHT_PX
    + Math.max(0, separatorCount) * FLOATING_CONTEXT_MENU_SEPARATOR_HEIGHT_PX;
}

export const FloatingContextMenu: Component<FloatingContextMenuProps> = (props) => (
  <div
    ref={props.menuRef}
    role="menu"
    class="fixed z-50 min-w-[180px] py-1 bg-popover border border-border rounded-lg shadow-lg animate-in fade-in zoom-in-95 duration-100"
    style={{ left: `${props.x}px`, top: `${props.y}px` }}
    onContextMenu={(event) => event.preventDefault()}
  >
    <For each={props.items}>
      {(item) => {
        if (!isActionItem(item)) {
          return <div role="separator" aria-orientation="horizontal" class="my-1 border-t border-border/70" />;
        }

        const Icon = item.icon;
        const itemClass = item.destructive
          ? 'w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive'
          : 'w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground';
        return (
          <button
            type="button"
            role="menuitem"
            class={itemClass}
            onClick={item.onSelect}
            disabled={item.disabled}
          >
            <Icon class="w-3.5 h-3.5 opacity-60" />
            <span class="flex-1 text-left">{item.label}</span>
          </button>
        );
      }}
    </For>
  </div>
);
