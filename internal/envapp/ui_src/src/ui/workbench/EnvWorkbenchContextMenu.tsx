import { For, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

type EnvWorkbenchContextMenuActionItem = Readonly<{
  id: string;
  kind: 'action';
  label: string;
  icon: Component<{ class?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}>;

type EnvWorkbenchContextMenuSeparatorItem = Readonly<{
  id: string;
  kind: 'separator';
}>;

export type EnvWorkbenchContextMenuItem =
  | EnvWorkbenchContextMenuActionItem
  | EnvWorkbenchContextMenuSeparatorItem;

export interface EnvWorkbenchContextMenuProps {
  x: number;
  y: number;
  items: readonly EnvWorkbenchContextMenuItem[];
}

function isActionItem(item: EnvWorkbenchContextMenuItem): item is EnvWorkbenchContextMenuActionItem {
  return item.kind === 'action';
}

export function EnvWorkbenchContextMenu(props: EnvWorkbenchContextMenuProps) {
  return (
    <div
      role="menu"
      class="workbench-context-menu"
      data-redeven-workbench-boundary="true"
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <For each={props.items}>
        {(item) => {
          if (!isActionItem(item)) {
            return (
              <div
                role="separator"
                aria-orientation="horizontal"
                class="workbench-context-menu__separator"
              />
            );
          }

          const Icon = item.icon;

          return (
            <button
              type="button"
              role="menuitem"
              class={cn(
                'workbench-context-menu__item',
                item.destructive && 'is-destructive',
              )}
              onClick={item.onSelect}
              disabled={item.disabled}
            >
              <Icon class="h-3.5 w-3.5" />
              <span class="workbench-context-menu__label">{item.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
