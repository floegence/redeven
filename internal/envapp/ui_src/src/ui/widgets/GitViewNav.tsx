import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';
import { buildTabElementId, buildTabPanelElementId, resolveRovingTabTargetId } from '../utils/tabNavigation';
import { gitNavigationItemClass, gitSelectedChipClass } from './GitChrome';
import { useI18n } from '../i18n';

export interface GitViewNavProps {
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  class?: string;
}

const GIT_WORKBENCH_SUBVIEW_ID_PREFIX = 'git-workbench-subview';

export function GitViewNav(props: GitViewNavProps) {
  const i18n = useI18n();
  const buttonBaseClass =
    'cursor-pointer grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left text-xs transition-[background-color,color,border-color] duration-150';
  const badgeBaseClass =
    'inline-flex min-w-[1.25rem] items-center justify-center rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums transition-colors duration-150';
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
      class={cn('grid w-full grid-cols-1 gap-0.5 rounded-md bg-muted/[0.12] p-0.5', props.class)}
      role="tablist"
      aria-label={i18n.t('uiCopy.git.views')}
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
                gitNavigationItemClass(active()),
              )}
              onClick={() => props.onChange(item.id)}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
            >
              <span class="flex min-w-0 items-center gap-2" data-git-view-nav-label>
                <Dynamic component={item.icon} class="h-3.5 w-3.5 shrink-0" />
                <span class="min-w-0 font-medium">{item.label}</span>
              </span>
              <Show when={typeof item.count === 'number' && item.count > 0}>
                <span
                  class={cn(
                    badgeBaseClass,
                    active()
                      ? gitSelectedChipClass(true)
                      : 'bg-background/70 text-muted-foreground',
                  )}
                >
                  {item.count}
                </span>
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
}
