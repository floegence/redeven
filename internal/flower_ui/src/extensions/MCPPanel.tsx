import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { Button, ConfirmDialog, Dialog, Input, Select, Switch } from '@floegence/floe-webapp-core/ui';
import { Globe, Link, Pencil, Plus, Refresh, Search, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { useFlowerExtensions } from './context';
import { SettingsPill, SettingsSection } from './primitives';
import type { MCPCatalog, MCPServer } from './types';

type Draft = { id: string; revision: number; name: string; transport: 'http' | 'stdio'; url: string; command: string; arguments: string; credentials: string };
const freshDraft = (): Draft => ({ id: '', revision: 0, name: '', transport: 'http', url: '', command: '', arguments: '', credentials: '' });
const serverID = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 48);

export function MCPPanel() {
  const ctx = useFlowerExtensions(); const t = (key: string, params?: Record<string, string | number>) => ctx.i18n.t(key, params);
  const [catalog, setCatalog] = createSignal<MCPCatalog>();
  const [error, setError] = createSignal(''); const [busy, setBusy] = createSignal('');
  const [query, setQuery] = createSignal(''); const [enabledOnly, setEnabledOnly] = createSignal(false);
  const [editing, setEditing] = createSignal<MCPServer | null | undefined>();
  const [draft, setDraft] = createSignal<Draft>(freshDraft()); const [formError, setFormError] = createSignal('');
  const [deleting, setDeleting] = createSignal<MCPServer>(); const [deleteError, setDeleteError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const canManage = () => ctx.canInteract() && ctx.canAdmin() && !busy();
  const filtered = createMemo(() => (catalog()?.servers ?? []).filter(server => (!enabledOnly() || server.enabled) && `${server.name} ${server.id} ${server.url ?? server.command ?? ''}`.toLowerCase().includes(query().trim().toLowerCase())));
  const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
  async function reload() {
    if (!ctx.canInteract() || busy()) return;
    setBusy('load'); setError('');
    try { setCatalog(await ctx.listMCP()); } catch (error) { setError(failure(error)); } finally { setBusy(''); }
  }
  createEffect(on(ctx.canInteract, available => { if (available && !catalog()) void reload(); }));
  async function mutate(server: MCPServer, action: 'check' | 'toggle', enabled = server.enabled) {
    if (!canManage()) return;
    setBusy(server.id); setError(''); setNotice('');
    try {
      setCatalog(action === 'check' ? await ctx.checkMCP({ id: server.id, revision: server.revision }) : await ctx.saveMCP(serverInput(server, enabled)));
      if (action === 'check') setNotice(t('checkSuccess'));
    } catch (error) { setError(failure(error)); } finally { setBusy(''); }
  }
  function serverInput(server: MCPServer, enabled: boolean) {
    return { id: server.id, revision: server.revision, name: server.name, transport: server.transport, url: server.url, command: server.command, args: server.args, enabled };
  }
  function open(server: MCPServer | null) {
    setFormError(''); setEditing(server);
    setDraft(server ? { id: server.id, revision: server.revision, name: server.name, transport: server.transport, url: server.url ?? '', command: server.command ?? '', arguments: (server.args ?? []).join('\n'), credentials: '' } : freshDraft());
  }
  const field = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  async function save() {
    if (!canManage()) return;
    const value = draft(); let credentials: Record<string, string> | undefined;
    if (value.credentials.trim()) {
      try { const parsed: unknown = JSON.parse(value.credentials); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error(); credentials = parsed as Record<string, string>; }
      catch { setFormError(t('invalidCredentials')); return; }
    }
    setBusy('save'); setFormError('');
    try {
      const payload = { id: value.id.trim(), revision: value.revision, name: value.name.trim(), transport: value.transport, enabled: editing()?.enabled ?? true,
        ...(value.transport === 'http' ? { url: value.url.trim(), headers: credentials } : { command: value.command.trim(), args: value.arguments.split('\n').filter(Boolean), env: credentials }) };
      setCatalog(await ctx.saveMCP(payload)); setEditing(undefined); setDraft(freshDraft());
    } catch (error) { setFormError(failure(error)); } finally { setBusy(''); }
  }
  async function remove() {
    const server = deleting(); if (!server || !canManage()) return;
    setBusy(server.id); setDeleteError('');
    try { setCatalog(await ctx.deleteMCP({ id: server.id, revision: server.revision })); setDeleting(undefined); }
    catch (error) { setDeleteError(failure(error)); } finally { setBusy(''); }
  }
  return <>
    <SettingsSection title={t('mcp')} description={t('mcpHint')} actions={<><Button size="icon" variant="ghost" icon={Refresh} aria-label={t('skillsSettings.reload')} title={t('skillsSettings.reload')} loading={busy() === 'load'} disabled={!ctx.canInteract() || Boolean(busy())} onClick={() => void reload()} /><Button size="sm" icon={Plus} disabled={!canManage()} onClick={() => open(null)}>{t('add')}</Button></>}>
      <Show when={error()}><div class="flower-extension-error" role="alert">{error()}<Button size="sm" variant="outline" disabled={Boolean(busy())} onClick={() => void reload()}>{t('common.actions.retry')}</Button></div></Show>
      <Show when={notice()}><p class="flower-extension-notice" role="status">{notice()}</p></Show>
      <Show when={!catalog() && busy()}><p role="status" class="flower-extension-empty">{t('loading')}</p></Show>
      <Show when={catalog()?.servers.length} fallback={<Show when={catalog()}><div class="flower-extension-empty"><span class="flower-extension-empty-icon"><Link class="h-6 w-6" /></span><h3>{t('emptyMcp')}</h3><p>{t('emptyMcpHint')}</p><Button size="sm" variant="outline" icon={Plus} disabled={!canManage()} onClick={() => open(null)}>{t('add')}</Button></div></Show>}>
        <div class="flower-extension-toolbar"><label class="flower-extension-search"><Search class="h-4 w-4" /><Input type="search" aria-label={t('search')} placeholder={t('search')} value={query()} onInput={event => setQuery(event.currentTarget.value)} /></label><Select aria-label={t('skillsSettings.enabled')} value={enabledOnly() ? 'enabled' : 'all'} onChange={value => setEnabledOnly(value === 'enabled')} options={[{ value: 'all', label: t('all') }, { value: 'enabled', label: t('enabledOnly') }]} /></div>
        <div class="flower-extension-list"><For each={filtered()}>{server => <article class="flower-extension-row" data-mcp-server={server.id}>
          <div class="flower-extension-row-main"><span class="flower-extension-icon"><Show when={server.transport === 'http'} fallback={<Terminal class="h-4 w-4" />}><Globe class="h-4 w-4" /></Show></span><div class="flower-extension-identity"><h3>{server.name}</h3><p class="flower-extension-endpoint">{server.transport === 'http' ? server.url : server.command}</p></div><Switch checked={server.enabled} aria-label={`${server.name}: ${t('enabled')}`} disabled={!canManage()} onChange={enabled => void mutate(server, 'toggle', enabled)} /></div>
          <div class="flower-extension-row-body"><div class="flower-extension-meta"><SettingsPill tone={server.enabled ? 'success' : 'default'}>{t(server.enabled ? 'enabled' : 'disabled')}</SettingsPill><span>{t(server.transport === 'http' ? 'remote' : 'local')}</span><span>{ctx.i18n.tn('tools', server.tools.length)}</span></div>
            <div class="flower-extension-row-footer"><span class="flower-extension-updated">{server.checked_at ? t('checked', { time: ctx.i18n.dateTime(server.checked_at) }) : ''}</span><div class="flower-extension-actions"><Button size="sm" variant="ghost" icon={Refresh} disabled={!canManage() || !server.enabled} loading={busy() === server.id} onClick={() => void mutate(server, 'check')}>{t('check')}</Button><Button size="icon" variant="ghost" icon={Pencil} aria-label={`${t('edit')}: ${server.name}`} title={t('edit')} disabled={!canManage()} onClick={() => open(server)} /><Button size="icon" variant="ghost" icon={Trash} aria-label={`${t('common.actions.delete')}: ${server.name}`} title={t('common.actions.delete')} disabled={!canManage()} onClick={() => { setDeleteError(''); setDeleting(server); }} /></div></div>
            <Show when={server.tools.length}><details class="flower-extension-details"><summary>{ctx.i18n.tn('tools', server.tools.length)}</summary><div class="flower-extension-tools"><For each={server.tools}>{tool => <div><code>{tool.name}</code><p>{tool.description}</p></div>}</For></div></details></Show>
          </div>
        </article>}</For></div>
        <Show when={!filtered().length}><div class="flower-extension-empty"><h3>{t('noResults')}</h3><Button variant="ghost" onClick={() => { setQuery(''); setEnabledOnly(false); }}>{t('clear')}</Button></div></Show>
      </Show>
    </SettingsSection>
    <Dialog open={editing() !== undefined} onOpenChange={value => { if (!value && !busy()) { setEditing(undefined); setDraft(freshDraft()); } }} title={t(editing() ? 'edit' : 'add')} bodyDescription={t('saveHint')} class="flower-extension-dialog w-[min(36rem,94vw)]" footer={<><Button variant="outline" disabled={Boolean(busy())} onClick={() => { setEditing(undefined); setDraft(freshDraft()); }}>{t('common.actions.cancel')}</Button><Button loading={busy() === 'save'} disabled={!canManage() || !draft().name.trim() || !draft().id.trim() || !(draft().transport === 'http' ? draft().url.trim() : draft().command.trim())} onClick={() => void save()}>{t('save')}</Button></>}>
      <Show when={formError()}><p class="flower-extension-error" role="alert">{formError()}</p></Show>
      <fieldset class="flower-extension-form" disabled={!ctx.canAdmin() || !ctx.canInteract() || Boolean(busy())}>
        <label><span>{t('name')}</span><Input value={draft().name} onInput={event => { const name = event.currentTarget.value; setDraft(previous => ({ ...previous, name, id: !editing() && (!previous.id || previous.id === serverID(previous.name)) ? serverID(name) : previous.id })); }} /></label>
        <label><span>{t('identifier')}</span><Input value={draft().id} disabled={Boolean(editing())} onInput={event => field('id', event.currentTarget.value)} /></label>
        <label><span>{t('transport')}</span><Select value={draft().transport} onChange={value => { if (value === 'stdio' || value === 'http') setDraft(previous => ({ ...previous, transport: value, credentials: '' })); }} options={[{ value: 'http', label: t('remote') }, { value: 'stdio', label: t('local') }]} /></label>
        <Show when={draft().transport === 'http'} fallback={<><label><span>{t('command')}</span><Input value={draft().command} onInput={event => field('command', event.currentTarget.value)} /></label><label><span>{t('arguments')}</span><textarea class="flower-extension-control" rows={3} value={draft().arguments} onInput={event => field('arguments', event.currentTarget.value)} spellcheck={false} /><small>{t('argumentsHint')}</small></label></>}><label><span>{t('endpoint')}</span><Input type="url" value={draft().url} onInput={event => field('url', event.currentTarget.value)} /></label></Show>
        <details class="flower-extension-details"><summary>{t('advanced')}</summary><label><span>{t(draft().transport === 'http' ? 'headers' : 'environment')}</span><textarea class="flower-extension-control" aria-label={t(draft().transport === 'http' ? 'headers' : 'environment')} rows={3} value={draft().credentials} onInput={event => field('credentials', event.currentTarget.value)} autocomplete="off" spellcheck={false} /><small>{t('credentialsHint')}</small><Show when={editing()}>{server => <small>{t('stored', { keys: (draft().transport === 'http' ? server().header_keys : server().env_keys).join(', ') || '—' })}</small>}</Show></label></details>
      </fieldset>
    </Dialog>
    <ConfirmDialog open={Boolean(deleting())} onOpenChange={open => { if (!open && !busy()) setDeleting(undefined); }} title={t('deleteTitle')} confirmText={t('common.actions.delete')} cancelText={t('common.actions.cancel')} variant="destructive" loading={Boolean(busy())} onConfirm={() => void remove()}><p>{t('deleteHint', { name: deleting()?.name ?? '' })}</p><Show when={deleteError()}><p role="alert" class="flower-extension-error">{deleteError()}</p></Show></ConfirmDialog>
  </>;
}
