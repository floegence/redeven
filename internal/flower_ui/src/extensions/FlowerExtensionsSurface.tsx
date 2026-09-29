import { For, Show, createSignal, createUniqueId } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronLeft, Wand, Workflow } from '@floegence/floe-webapp-core/icons';
import { FlowerExtensionsContext, type ExtensionI18n } from './context';
import { SkillsSection } from './SkillsSection';
import { MCPPanel } from './MCPPanel';
import type { FlowerExtensionsAdapter } from './types';
import './extensions.css';

export function FlowerExtensionsSurface(props: { adapter: FlowerExtensionsAdapter; i18n: ExtensionI18n; onBack: () => void }) {
  const [tab, setTab] = createSignal<'skills' | 'mcp'>('skills');
  const [mcpVisited, setMCPVisited] = createSignal(false);
  const id = createUniqueId();
  const select = (value: 'skills' | 'mcp') => { if (value === 'mcp') setMCPVisited(true); setTab(value); };
  return <FlowerExtensionsContext.Provider value={{ ...props.adapter, i18n: { t: (key, params) => props.i18n.t(key, params), tn: (key, count) => props.i18n.tn(key, count), dateTime: timestamp => props.i18n.dateTime(timestamp) } }}>
    <div class="flower-extensions" data-testid="flower-extensions">
      <header class="flower-extensions-header">
        <Button size="icon" variant="ghost" icon={ChevronLeft} aria-label={props.i18n.t('back')} title={props.i18n.t('back')} onClick={props.onBack} />
        <h1>{props.i18n.t('title')}</h1>
        <div class="flower-extensions-tabs" role="tablist" aria-label={props.i18n.t('title')}>
          <For each={['skills', 'mcp'] as const}>{value => <button type="button" role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-${value}-panel`} aria-selected={tab() === value} tabIndex={tab() === value ? 0 : -1}
            onClick={() => select(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'skills' : event.key === 'End' ? 'mcp' : value === 'skills' ? 'mcp' : 'skills'; select(next); document.getElementById(`${id}-${next}-tab`)?.focus(); } }}>
            <Show when={value === 'skills'} fallback={<Workflow class="h-4 w-4" aria-hidden="true" />}><Wand class="h-4 w-4" aria-hidden="true" /></Show><span>{props.i18n.t(value)}</span>
          </button>}</For>
        </div>
      </header>
      <div class="flower-extensions-content">
        <div role="tabpanel" id={`${id}-skills-panel`} aria-labelledby={`${id}-skills-tab`} hidden={tab() !== 'skills'} inert={tab() !== 'skills'}><SkillsSection /></div>
        <div role="tabpanel" id={`${id}-mcp-panel`} aria-labelledby={`${id}-mcp-tab`} hidden={tab() !== 'mcp'} inert={tab() !== 'mcp'}><Show when={mcpVisited()}><MCPPanel /></Show></div>
      </div>
    </div>
  </FlowerExtensionsContext.Provider>;
}
