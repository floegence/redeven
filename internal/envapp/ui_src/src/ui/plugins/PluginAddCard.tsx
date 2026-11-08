import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import { Download, Plus, Wand, Search } from '@floegence/floe-webapp-core/icons';
import type { JSX } from 'solid-js';
import { useI18n } from '../i18n';

export function PluginAddCard(props: { onCreate?: () => void; onInstall: () => void; onMarket: () => void }): JSX.Element {
  const i18n = useI18n();
  const items = (): DropdownItem[] => [
    ...(props.onCreate ? [{ id: 'create', label: i18n.t('uiCopy.plugin.creationTitle'), icon: () => <Wand class="h-4 w-4" /> }] : []),
    { id: 'market', label: i18n.t('uiCopy.plugin.installFromMarket'), icon: () => <Search class="h-4 w-4" /> },
    { id: 'install', label: i18n.t('uiCopy.plugin.installFromSource'), icon: () => <Download class="h-4 w-4" /> },
  ];
  return (
    <Dropdown
      class="flex min-w-0 self-stretch"
      triggerClass="plugin-center-add-trigger flex min-h-[144px] w-full flex-col gap-3 items-center justify-center rounded-lg border border-dashed px-3 py-5 text-muted-foreground hover:bg-[var(--floe-state-hover)] hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      trigger={<><Plus class="h-5 w-5" /><span data-plugin-center-add class="text-[13px] font-medium text-foreground">{i18n.t('uiCopy.plugin.addPlugin')}</span></>}
      items={items()}
      onSelect={id => { if (id === 'create') props.onCreate?.(); else if (id === 'market') props.onMarket(); else if (id === 'install') props.onInstall(); }}
    />
  );
}
