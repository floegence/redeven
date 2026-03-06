import { Files as FilesIcon, History } from '@floegence/floe-webapp-core/icons';
import { SegmentedControl } from '@floegence/floe-webapp-core/ui';

export type GitHistoryMode = 'files' | 'git_history';

export interface GitHistoryModeSwitchProps {
  mode: GitHistoryMode;
  onChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  class?: string;
}

export function GitHistoryModeSwitch(props: GitHistoryModeSwitchProps) {
  return (
    <SegmentedControl
      size="sm"
      class={props.class}
      value={props.mode}
      onChange={(value) => props.onChange(value === 'git_history' ? 'git_history' : 'files')}
      options={[
        { value: 'files', label: 'Files', icon: FilesIcon },
        { value: 'git_history', label: 'History', icon: History, disabled: props.gitHistoryDisabled },
      ]}
    />
  );
}
