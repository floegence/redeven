import { createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Tabs } from '@floegence/floe-webapp-core/ui';
import { History } from '@floegence/floe-webapp-core/icons';
import type { GitWorkbenchSubview, GitWorkbenchSubviewItem } from '../utils/gitWorkbench';
import { buildTabElementId, buildTabPanelElementId } from '../utils/tabNavigation';
import { useI18n } from '../i18n';

export interface GitViewNavProps {
  value: GitWorkbenchSubview;
  items: GitWorkbenchSubviewItem[];
  onChange: (value: GitWorkbenchSubview) => void;
  stashActive?: boolean;
  stashesDisabled?: boolean;
  onShowStashes?: () => void;
  class?: string;
}

const GIT_WORKBENCH_SUBVIEW_ID_PREFIX = 'git-workbench-subview';

/** One published tab owner supplies selection, keyboard navigation and motion. */
export function GitViewNav(props: GitViewNavProps) {
  const i18n = useI18n();
  const items = createMemo(() => [
    ...props.items.map(item => ({
      id: item.id,
      label: item.label,
      icon: <Dynamic component={item.icon} class="size-4" />,
    })),
    ...(props.onShowStashes ? [{ id: 'stashes', label: i18n.t('git.common.stashes'), icon: <History class="size-4" />, disabled: props.stashesDisabled }] : []),
  ].map(item => ({
    ...item,
    domId: buildTabElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, item.id),
    panelId: buildTabPanelElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, item.id),
  })));

  return <Tabs activationTiming="immediate" class={props.class} items={items()} activeId={props.stashActive ? 'stashes' : props.value}
    onChange={id => { if (id === 'stashes') props.onShowStashes?.(); else props.onChange(id as GitWorkbenchSubview); }}
    ariaLabel={i18n.t('uiCopy.git.views')}
    features={{ containerBorder: false, scrollButtons: 'never', indicator: { mode: 'slider', animated: true } }}
    slotClassNames={{ root: 'git-workspace-view-nav', scrollContainer: 'git-workspace-views', tab: 'git-workspace-view-tab', indicator: 'git-workspace-view-indicator' }}
  />;
}
