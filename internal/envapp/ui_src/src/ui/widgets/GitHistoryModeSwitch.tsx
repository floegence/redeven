import { cn } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, History } from '@floegence/floe-webapp-core/icons';

export type GitHistoryMode = 'files' | 'git';

export interface GitHistoryModeSwitchProps {
  mode: GitHistoryMode;
  onChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  class?: string;
}

export function GitHistoryModeSwitch(props: GitHistoryModeSwitchProps) {
  const buttonBaseClass =
    'cursor-pointer rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-55';

  return (
    <div
      role="radiogroup"
      aria-label="Browser mode"
      class={cn('inline-flex w-full items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 shadow-[0_1px_0_rgba(0,0,0,0.03)_inset]', props.class)}
    >
      <button
        type="button"
        role="radio"
        aria-checked={props.mode === 'files'}
        class={cn(
          buttonBaseClass,
          'flex min-w-0 flex-1 items-center justify-center gap-1.5 text-center',
          props.mode === 'files'
            ? 'border-border bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)]'
            : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
        onClick={() => props.onChange('files')}
      >
        <FilesIcon class="size-3.5 shrink-0" />
        <span class="truncate">Files</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={props.mode === 'git'}
        disabled={props.gitHistoryDisabled}
        class={cn(
          buttonBaseClass,
          'flex min-w-0 flex-1 items-center justify-center gap-1.5 text-center',
          props.mode === 'git'
            ? 'border-border bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)]'
            : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
        onClick={() => props.onChange('git')}
      >
        <History class="size-3.5 shrink-0" />
        <span class="truncate">Git</span>
      </button>
    </div>
  );
}
