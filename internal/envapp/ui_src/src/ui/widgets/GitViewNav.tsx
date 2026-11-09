import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';
import { buildTabElementId, buildTabPanelElementId, resolveRovingTabTargetId } from '../utils/tabNavigation';
import { useI18n } from '../i18n';

export interface GitViewNavProps {
  inactive?: boolean;
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  class?: string;
}

const GIT_WORKBENCH_SUBVIEW_ID_PREFIX = 'git-workbench-subview';

export function GitViewNav(props: GitViewNavProps) {
  const i18n = useI18n();
  const buttonBaseClass =
    'git-workspace-view-tab cursor-pointer flex shrink-0 items-center justify-center gap-1 text-[length:var(--floe-type-control)]';
  const tabRefs = new Map<GitWorkbenchSubview, HTMLButtonElement>();
  const itemIds = () => props.items.map((item) => item.id);

  const handleKeyDown = (event: KeyboardEvent, currentId: GitWorkbenchSubview) => {
    const nextId = resolveRovingTabTargetId(itemIds(), currentId, event.key, 'horizontal');
    if (!nextId || nextId === currentId) return;
    event.preventDefault();
    props.onChange(nextId);
    queueMicrotask(() => tabRefs.get(nextId)?.focus());
  };

  return (
    <div
      class={cn('git-workspace-views flex min-w-0 items-center', props.class)}
      role="tablist"
      aria-label={i18n.t('uiCopy.git.views')}
      aria-orientation="horizontal"
    >
      <For each={props.items}>
        {(item) => {
          const active = () => !props.inactive && props.value === item.id;
          return (
            <button
              ref={(el) => {
                tabRefs.set(item.id, el);
              }}
              type="button"
              role="tab"
              title={item.label}
              aria-label={item.label}
              id={buildTabElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, item.id)}
              aria-selected={active()}
              aria-controls={buildTabPanelElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, item.id)}
              tabIndex={active() || (props.inactive && props.value === item.id) ? 0 : -1}
              class={cn(
                buttonBaseClass,

              )}
              onClick={() => props.onChange(item.id)}
              onKeyDown={(event) => handleKeyDown(event, item.id)}
            >
              <span class="flex min-w-0 items-center gap-1.5" data-git-view-nav-label>
                <Dynamic component={item.icon} class="h-3.5 w-3.5 shrink-0" />
                <span class="whitespace-nowrap font-medium">{item.label}</span>
              </span>

            </button>
          );
        }}
      </For>
    </div>
  );
}
