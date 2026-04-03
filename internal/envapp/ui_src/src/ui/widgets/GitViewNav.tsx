import { For } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';
import { buildTabElementId, buildTabPanelElementId, resolveRovingTabTargetId } from '../utils/tabNavigation';
import { gitSelectedChipClass } from './GitChrome';

export interface GitViewNavProps {
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  class?: string;
}

const GIT_WORKBENCH_SUBVIEW_ID_PREFIX = 'git-workbench-subview';

export function GitViewNav(props: GitViewNavProps) {
  const buttonBaseClass =
    'cursor-pointer flex w-full items-center justify-between gap-2 rounded px-2.5 py-2.5 text-left text-xs transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:py-1.5';
  const badgeBaseClass =
    'inline-flex min-w-[1.5rem] items-center justify-center rounded px-1 py-0.5 text-[10px] font-medium tabular-nums transition-colors duration-150';
  const tabRefs = new Map<GitWorkbenchSubview, HTMLButtonElement>();
  const itemIds = () => props.items.map((item) => item.id);

  const handleKeyDown = (event: KeyboardEvent, currentId: GitWorkbenchSubview) => {
    const nextId = resolveRovingTabTargetId(itemIds(), currentId, event.key, 'vertical');
    if (!nextId || nextId === currentId) return;
    event.preventDefault();
    props.onChange(nextId);
    queueMicrotask(() => tabRefs.get(nextId)?.focus());
  };

  return (
    <div
      class={cn('space-y-0.5 rounded-md bg-muted/[0.14] p-0.5', props.class)}
      role="tablist"
      aria-label="Git views"
      aria-orientation="vertical"
    >
      <For each={props.items}>
        {(item) => {
          const active = () => props.value === item.id;
          return (
            <button
              ref={(el) => {
                tabRefs.set(item.id, el);
              }}
              type="button"
              role="tab"
              id={buildTabElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, item.id)}
              aria-selected={active()}
              aria-controls={buildTabPanelElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, item.id)}
              tabIndex={active() ? 0 : -1}
              class={cn(
                buttonBaseClass,
                active()
                  ? 'border-l-[2px] git-browser-selection-surface git-browser-selection-nav font-medium'
                  : 'bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
              onClick={() => props.onChange(item.id)}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
            >
              <span class="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              <span
                class={cn(
                  badgeBaseClass,
                  active()
                    ? gitSelectedChipClass(true)
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
