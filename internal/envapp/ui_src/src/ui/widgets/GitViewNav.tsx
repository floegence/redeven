import { For } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';
import { gitSubviewTone, gitToneBadgeClass, gitToneSelectableCardClass } from './GitChrome';

export interface GitViewNavProps {
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  class?: string;
}

export function GitViewNav(props: GitViewNavProps) {
  return (
    <div class={cn('space-y-1.5', props.class)} role="tablist" aria-label="Git views">
      <For each={props.items}>
        {(item) => {
          const active = () => props.value === item.id;
          const tone = () => gitSubviewTone(item.id);
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              class={cn(
                'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150',
                gitToneSelectableCardClass(tone(), active())
              )}
              onClick={() => props.onChange(item.id)}
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] font-medium">{item.label}</div>
                <div class="mt-0.5 text-[10px] text-muted-foreground">
                  {item.id === 'overview' ? 'Status dashboard' : item.id === 'changes' ? 'Working tree' : item.id === 'branches' ? 'Refs and compare' : 'Commit timeline'}
                </div>
              </div>
              <span class={cn('inline-flex min-w-[2rem] items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums', gitToneBadgeClass(tone()))}>
                {typeof item.count === 'number' && item.count > 0 ? item.count : '•'}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
