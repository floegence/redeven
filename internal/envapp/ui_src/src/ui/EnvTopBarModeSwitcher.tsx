import { SegmentedControl, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import { ChevronDown } from '@floegence/floe-webapp-core/icons';
import { createMemo } from 'solid-js';

import { ENV_VIEW_MODE_LABELS, type EnvViewMode } from './envViewMode';

export interface EnvTopBarModeSwitcherProps {
  value: EnvViewMode;
  onChange: (mode: EnvViewMode) => void;
}

export function EnvTopBarModeSwitcher(props: EnvTopBarModeSwitcherProps) {
  const dropdownItems = createMemo<DropdownItem[]>(() => ([
    { id: 'tab', label: ENV_VIEW_MODE_LABELS.tab },
    { id: 'deck', label: ENV_VIEW_MODE_LABELS.deck },
    { id: 'infinite_map', label: ENV_VIEW_MODE_LABELS.infinite_map },
  ]));

  return (
    <div class="flex items-center gap-1 rounded-xl border border-border/65 bg-background/78 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.06)] backdrop-blur">
      <SegmentedControl
        value={props.value}
        onChange={(value) => props.onChange(value as EnvViewMode)}
        size="sm"
        class="border-0 bg-transparent p-0"
        options={[
          { value: 'tab', label: 'Tab' },
          { value: 'deck', label: 'Deck' },
        ]}
      />
      <Dropdown
        trigger={(
          <button
            type="button"
            class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-border/60 bg-background/88 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/70"
            aria-label="Choose env view mode"
          >
            {ENV_VIEW_MODE_LABELS[props.value]}
            <ChevronDown class="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        items={dropdownItems()}
        value={props.value}
        onSelect={(value) => props.onChange(value as EnvViewMode)}
        align="end"
      />
    </div>
  );
}
