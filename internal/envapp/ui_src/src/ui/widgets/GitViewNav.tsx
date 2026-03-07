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
  return (
    <div class={cn('space-y-1', props.class)} role="tablist" aria-label="Git views">
      <For each={props.items}>
        {(item) => {
          const active = () => props.value === item.id;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              class={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150',
                active()
                  ? 'border-border bg-muted/50 text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/20 hover:text-foreground'
              )}
              onClick={() => props.onChange(item.id)}
            >
              <span class="min-w-0 flex-1 truncate text-[12px] font-medium">{item.label}</span>
              <span class={cn(
                'inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                active() ? 'bg-background text-foreground' : 'bg-muted/60 text-muted-foreground'
              )}>
                {typeof item.count === 'number' && item.count > 0 ? item.count : '•'}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
