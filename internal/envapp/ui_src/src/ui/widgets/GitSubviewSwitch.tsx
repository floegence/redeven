import { SegmentedControl } from '@floegence/floe-webapp-core/ui';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';

export interface GitSubviewSwitchProps {
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  class?: string;
}

export function GitSubviewSwitch(props: GitSubviewSwitchProps) {
  return (
    <SegmentedControl
      size="sm"
      class={props.class}
      value={props.value}
      onChange={(value) => props.onChange((value as GitWorkbenchSubview) || 'overview')}
      options={props.items.map((item) => ({
        value: item.id,
        label: typeof item.count === 'number' && item.count > 0 ? `${item.label} (${item.count})` : item.label,
      }))}
    />
  );
}
