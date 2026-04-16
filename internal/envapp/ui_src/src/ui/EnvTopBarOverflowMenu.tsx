import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import { MoreVertical } from '@floegence/floe-webapp-core/icons';

export interface EnvTopBarOverflowMenuProps {
  items: DropdownItem[];
  onSelect: (id: string) => void;
}

export function EnvTopBarOverflowMenu(props: EnvTopBarOverflowMenuProps) {
  return (
    <Dropdown
      trigger={(
        <button
          type="button"
          class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border/65 bg-background/78 text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.06)] backdrop-blur transition-colors hover:bg-muted/70"
          aria-label="Open environment actions"
        >
          <MoreVertical class="h-4 w-4" />
        </button>
      )}
      items={props.items}
      onSelect={props.onSelect}
      align="end"
    />
  );
}
