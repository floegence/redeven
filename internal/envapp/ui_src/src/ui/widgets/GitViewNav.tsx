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
    'cursor-pointer flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';
  const badgeBaseClass =
    'inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors duration-150';

  return (
    <div class={cn('space-y-1 rounded-lg bg-muted/[0.18] p-1', props.class)} role="tablist" aria-label="Git views">
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
                  ? 'bg-background text-foreground shadow-sm'
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
