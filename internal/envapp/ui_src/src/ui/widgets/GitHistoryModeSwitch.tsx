import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, History } from '@floegence/floe-webapp-core/icons';
import { Tooltip } from '../primitives/Tooltip';
import { redevenSegmentedItemClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';

export type GitHistoryMode = 'files' | 'git';

export interface GitHistoryModeSwitchProps {
  mode: GitHistoryMode;
  onChange: (mode: GitHistoryMode) => void;
  onPreviewGitMode?: () => void;
  gitHistoryDisabled?: boolean;
  gitHistoryDisabledReason?: string;
  class?: string;
}

export function GitHistoryModeSwitch(props: GitHistoryModeSwitchProps) {
  const buttonBaseClass =
    'relative z-10 flex h-7 min-w-0 w-full flex-1 cursor-pointer items-center justify-center gap-1.5 rounded border border-transparent px-2 text-center text-xs font-medium transition-[color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-55';
  const gitDisabledReason = () => String(props.gitHistoryDisabledReason ?? '').trim();
  const previewGitMode = () => {
    if (props.gitHistoryDisabled) return;
    props.onPreviewGitMode?.();
  };
  const renderGitButton = () => (
    <button
      type="button"
      role="radio"
      {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
      aria-checked={props.mode === 'git'}
      disabled={props.gitHistoryDisabled}
      class={cn(
        buttonBaseClass,
        props.mode === 'git'
          ? 'text-foreground'
          : `${redevenSegmentedItemClass(false)} text-muted-foreground hover:text-foreground`,
      )}
      onPointerEnter={previewGitMode}
      onFocus={previewGitMode}
      onClick={() => props.onChange('git')}
    >
      <History class="size-3.5 shrink-0" />
      <span class="truncate">Git</span>
    </button>
  );

  return (
    <div
      role="radiogroup"
      aria-label="Browser mode"
      data-browser-mode-switch=""
      data-mode={props.mode}
      class={cn('browser-mode-switch inline-grid w-full grid-cols-2 items-center rounded-md border p-0.5 shadow-[0_1px_0_rgba(0,0,0,0.03)_inset]', redevenSurfaceRoleClass('segmented'), props.class)}
    >
      <span class="browser-mode-switch__thumb" aria-hidden="true" />
      <button
        type="button"
        role="radio"
        {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
        aria-checked={props.mode === 'files'}
        class={cn(
          buttonBaseClass,
          props.mode === 'files'
            ? 'text-foreground'
            : `${redevenSegmentedItemClass(false)} text-muted-foreground hover:text-foreground`,
        )}
        onClick={() => props.onChange('files')}
      >
        <FilesIcon class="size-3.5 shrink-0" />
        <span class="truncate">Files</span>
      </button>

      <Show
        when={props.gitHistoryDisabled && gitDisabledReason()}
        fallback={renderGitButton()}
      >
        <Tooltip content={gitDisabledReason()} placement="top" delay={0}>
          <span class="flex min-w-0 flex-1">{renderGitButton()}</span>
        </Tooltip>
      </Show>
    </div>
  );
}
