import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { Button, Dialog, Input, Select } from '@floegence/floe-webapp-core/ui';
import { Package, Trash } from '@floegence/floe-webapp-core/icons';
import { retainEqualValue } from '../presentationIdentity';
import { useFlowerExtensions } from './context';
import { ExtensionIcon } from './ExtensionIcon';
import type { AgentPluginCatalog, AgentPluginCatalogSource, AgentPluginSource } from './agentPluginTypes';

export function AgentPluginCatalogView(props: { sources: AgentPluginCatalogSource[]; selectedSource: string; onSelectSource: (id: string) => void; query: string; refresh: number; canManage: boolean; onInstall: (source: AgentPluginSource) => void; onClear: () => void }) {
  const ctx = useFlowerExtensions(); const t = ctx.i18n.t;
  const [catalog, setCatalog] = createSignal<AgentPluginCatalog>();
  const [loading, setLoading] = createSignal(false); const [failed, setFailed] = createSignal(false);
  const source = createMemo(() => props.sources.find(item => item.id === props.selectedSource) ?? props.sources[0]);
  const entries = createMemo(() => catalog()?.plugins.filter(item => [item.id, item.display?.name, item.display?.description, item.display?.author, item.source.repository].join(' ').toLowerCase().includes(props.query.trim().toLowerCase())) ?? []);
  let generation = 0;
  let catalogOwner: string | undefined;
  onCleanup(() => { generation++; });
  async function reload() {
    const current = ++generation; const id = source()?.id;
    const owner = ctx.canInteract() && id ? JSON.stringify([id, source()?.url]) : undefined;
    if (owner !== catalogOwner) { setCatalog(undefined); catalogOwner = owner; }
    setFailed(false); setLoading(false);
    if (!id || !ctx.canInteract()) return;
    setLoading(true);
    try { const next = await ctx.plugins.catalog(id); if (current === generation) setCatalog(previous => retainEqualValue(previous, next)); }
    catch { if (current === generation) setFailed(true); }
    finally { if (current === generation) setLoading(false); }
  }
  createEffect(on(() => [source()?.id, source()?.url, props.refresh, ctx.canInteract()] as const, () => { void reload(); }));
  return <>
    <Show when={props.sources.length > 1}><div class="flower-plugin-catalog-picker"><Select aria-label={t('plugins.catalog')} value={source()?.id ?? ''} options={props.sources.map(item => ({ value: item.id, label: item.name }))} onChange={props.onSelectSource} /></div></Show>
    <Show when={loading()}><span role="status" class="sr-only">{t('loading')}</span><Show when={!catalog()}><div class="flower-extension-skeleton" aria-hidden="true"><span /><span /><span /></div></Show></Show>
    <Show when={failed()}><div class="flower-extension-empty"><p role="alert">{t('plugins.catalogFailed')}</p><Button size="sm" variant="outline" disabled={!ctx.canInteract()} onClick={() => void reload()}>{t('common.actions.retry')}</Button></div></Show>
    <Show when={catalog() && !entries().length}><div class="flower-plugin-empty"><span class="flower-plugin-empty-icon"><Package class="h-6 w-6" aria-hidden="true" /></span><h3>{t(catalog()!.plugins.length ? 'plugins.noResults' : 'plugins.catalogEmpty')}</h3><Show when={catalog()!.plugins.length}><Button size="sm" variant="outline" onClick={props.onClear}>{t('clear')}</Button></Show></div></Show>
    <div class="flower-plugin-grid"><For each={entries()}>{item => <article class="flower-plugin-card flower-plugin-catalog-card">
      <div class="flower-plugin-card-top"><ExtensionIcon identity={(source()?.id ?? '') + ':' + item.id} name={item.display?.name || item.id} /><Show when={item.display?.author}><span class="flower-plugin-catalog-author">{item.display?.author}</span></Show></div>
      <h3>{item.display?.name || item.id}</h3><Show when={item.display?.description}><p>{item.display?.description}</p></Show>
      <div class="flower-plugin-card-footer"><span title={item.source.repository}>{item.source.repository}</span><Button size="sm" variant="outline" disabled={!props.canManage} onClick={() => props.onInstall(item.source)}>{t('plugins.install')}</Button></div>
    </article>}</For></div>
  </>;
}

export function AgentPluginSourcesDialog(props: { open: boolean; onClose: () => void; sources: AgentPluginCatalogSource[]; revision: number; onChanged: () => Promise<void> }) {
  const ctx = useFlowerExtensions(); const t = ctx.i18n.t;
  const [url, setURL] = createSignal(''); const [busy, setBusy] = createSignal(false); const [failed, setFailed] = createSignal(false);
  const canManage = () => ctx.canInteract() && ctx.canAdmin() && !busy();
  async function change(action: () => Promise<unknown>, added = false) {
    if (!canManage()) return;
    setBusy(true); setFailed(false);
    try { await action(); await props.onChanged(); if (added) setURL(''); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <Dialog open={props.open} onOpenChange={open => { if (!open && !busy()) props.onClose(); }} title={t('plugins.manageSources')} class="flower-extension-dialog w-[min(36rem,94vw)]">
    <Show when={failed()}><p role="alert" class="flower-extension-error">{t('plugins.failed')}</p></Show>
    <div class="flower-plugin-source-list"><For each={props.sources}>{item => <div class="flower-plugin-source-row"><div><strong>{item.name}</strong><p>{item.url}</p><Show when={item.managed}><small>{t('plugins.managedSource')}</small></Show></div><Show when={!item.managed}><Button size="icon" variant="ghost" icon={Trash} aria-label={t('plugins.removeSource') + ': ' + item.name} disabled={!canManage()} onClick={() => void change(() => ctx.plugins.removeSource({ id: item.id, revision: props.revision }))} /></Show></div>}</For></div>
    <Show when={ctx.canAdmin()}><form class="flower-plugin-source-form" onSubmit={event => { event.preventDefault(); if (url().trim()) void change(() => ctx.plugins.addSource({ url: url().trim(), revision: props.revision }), true); }}><label><span class="flower-extension-label">{t('plugins.catalogURL')}</span><Input type="url" aria-label={t('plugins.catalogURL')} value={url()} onInput={event => setURL(event.currentTarget.value)} disabled={busy()} /></label><Button type="submit" size="sm" disabled={!canManage() || !url().trim()} loading={busy()}>{t('plugins.addSource')}</Button></form></Show>
  </Dialog>;
}
