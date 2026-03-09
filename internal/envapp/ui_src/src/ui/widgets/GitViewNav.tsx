import { For } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';

export interface GitViewNavProps {
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  class?: string;
}

export function GitViewNav(props: GitViewNavProps) {
  const buttonBaseClass =
    'cursor-pointer flex w-full items-center justify-between gap-2 rounded px-2.5 py-2.5 text-left text-xs transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:py-1.5';
  const badgeBaseClass =
    'inline-flex min-w-[1.5rem] items-center justify-center rounded px-1 py-0.5 text-[10px] font-medium tabular-nums transition-colors duration-150';

  return (
    <div class={cn('space-y-0.5 rounded-md bg-muted/[0.14] p-0.5', props.class)} role="tablist" aria-label="Git views">
      <For each={props.items}>
        {(item) => {
          const active = () => props.value === item.id;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              class={cn(
                buttonBaseClass,
                active()
                  ? 'border-l-[2px] border-primary bg-background text-foreground shadow-sm font-medium'
                  : 'bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
              onClick={() => props.onChange(item.id)}
            >
              <span class="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              <span
                class={cn(
                  badgeBaseClass,
                  active()
                    ? 'bg-muted/70 text-foreground'
                    : 'bg-background/70 text-muted-foreground',
                )}
              >
                {typeof item.count === 'number' && item.count > 0 ? item.count : '•'}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
