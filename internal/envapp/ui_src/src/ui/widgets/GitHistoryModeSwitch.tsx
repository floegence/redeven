import { cn } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, History } from '@floegence/floe-webapp-core/icons';
import { gitToneBadgeClass, gitToneSelectableCardClass } from './GitChrome';

export type GitHistoryMode = 'files' | 'git';

export interface GitHistoryModeSwitchProps {
  mode: GitHistoryMode;
  onChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  class?: string;
}

export function GitHistoryModeSwitch(props: GitHistoryModeSwitchProps) {
  return (
    <div role="radiogroup" aria-label="Browser mode" class={cn('grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-muted/20 p-1', props.class)}>
      <button
        type="button"
        role="radio"
        aria-checked={props.mode === 'files'}
        class={cn(
          'flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-all duration-150',
          gitToneSelectableCardClass('info', props.mode === 'files')
        )}
        onClick={() => props.onChange('files')}
      >
        <span class="inline-flex min-w-0 items-center gap-2">
          <FilesIcon class="size-3.5 shrink-0" />
          <span class="truncate text-[12px] font-medium">Files</span>
        </span>
        <span class={cn('hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline-flex', gitToneBadgeClass('info'))}>Browse</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={props.mode === 'git'}
        disabled={props.gitHistoryDisabled}
        class={cn(
          'flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-55',
          gitToneSelectableCardClass('violet', props.mode === 'git')
        )}
        onClick={() => props.onChange('git')}
      >
        <span class="inline-flex min-w-0 items-center gap-2">
          <History class="size-3.5 shrink-0" />
          <span class="truncate text-[12px] font-medium">Git</span>
        </span>
        <span class={cn('hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline-flex', gitToneBadgeClass('violet'))}>Inspect</span>
      </button>
    </div>
  );
}
