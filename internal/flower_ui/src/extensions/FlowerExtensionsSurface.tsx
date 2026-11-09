import { Show, createMemo, createSignal, createUniqueId, type JSX } from 'solid-js';
import { Button, Tabs } from '@floegence/floe-webapp-core/ui';
import { ChevronLeft, Package, Wand, Workflow } from '@floegence/floe-webapp-core/icons';
import { FlowerExtensionsContext, type ExtensionI18n } from './context';
import { SkillsSection } from './SkillsSection';
import { AgentPluginsPanel } from './AgentPluginsPanel';
import { MCPPanel } from './MCPPanel';
import type { FlowerExtensionsAdapter } from './types';
import './extensions.css';

export function FlowerExtensionsSurface(props: { embedded?: boolean; active?: boolean; adapter: FlowerExtensionsAdapter; i18n: ExtensionI18n; onBack?: () => void; headerTrailingActions?: JSX.Element }) {
  const [tab, setTab] = createSignal<'skills' | 'mcp' | 'plugins'>('skills');
  const [mcpVisited, setMCPVisited] = createSignal(false);
  const [pluginsVisited, setPluginsVisited] = createSignal(false);
  const [selectedPlugin, setSelectedPlugin] = createSignal({ id: '' });
  const [catalogRevision, setCatalogRevision] = createSignal(0);
  const id = createUniqueId();
  // IMPORTANT: Tabs may read items from event handlers. Allocate reactive icon
  // nodes under this component owner, never inside an event-time prop getter.
  const tabs = createMemo(() => (['skills', 'mcp', 'plugins'] as const).map(value => ({ id: value, label: props.i18n.t(value), domId: `${id}-${value}-tab`, panelId: `${id}-${value}-panel`,
    icon: value === 'skills' ? <Wand class="size-4" aria-hidden="true" /> : value === 'mcp' ? <Workflow class="size-4" aria-hidden="true" /> : <Package class="size-4" aria-hidden="true" /> })));
  const select = (value: 'skills' | 'mcp' | 'plugins') => { if (value === 'mcp') setMCPVisited(true); if (value === 'plugins') setPluginsVisited(true); setTab(value); };
  return <FlowerExtensionsContext.Provider value={{ ...props.adapter, isPresented: section => props.active !== false && tab() === section, openPlugin: id => { setSelectedPlugin({ id }); select('plugins'); }, selectedPlugin, catalogRevision, catalogChanged: () => setCatalogRevision(value => value + 1), i18n: { t: (key, params) => props.i18n.t(key, params), tn: (key, count) => props.i18n.tn(key, count), dateTime: timestamp => props.i18n.dateTime(timestamp) } }}>
    {/* IMPORTANT: An embedded category delegates its title, close action, outer
        spacing and scrolling to Settings. Back only belongs to real navigation. */}
    <div class="flower-extensions" data-presentation={props.embedded ? 'embedded' : 'standalone'} data-testid="flower-extensions">
      <Show when={!props.embedded}>
      <header class="flower-extensions-header">
        <Show when={props.onBack}><Button size="icon" variant="ghost" icon={ChevronLeft} aria-label={props.i18n.t('back')} title={props.i18n.t('back')} onClick={props.onBack} /></Show>
        <h1>{props.i18n.t('title')}</h1>
        <Show when={props.headerTrailingActions}><div class="flower-extensions-header-actions">{props.headerTrailingActions}</div></Show>
      </header>
      </Show>
      <div class="flower-extensions-navigation">
        <Tabs class="flower-extensions-tabs" ariaLabel={props.i18n.t('title')} size="md"
          items={tabs()}
          activeId={tab()} onChange={value => { if (value === 'skills' || value === 'mcp' || value === 'plugins') select(value); }}
          slotClassNames={{ indicator: 'flower-extensions-tab-indicator' }}
          features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary' }, containerBorder: true, scrollButtons: 'never' }} />
        <Show when={props.embedded && props.headerTrailingActions}><div class="flower-extensions-header-actions">{props.headerTrailingActions}</div></Show>
      </div>
      <div class="flower-extensions-content">
        <div role="tabpanel" id={`${id}-skills-panel`} aria-labelledby={`${id}-skills-tab`} hidden={tab() !== 'skills'} inert={tab() !== 'skills'}><SkillsSection /></div>
        <div role="tabpanel" id={`${id}-mcp-panel`} aria-labelledby={`${id}-mcp-tab`} hidden={tab() !== 'mcp'} inert={tab() !== 'mcp'}><Show when={mcpVisited()}><MCPPanel /></Show></div>
        <div role="tabpanel" id={id + "-plugins-panel"} aria-labelledby={id + "-plugins-tab"} hidden={tab() !== 'plugins'} inert={tab() !== 'plugins'}><Show when={pluginsVisited()}><AgentPluginsPanel /></Show></div>
      </div>
    </div>
  </FlowerExtensionsContext.Provider>;
}
