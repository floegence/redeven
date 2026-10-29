import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { Button, ConfirmDialog, Dialog, Input, Select, Switch } from '@floegence/floe-webapp-core/ui';
import { Plus, Refresh, Trash, Search, Package } from '@floegence/floe-webapp-core/icons';
import { useFlowerExtensions } from './context';
import { SettingsList, SettingsSection, SettingRow } from './primitives';
import { AgentPluginCard, AgentPluginDetails, pluginComponentKeys, pluginComponentName } from './AgentPluginDetails';
import type { AgentPluginCatalog, AgentPluginInstall, AgentPluginListing, AgentPluginOperation, AgentPluginSource } from './agentPluginTypes';

const componentKeys = pluginComponentKeys;
export function AgentPluginsPanel() {
  const ctx = useFlowerExtensions(); const api = ctx.plugins;
  const t = (key: string, params?: Record<string, string | number>) => ctx.i18n.t(key, params);
  const [listing, setListing] = createSignal<AgentPluginListing>();
  const [busy, setBusy] = createSignal(''); const [error, setError] = createSignal(''); const [notice, setNotice] = createSignal('');
  const [query, setQuery] = createSignal(''); const [view, setView] = createSignal<'installed' | 'discover'>('installed');
  const [sourceURL, setSourceURL] = createSignal(''); const [catalog, setCatalog] = createSignal<AgentPluginCatalog>();
  const [sourceID, setSourceID] = createSignal(''); const [installing, setInstalling] = createSignal(false);
  const [updating, setUpdating] = createSignal<AgentPluginInstall>();
  const [source, setSource] = createSignal<AgentPluginSource>({ type: 'github', repository: '', ref: '', path: '.' });
  const [operation, setOperation] = createSignal<AgentPluginOperation>(); const [selected, setSelected] = createSignal<string[]>([]);
  const [enable, setEnable] = createSignal(false); const [formError, setFormError] = createSignal('');
  const [deleting, setDeleting] = createSignal<AgentPluginInstall>(); const [deleteData, setDeleteData] = createSignal(false);
  const [credential, setCredential] = createSignal<{ install: AgentPluginInstall; key: string }>(); const [credentialFields, setCredentialFields] = createSignal([{ name: '', value: '' }]);
  const [detail, setDetail] = createSignal('');
  const detailItem = createMemo(() => listing()?.items.find(item => item.id === detail()));
  let disposed = false; let previewGeneration = 0; let polling: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { disposed = true; previewGeneration++; clearTimeout(polling); });
  const canManage = () => ctx.canInteract() && ctx.canAdmin() && !busy();
  const items = createMemo(() => (listing()?.items ?? []).filter(item => (item.package.manifest.name + ' ' + (item.package.manifest.description ?? '')).toLowerCase().includes(query().toLowerCase())));
  const fail = (value: unknown) => {
    const code = value instanceof Error ? value.message : String(value);
    const known = ['configuration_changed', 'plugin_in_use', 'package_changed', 'source_already_installed', 'process_permission_required', 'connection_failed', 'source_path_denied', 'component_unavailable'];
    return known.includes(code) ? t('plugins.error.' + code) : t('plugins.failed');
  };
  async function load() { const result = await api.list(); if (!disposed) setListing(result); }
  async function run(key: string, action: () => Promise<unknown>) {
    if (busy() || !ctx.canInteract()) return;
    setBusy(key); setError(''); setNotice('');
    try { await action(); await load(); if (key !== 'load' && key !== 'catalog') ctx.catalogChanged?.(); } catch (e) { setError(fail(e)); } finally { setBusy(''); }
  }
  createEffect(on(ctx.canInteract, available => { if (available && !listing()) void run('load', load); }));
  createEffect(on(() => ctx.selectedPlugin?.(), selection => { if (selection?.id) { setDetail(selection.id); setView('installed'); setQuery(''); } }));
  const preview = (op: AgentPluginOperation, generation = ++previewGeneration) => {
    if (disposed || generation !== previewGeneration) return;
    clearTimeout(polling);
    setSource(op.source); setOperation(op); setUpdating(listing()?.items.find(item => item.id === op.install_id)); setInstalling(true);
    const previous = listing()?.items.find(item => item.id === op.install_id);
    setSelected(op.package ? componentKeys(op.package).filter(key => previous ? previous.components[key]?.enabled : true) : []);
    setEnable(previous?.enabled ?? false);
    if (op.status === 'failed' || op.status === 'expired') setFormError(t('plugins.prepareFailed'));
    if (op.status === 'preparing') polling = setTimeout(() => { void api.operation(op.id).then(next => { if (!disposed && generation === previewGeneration) preview(next, generation); }).catch(e => { if (!disposed && generation === previewGeneration) setFormError(fail(e)); }); }, 1500);
  };
  function newInstall(next?: AgentPluginSource) { previewGeneration++; clearTimeout(polling); setUpdating(undefined); setSource(next ?? { type: 'github', repository: '', ref: '', path: '.' }); setOperation(undefined); setFormError(''); setEnable(false); setInstalling(true); }
  async function prepare(item?: AgentPluginInstall) {
    if (!canManage()) return;
    const target = item ?? updating();
    setBusy('prepare'); setFormError(''); setError('');
    if (target) { setUpdating(target); setSource(target.source); setInstalling(true); setOperation(undefined); }
    try { preview(await api.prepare({ request_id: crypto.randomUUID(), source: target?.source ?? source(), install_id: target?.id, revision: target?.revision ?? 0 })); await load(); }
    catch (e) { setFormError(fail(e)); } finally { setBusy(''); }
  }
  async function commit() {
    const op = operation(); if (!canManage() || !op?.digest || op.status !== 'ready') return;
    setBusy('commit'); setFormError('');
    try { const installed = await api.commit({ operation_id: op.id, digest: op.digest, enabled: enable(), components: selected() }); setInstalling(false); setOperation(undefined); setView('installed'); setDetail(installed.id); setNotice(t('plugins.installedNotice')); await load(); ctx.catalogChanged?.(); }
    catch (e) { setFormError(fail(e)); } finally { setBusy(''); }
  }
  function change(item: AgentPluginInstall, enabled: boolean, component?: string) { if (canManage()) void run(item.id, () => api.change({ id: item.id, revision: item.revision, enabled, component })); }
  async function saveCredentials(clear = false) {
    const target = credential(); if (!target || !canManage()) return;
    const fields = clear ? [] : credentialFields().filter(field => field.name || field.value);
    if (fields.some(field => !field.name.trim()) || new Set(fields.map(field => field.name.trim().toLowerCase())).size !== fields.length) { setFormError(t('invalidCredentials')); return; }
    const parsed = Object.fromEntries(fields.map(field => [field.name.trim(), field.value]));
    setBusy('credentials'); setFormError('');
    try { await api.credentials({ id: target.install.id, revision: target.install.revision, component: target.key, values: parsed }); setCredential(undefined); setCredentialFields([{ name: '', value: '' }]); await load(); ctx.catalogChanged?.(); }
    catch (e) { setFormError(fail(e)); } finally { setBusy(''); }
  }
  const field = (key: keyof AgentPluginSource, value: string) => setSource(previous => ({ ...previous, [key]: value }));
  const closeInstall = () => { if (!busy()) { previewGeneration++; clearTimeout(polling); setInstalling(false); } };
  return <>
    <SettingsSection title={t('plugins')} filters={<><div class="flower-plugin-segments" role="group" aria-label={t('plugins.view')}><For each={['installed', 'discover'] as const}>{value => <button type="button" aria-pressed={view() === value} onClick={() => setView(value)}>{t('plugins.' + value)}<Show when={value === 'installed' && listing()?.items.length}><span>{listing()?.items.length}</span></Show></button>}</For></div><Show when={view() === 'installed' ? !!listing()?.items.length : !!catalog()?.plugins.length}><label class="flower-extension-search"><Search class="h-4 w-4" aria-hidden="true" /><Input type="search" aria-label={t('plugins.search')} placeholder={t('plugins.search')} value={query()} onInput={event => setQuery(event.currentTarget.value)} /></label></Show></>} actions={<><Button size="icon" variant="ghost" icon={Refresh} aria-label={t('skillsSettings.reload')} title={t('skillsSettings.reload')} loading={busy() === 'load'} disabled={!ctx.canInteract() || !!busy()} onClick={() => void run('load', load)} /><Show when={view() === 'discover' || !!listing()?.items.length}><Button size="sm" icon={Plus} disabled={!canManage()} onClick={() => newInstall()}>{t('plugins.install')}</Button></Show></>}>
      <Show when={error()}><p role="alert" class="flower-extension-error">{error()}</p></Show>
      <Show when={notice()}><p role="status" class="flower-extension-notice">{notice()}</p></Show>
      <Show when={busy()}><p role="status" class="flower-extension-notice">{t(busy() === 'prepare' ? 'plugins.preparing' : 'loading')}</p></Show>

      <Show when={view() === 'installed'} fallback={<>
        <div class="flower-plugin-source-form"><label><span class="flower-extension-label">{t('plugins.catalogURL')}</span><Input type="url" aria-label={t('plugins.catalogURL')} placeholder="https://example.com/catalog.json" value={sourceURL()} onInput={event => setSourceURL(event.currentTarget.value)} /></label><Button size="sm" disabled={!canManage() || !sourceURL().trim()} onClick={() => void run('source', async () => { await api.addSource({ url: sourceURL().trim(), revision: listing()?.revision ?? 0 }); setSourceURL(''); })}>{t('plugins.addSource')}</Button></div>
        <SettingsList><For each={listing()?.sources}>{item => <SettingRow icon={undefined} metadata={undefined} children={undefined} title={item.name} description={item.url} control={<><Button size="sm" variant="outline" disabled={!ctx.canInteract() || !!busy()} onClick={() => void run('catalog', async () => { const next = await api.catalog(item.id); setCatalog(next); setSourceID(item.id); })}>{t('plugins.browse')}</Button><Button size="icon" variant="ghost" icon={Trash} aria-label={t('plugins.removeSource') + ': ' + item.name} disabled={!canManage()} onClick={() => void run('source', async () => { await api.removeSource({ id: item.id, revision: listing()?.revision ?? 0 }); if (sourceID() === item.id) setCatalog(undefined); })} /></>} />}</For></SettingsList>
        <Show when={catalog()}>{value => <SettingsList><For each={value().plugins.filter(item => item.id.toLowerCase().includes(query().toLowerCase()))}>{item => <SettingRow icon={undefined} metadata={undefined} children={undefined} title={item.id} description={item.source.repository ?? ''} control={<Button size="sm" disabled={!canManage()} onClick={() => newInstall(item.source)}>{t('plugins.install')}</Button>} />}</For></SettingsList>}</Show>
      </>}>
        <For each={listing()?.operations ?? []}>{op => <div class="flower-plugin-recovery"><span>{t('plugins.pending')} · {op.package?.manifest.name ?? op.source.repository ?? op.source.directory}</span><Button size="sm" variant="outline" disabled={!canManage()} onClick={() => { setFormError(''); preview(op); }}>{t('plugins.resume')}</Button></div>}</For>
        <Show when={listing() && !items().length}><div class="flower-plugin-empty"><span class="flower-plugin-empty-icon"><Package class="h-6 w-6" aria-hidden="true" /></span><h3>{t(listing()?.items.length ? 'plugins.noResults' : 'plugins.emptyTitle')}</h3><Show when={listing()?.items.length} fallback={<Button size="sm" icon={Plus} disabled={!canManage()} onClick={() => newInstall()}>{t('plugins.install')}</Button>}><Button size="sm" variant="outline" onClick={() => setQuery('')}>{t('clear')}</Button></Show></div></Show>
        <div class="flower-plugin-grid"><For each={items()}>{item => <AgentPluginCard item={item} onOpen={() => setDetail(item.id)} />}</For></div>
      </Show>
    </SettingsSection>
    <Dialog open={!!detailItem() && !installing() && !credential() && !deleting()} onOpenChange={open => { if (!open && !busy()) setDetail(''); }} title={detailItem()?.package.manifest.name ?? ''} class="flower-extension-dialog flower-plugin-detail-dialog w-[min(40rem,94vw)]">
      <Show when={error()}><p role="alert" class="flower-extension-error">{error()}</p></Show><Show when={notice()}><p role="status" class="flower-extension-notice">{notice()}</p></Show>
      <Show when={detailItem()}>{item => <AgentPluginDetails item={item()} canManage={!!canManage()} busy={!!busy()} onChange={(enabled, key) => change(item(), enabled, key)} onAutoCheck={auto_check => { if (canManage()) void run(item().id, () => api.change({ id: item().id, revision: item().revision, auto_check })); }} onCheck={key => { if (canManage()) void run(key, async () => { await api.check({ id: item().id, revision: item().revision, component: key }); setNotice(t('checkSuccess')); }); }} onCredentials={key => { setCredential({ install: item(), key }); setCredentialFields([{ name: '', value: '' }]); setFormError(''); }} onUpdate={() => void prepare(item())} onRemove={() => { setDeleteData(false); setDeleting(item()); }} />}</Show>
    </Dialog>
    <Dialog open={installing()} onOpenChange={value => { if (!value) closeInstall(); }} title={t(operation()?.kind === 'update' ? 'plugins.update' : 'plugins.install')} bodyDescription={t('plugins.previewHint')} class="flower-extension-dialog w-[min(42rem,94vw)]" footer={<><Button variant="outline" disabled={!!busy()} onClick={closeInstall}>{t('common.actions.cancel')}</Button><Show when={operation()?.status === 'ready'} fallback={<Button disabled={!canManage() || operation()?.status === 'preparing'} loading={busy() === 'prepare'} onClick={() => void prepare()}>{t('plugins.preview')}</Button>}><Button disabled={!canManage()} loading={busy() === 'commit'} onClick={() => void commit()}>{t(operation()?.kind === 'update' ? 'plugins.applyUpdate' : 'plugins.install')}</Button></Show></>}>
      <Show when={formError()}><p role="alert" class="flower-extension-error">{formError()}</p></Show>
      <Show when={operation()?.status === 'preparing' || busy() === 'prepare'}><p role="status">{t('plugins.preparing')}</p></Show>
      <Show when={operation()?.package} fallback={<fieldset class="flower-extension-form" disabled={!!busy()}>
        <label><span>{t('plugins.source')}</span><Select value={source().type} options={[{ value: 'github', label: 'GitHub' }, { value: 'local', label: t('plugins.local') }]} onChange={value => setSource(value === 'local' ? { type: 'local', directory: '' } : { type: 'github', repository: '', path: '.' })} /></label>
        <Show when={source().type === 'github'} fallback={<label><span>{t('plugins.directory')}</span><Input value={source().directory ?? ''} onInput={event => field('directory', event.currentTarget.value)} /></label>}>
          <label><span>{t('plugins.repository')}</span><Input placeholder="owner/repository" value={source().repository ?? ''} onInput={event => field('repository', event.currentTarget.value)} /></label><label><span>{t('plugins.ref')}</span><Input value={source().ref ?? ''} onInput={event => field('ref', event.currentTarget.value)} /></label><label><span>{t('plugins.path')}</span><Input value={source().path ?? '.'} onInput={event => field('path', event.currentTarget.value)} /></label>
        </Show>
      </fieldset>}>{pkg => <div class="flower-plugin-preview">
        <h3>{pkg().manifest.name} {pkg().manifest.version}</h3><p>{pkg().manifest.description}</p><p class="flower-plugin-description">{operation()?.source.repository ?? operation()?.source.directory}</p>
        <Show when={operation()?.previous}>{previous => <p>{t('plugins.versionChange', { before: previous().manifest.version ?? '—', after: pkg().manifest.version ?? '—' })}</p>}</Show>
        <For each={componentKeys(pkg())}>{key => <div class="flower-plugin-component"><label class="flower-plugin-component-title"><input type="checkbox" aria-label={key} checked={selected().includes(key)} disabled={!canManage()} onChange={event => setSelected(current => event.currentTarget.checked ? [...current, key] : current.filter(value => value !== key))} /><span>{pluginComponentName(key)}</span><small>{t(key.startsWith('skill:') ? 'skills' : 'mcp')}</small></label><Show when={key.startsWith('mcp:')} fallback={<p>{pkg().skills.find(skill => skill.key === key)?.description}</p>}><code>{pkg().mcp[key.slice(4)]?.url ?? [pkg().mcp[key.slice(4)]?.command, ...(pkg().mcp[key.slice(4)]?.args ?? [])].join(' ')}</code><details class="flower-plugin-disclosure"><summary>{t('plugins.connectionDetails')}</summary><pre>{JSON.stringify(pkg().mcp[key.slice(4)], null, 2)}</pre></details><Show when={operation()?.previous && JSON.stringify(operation()?.previous?.mcp[key.slice(4)]) !== JSON.stringify(pkg().mcp[key.slice(4)])}><p class="flower-extension-notice">{t('plugins.connectionChanged')}</p></Show></Show></div>}</For>
        <Show when={operation()?.previous}>{previous => <For each={componentKeys(previous()).filter(key => !componentKeys(pkg()).includes(key))}>{key => <p>{t('plugins.removed', { name: key })}</p>}</For>}</Show>
        <Show when={pkg().diagnostics.length}><p>{t('plugins.partial')}</p><For each={pkg().diagnostics}>{entry => <code>{entry.component}: {entry.code} {entry.detail}</code>}</For></Show>
        <label class="flower-plugin-component-title"><Switch checked={enable()} disabled={!canManage()} onChange={setEnable} /><span>{t('plugins.enableAfterInstall')}</span></label><p class="flower-plugin-description">{t('plugins.executionHint')}</p>
      </div>}</Show>
    </Dialog>
    <Dialog open={!!credential()} onOpenChange={open => { if (!open && !busy()) { setCredential(undefined); setCredentialFields([{ name: '', value: '' }]); } }} title={t('plugins.credentials')} bodyDescription={t('plugins.credentialHint')} class="flower-extension-dialog w-[min(36rem,94vw)]" footer={<><Button variant="ghost" disabled={!canManage()} onClick={() => void saveCredentials(true)}>{t('plugins.clearCredentials')}</Button><Button loading={busy() === 'credentials'} disabled={!canManage() || !credentialFields().some(field => field.name.trim())} onClick={() => void saveCredentials()}>{t('plugins.replaceCredentials')}</Button></>}>
      <Show when={formError()}><p role="alert" class="flower-extension-error">{formError()}</p></Show>
      <div class="flower-plugin-credentials"><For each={credentialFields()}>{(field, index) => <div class="flower-plugin-credential-row"><label><span>{t('plugins.credentialName')}</span><Input value={field.name} onInput={event => { field.name = event.currentTarget.value; setCredentialFields(current => [...current]); }} autocomplete="off" spellcheck={false} /></label><label><span>{t('plugins.credentialValue')}</span><Input type="password" value={field.value} onInput={event => { field.value = event.currentTarget.value; setCredentialFields(current => [...current]); }} autocomplete="new-password" /></label><Button size="icon" variant="ghost" icon={Trash} aria-label={t('plugins.removeCredential') + ' ' + (index() + 1)} disabled={!canManage()} onClick={() => setCredentialFields(current => current.filter(entry => entry !== field))} /></div>}</For><Button size="sm" variant="ghost" icon={Plus} disabled={!canManage() || credentialFields().length >= 64} onClick={() => setCredentialFields(current => [...current, { name: '', value: '' }])}>{t('plugins.addCredential')}</Button></div>
    </Dialog>
    <ConfirmDialog open={!!deleting()} onOpenChange={open => { if (!open && !busy()) setDeleting(undefined); }} title={t('plugins.uninstall')} confirmText={t('plugins.uninstall')} cancelText={t('common.actions.cancel')} loading={!!busy()} variant="destructive" onConfirm={() => { const item = deleting(); if (item && canManage()) void run('remove', async () => { await api.remove({ id: item.id, revision: item.revision, delete_data: deleteData() }); setDeleting(undefined); }); }}><p>{t('plugins.uninstallHint', { name: deleting()?.package.manifest.name ?? '' })}</p><label class="flower-plugin-component-title"><input type="checkbox" checked={deleteData()} onChange={event => setDeleteData(event.currentTarget.checked)} /><span>{t('plugins.deleteData')}</span></label><Show when={error()}><p role="alert" class="flower-extension-error">{error()}</p></Show></ConfirmDialog>
  </>;
}
