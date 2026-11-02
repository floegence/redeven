import { For, Show, createSignal } from 'solid-js';
import { Button, Dropdown } from '@floegence/floe-webapp-core/ui';
import { MoreHorizontal, Plus, Refresh } from '@floegence/floe-webapp-core/icons';
import { type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import type { TerminalViewCatalog } from '../services/terminalViewCatalog';
import { useI18n } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';

function LayoutPreview(props: { layout: SplitWorkspaceLayout }) {
  return <Show when={props.layout.type === 'split' ? props.layout : undefined} keyed fallback={<span class="terminal-view-preview-pane" />}>
    {node => <div class="terminal-view-preview-split" style={{ 'flex-direction': node.axis === 'y' ? 'column' : 'row' }}>
      <div style={{ flex: node.ratio }}><LayoutPreview layout={node.first} /></div>
      <div style={{ flex: 1 - node.ratio }}><LayoutPreview layout={node.second} /></div>
    </div>}
  </Show>;
}
export function TerminalViewList(props: {
  catalog: TerminalViewCatalog;
  activeId: string | null;
  query: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const i18n = useI18n();
  const [editing, setEditing] = createSignal<string | null>(null);
  const [name, setName] = createSignal('');
  const submit = () => { if (editing() && name().trim()) { props.onRename(editing()!, name().trim()); setEditing(null); } };
  const visible = () => props.catalog.views().filter(view => view.name.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase()));
  return <section class="terminal-view-list" aria-label={i18n.t('terminalWorkspace.views')} data-terminal-view-list>
    <div class="terminal-view-list-heading">
      <span class="flex items-center">{i18n.t('terminalWorkspace.views')}<Show when={props.catalog.pending() && !props.catalog.error()}><span class="ml-2" role="status" title={i18n.t('terminalWorkspace.savingViews')} aria-label={i18n.t('terminalWorkspace.savingViews')}><Refresh class="h-3 w-3 animate-spin motion-reduce:animate-none" /></span></Show></span>
      <Button variant="ghost" size="sm" class="h-6 w-6 p-0" disabled={props.disabled || !props.catalog.ready()} onClick={props.onNew} title={i18n.t('terminalWorkspace.newView')} aria-label={i18n.t('terminalWorkspace.newView')}><Plus class="h-3.5 w-3.5" /></Button>
    </div>
    <Show when={props.catalog.error()}>
      <div role="alert" class="terminal-view-error"><span>{i18n.t('terminalWorkspace.viewSaveError')}</span><Button variant="ghost" size="sm" disabled={props.catalog.saving()} onClick={() => void props.catalog.reload()}>{i18n.t('terminalWorkspace.reloadViews')}</Button></div>
    </Show>
    <Show when={props.catalog.ready() && !props.catalog.views().length}>
      <p class="terminal-view-empty">{i18n.t('terminalWorkspace.viewsEmpty')}</p>
    </Show>
    <div class="terminal-view-list-items">
      <For each={visible().map(view => view.id)}>{id => { const view = () => props.catalog.views().find(item => item.id === id)!; return <div class="terminal-view-row" classList={{ 'terminal-view-selected': props.activeId === id }} data-terminal-view-row={id}>
        <button type="button" class="terminal-view-select" aria-pressed={props.activeId === id} onClick={() => props.onSelect(id)} title={view().name} data-terminal-view-id={id}>
          <span class="terminal-view-preview" aria-hidden="true"><LayoutPreview layout={view().layout} /></span>
          <span class="truncate">{view().name}</span>
        </button>
        <Dropdown align="end" disabled={!props.catalog.ready()} triggerAriaLabel={i18n.t('terminalWorkspace.viewActions', { name: view().name })}
          triggerClass="terminal-view-actions" trigger={<MoreHorizontal class="h-3.5 w-3.5" />}
          items={[{ id: 'rename', label: i18n.t('terminalWorkspace.renameView') }, { id: 'delete', label: i18n.t('terminalWorkspace.deleteView') }]}
          onSelect={action => { if (action === 'rename') { setName(view().name); setEditing(id); } else if (action === 'delete') props.onDelete(id); }} />
      </div>; }}</For>
    </div>
    <Show when={props.catalog.saving()}><span class="sr-only" role="status">{i18n.t('terminalWorkspace.savingViews')}</span></Show>
    <Dialog open={editing() !== null} onOpenChange={open => { if (!open) setEditing(null); }} title={i18n.t('terminalWorkspace.renameView')}
      footer={<div class="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(null)}>{i18n.t('common.actions.cancel')}</Button><Button size="sm" onClick={submit} disabled={!name().trim()}>{i18n.t('common.actions.confirm')}</Button></div>}>
      <label class="block text-xs">{i18n.t('terminalWorkspace.viewLabel')}<input data-floe-control="input" class="mt-2 h-9 w-full rounded-md border border-border bg-background px-3" value={name()} maxlength={64} autofocus onInput={event => setName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') submit(); }} /></label>
    </Dialog>
  </section>;
}
