import { SegmentedControl } from '@floegence/floe-webapp-core/ui';

import type { EnvViewMode } from './envViewMode';

export interface EnvTopBarModeSwitcherProps {
  value: EnvViewMode;
  onChange: (mode: EnvViewMode) => void;
}

export function EnvTopBarModeSwitcher(props: EnvTopBarModeSwitcherProps) {
  return (
    <div class="rounded-xl border border-border/65 bg-background/78 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.06)] backdrop-blur">
      <SegmentedControl
        value={props.value}
        onChange={(value) => props.onChange(value as EnvViewMode)}
        size="sm"
        class="border-0 bg-transparent p-0"
        options={[
          { value: 'activity', label: 'Activity' },
          { value: 'deck', label: 'Deck' },
          { value: 'workbench', label: 'Workbench' },
        ]}
      />
    </div>
  );
}
