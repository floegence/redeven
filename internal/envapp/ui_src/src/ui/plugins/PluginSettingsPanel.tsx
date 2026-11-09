import { SettingsSelect as Select } from '../pages/settings/SettingsSelect';
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useSettingsPanelHost } from '../../../../../settings_ui/src/SettingsPanelHost';
import { useI18n } from '../i18n';
import { useEnvContext } from '../pages/EnvContext';
import { useEnvSettingsPage } from '../pages/settings/EnvSettingsPageContext';
import { SettingsResourceToolbar } from '../pages/settings/SettingsPrimitives';
import { createEnvResourceCollection } from '../services/envResourceCache';
import { PluginAuthorAccess } from './PluginAuthorAccess';
import { listPluginDrafts } from './pluginCreationApi';
import { authorPreviewIdentity } from './pluginAuthorApi';
import { parsePluginSettingsResource, parseInstalledPluginSettingsResource, pluginAuthorSettingsResource, pluginInstalledSettingsResource, type PluginAuthorSettingsTarget } from './pluginSettingsTarget';
import { PluginConnectionsDialog, type PluginConnectionsAPI } from './PluginConnectionsDialog';
import type { PluginInventoryItem } from './pluginTypes';

export type PluginSettingsOwner = Readonly<{
  items: readonly PluginInventoryItem[]; ownerScope: object | false; loading: boolean;
  canManage: boolean; api: PluginConnectionsAPI; refresh: () => unknown;
}>;

export function PluginSettingsPanel(props: { resource?: string; installed?: PluginSettingsOwner }) {
  const i18n = useI18n(), env = useEnvContext(), ctx = useEnvSettingsPage(), host = useSettingsPanelHost();
  const resources = createEnvResourceCollection(env);
  const active = () => !host || host.present() && host.target()?.section === 'plugins';
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const target = createMemo(() => parsePluginSettingsResource(props.resource));
  const installedID = createMemo(() => parseInstalledPluginSettingsResource(props.resource));
  // IMPORTANT: EnvSettingsDialog remounts this panel when the environment scope
  // changes. A transport session is only write admission, never draft ownership;
  // reconnects must preserve each exact instance's draft and original CAS revision.
  const installedOwnerScope = {};
  const installedItems = createMemo(() => props.installed?.items.filter(item => item.pluginInstanceID && item.networkConnectors?.length) ?? []);
  const installedItem = () => installedItems().find(item => item.pluginInstanceID === installedID());
  const [visitedInstalled, setVisitedInstalled] = createSignal<readonly PluginInventoryItem[]>([]);
  createEffect(() => { const item = installedItem(); if (item) setVisitedInstalled(previous => previous.some(entry => entry.pluginInstanceID === item.pluginInstanceID) ? previous : [...previous, item]); });
  const [refresh, setRefresh] = createSignal(0);
  // IMPORTANT: The author APIs own their data. Generic agent-settings loading
  // cannot revoke their authority or replace retained connection drafts.
  const authority = () => resources.ready() ? resources.access().generation + 1 : false;
  const [drafts] = createResource(() => active() && authority() ? `${authority()}:${refresh()}` : false, async () => {
    const generation = resources.access().generation;
    const result = await listPluginDrafts();
    if (disposed || !resources.ready() || resources.access().generation !== generation) throw new DOMException('Settings authority changed', 'AbortError');
    return result.filter(draft => draft.lifecycle === 'active' && !!draft.workspace_id);
  });
  const draftData = () => drafts.error ? undefined : drafts();
  const selectedDraft = () => draftData()?.find(draft => draft.id === target()?.draftID && draft.workspace_id === target()?.workspaceID);
  const [preview] = createResource(() => {
    const selected = selectedDraft();
    return active() && authority() && selected && target() ? JSON.stringify([authority(), selected.id, selected.workspace_id, props.resource, refresh()]) : false;
  }, async () => {
    const selected = target()!, generation = resources.access().generation;
    const result = await authorPreviewIdentity(selected.workspaceID);
    if (disposed || !resources.ready() || resources.access().generation !== generation) throw new DOMException('Settings authority changed', 'AbortError');
    return { ...selected, pluginInstanceID: result.preview.plugin_instance_id, generation };
  });
  const previewData = () => preview.error ? undefined : preview();
  const [resolvedSelections, setResolvedSelections] = createSignal<Readonly<Record<string, string>>>({});
  const confirmed = () => {
    const requested = target(), current = previewData();
    return authority() && selectedDraft() && current && requested && current.draftID === requested.draftID && current.workspaceID === requested.workspaceID
      && current.pluginInstanceID && (!requested.pluginInstanceID || requested.pluginInstanceID === current.pluginInstanceID)
      && (!resolvedSelections()[props.resource!] || resolvedSelections()[props.resource!] === current.pluginInstanceID)
      && current.generation === resources.access().generation ? current as PluginAuthorSettingsTarget & { pluginInstanceID: string } : undefined;
  };
  const exactKey = () => { const value = confirmed(); return value ? pluginAuthorSettingsResource(value) : undefined; };
  const [visited, setVisited] = createSignal<readonly { key: string; target: PluginAuthorSettingsTarget & { pluginInstanceID: string } }[]>([]);
  createEffect(() => {
    const value = confirmed(), key = exactKey();
    if (value && !target()?.pluginInstanceID && props.resource && !resolvedSelections()[props.resource]) setResolvedSelections(previous => ({ ...previous, [props.resource!]: value.pluginInstanceID }));
    if (value && key) setVisited(previous => previous.some(entry => entry.key === key) ? previous : [...previous, { key, target: value }]);
  });
  // IMPORTANT: Settings only reads the existing draft and author preview. Exact
  // workspace + instance identity can never fall through to an installed plugin,
  // resume a workspace, or silently retarget after an artifact replacement.
  const choose = (value: string) => {
    setResolvedSelections(previous => { const next = { ...previous }; delete next[value]; return next; });
    env.openSettings('plugins', value ? { resource: value } : undefined);
  };
  const retry = () => { setRefresh(value => value + 1); void props.installed?.refresh(); };
  // IMPORTANT: Select reads these props from event handlers. Compute conditional
  // option/value state under this panel's owner so those reads allocate no roots.
  const resourceValue = createMemo(() => selectedDraft() ? pluginAuthorSettingsResource({ draftID: selectedDraft()!.id, workspaceID: selectedDraft()!.workspace_id! }) : props.resource ?? '');
  const resourceOptions = createMemo(() => [{ value: '', label: i18n.t('settings.plugins.target') },
    ...installedItems().map(item => ({ value: pluginInstalledSettingsResource(item.pluginInstanceID!), label: item.displayName, group: 'installed', groupLabel: i18n.t('settings.plugins.installed') })),
    ...(props.resource && !selectedDraft() && !installedItem() ? [{ value: props.resource, label: i18n.t('settings.targetUnavailable'), disabled: true }] : []),
    ...(draftData() ?? []).map(draft => ({ value: pluginAuthorSettingsResource({ draftID: draft.id, workspaceID: draft.workspace_id! }),
      label: draft.title.trim() || i18n.t('uiCopy.plugin.creation.untitled'), group: 'author-previews', groupLabel: i18n.t('settings.plugins.preview') }))]);
  // IMPORTANT: Settings owns connection configuration only. Plugin Center's
  // catalog, installation, updates and removal remain in its standalone modal.
  return <div class="redeven-settings-stack" data-plugin-settings>
    <SettingsResourceToolbar label={i18n.t('settings.plugins.target')} actions={<Button variant="ghost" disabled={!authority() || drafts.loading || preview.loading} onClick={retry}>{i18n.t('common.actions.refresh')}</Button>}>
      <Select section="plugins" class="w-full" ariaLabel={i18n.t('settings.plugins.target')}
        value={resourceValue()} options={resourceOptions()}
        // IMPORTANT: Explicit same-value reselection is the only way to release
        // a pinned workspace identity; refresh must never silently retarget it.
        onOptionSelect={option => choose(option.value)} />
    </SettingsResourceToolbar>
    <Show when={drafts.error}><div role="alert" class="text-sm text-destructive">{i18n.t('uiCopy.plugin.creation.draftsLoadFailed')} <Button variant="ghost" onClick={retry}>{i18n.t('common.actions.retry')}</Button></div></Show>
    <Show when={!props.resource}>
      <For each={installedItems()}>{item => <Button class="w-full justify-start" variant="outline" onClick={() => choose(pluginInstalledSettingsResource(item.pluginInstanceID!))}>{item.displayName}</Button>}</For>
      <Show when={!props.installed?.loading && !installedItems().length}><p class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.connections.empty')}</p></Show>
    </Show>
    <Show when={installedID() && !props.installed?.loading && !installedItem()}><p role="alert">{i18n.t('settings.targetUnavailable')}</p></Show>
    <Show when={props.installed}>{owner => <For each={visitedInstalled()}>{captured => {
      const item = () => installedItems().find(entry => entry.pluginInstanceID === captured.pluginInstanceID);
      const current = createMemo(() => authority() && !!item() && !!owner().ownerScope);
      const visible = createMemo(() => active() && installedID() === captured.pluginInstanceID && !!current());
      const admittedAuthority = createMemo(() => current() ? authority() : false);
      const canManage = createMemo(() => !!current() && owner().canManage);
      return <PluginConnectionsDialog embedded open visible={visible()}
        item={item() ?? captured} ownerScope={installedOwnerScope} authorityKey={admittedAuthority()}
        canManage={canManage()} api={owner().api} onOpenChange={() => {}} />;
    }}</For>}</Show>
    <Show when={props.resource && !installedID()}>
      <Show when={drafts.loading || preview.loading}><p role="status" class="text-sm text-muted-foreground">{i18n.t('common.status.loading')}</p></Show>
      <Show when={!drafts.loading && !preview.loading && !confirmed()}><p role="alert" class="text-sm text-destructive">{i18n.t(selectedDraft() && previewData() && !previewData()?.pluginInstanceID ? 'settings.plugins.previewEmpty' : 'settings.targetUnavailable')}</p></Show>
    </Show>
    <For each={visited()}>{entry => <div hidden={exactKey() !== entry.key || !props.resource} class="min-w-0">
      <PluginAuthorAccess workspaceID={entry.target.workspaceID} pluginInstanceID={entry.target.pluginInstanceID}
        embeddedConnections visible={active() && exactKey() === entry.key && !!props.resource}
        authorityKey={authority()} refreshRevision={refresh()} canManage={!!authority() && ctx.canAdmin()}
        onChanged={async () => { env.bumpSettingsSeq(); }} onError={error => ctx.notify.error(i18n.t('uiCopy.plugin.creation.accessLoadFailed'), String(error))} />
    </div>}</For>
  </div>;
}
