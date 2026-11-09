import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useSettingsPanelHost } from '../../../../../settings_ui/src/SettingsPanelHost';
import { useI18n } from '../i18n';
import { useEnvContext } from '../pages/EnvContext';
import { useEnvSettingsPage } from '../pages/settings/EnvSettingsPageContext';
import { UIFirstKeepAlivePanel } from '../primitives/UIFirstKeepAlivePanel';
import { createEnvResourceCollection } from '../services/envResourceCache';
import { PluginAuthorAccess } from './PluginAuthorAccess';
import { listPluginDrafts } from './pluginCreationApi';
import { authorPreviewIdentity } from './pluginAuthorApi';
import { parsePluginSettingsResource, pluginAuthorSettingsResource, type PluginAuthorSettingsTarget } from './pluginSettingsTarget';

export function PluginSettingsPanel(props: { resource?: string; renderInstalled: () => JSX.Element }) {
  const i18n = useI18n(), env = useEnvContext(), ctx = useEnvSettingsPage(), host = useSettingsPanelHost();
  const resources = createEnvResourceCollection(env);
  const active = () => !host || host.present() && host.target()?.section === 'plugins';
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const target = createMemo(() => parsePluginSettingsResource(props.resource));
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
  const retry = () => setRefresh(value => value + 1);
  return <div class="flex h-full min-h-0 flex-col gap-4" data-plugin-settings>
    <div class="flex items-end gap-2">
      <label class="min-w-0 flex-1 space-y-1 text-sm"><span>{i18n.t('settings.plugins.target')}</span>
        <select class="w-full rounded-md border bg-background px-3 py-2" aria-label={i18n.t('settings.plugins.target')}
          value={selectedDraft() ? pluginAuthorSettingsResource({ draftID: selectedDraft()!.id, workspaceID: selectedDraft()!.workspace_id! }) : props.resource ?? ''}
          onChange={event => choose(event.currentTarget.value)}>
          <option value="">{i18n.t('settings.plugins.installed')}</option>
          <Show when={props.resource && !selectedDraft()}><option value={props.resource}>{i18n.t('settings.targetUnavailable')}</option></Show>
          <optgroup label={i18n.t('settings.plugins.preview')}><For each={draftData()}>{draft => <option value={pluginAuthorSettingsResource({ draftID: draft.id, workspaceID: draft.workspace_id! })}>{draft.title.trim() || i18n.t('uiCopy.plugin.creation.untitled')}</option>}</For></optgroup>
        </select>
      </label>
      <Button variant="ghost" disabled={!authority() || drafts.loading || preview.loading} onClick={retry}>{i18n.t('common.actions.refresh')}</Button>
    </div>
    <Show when={drafts.error}><div role="alert" class="text-sm text-destructive">{i18n.t('uiCopy.plugin.creation.draftsLoadFailed')} <Button variant="ghost" onClick={retry}>{i18n.t('common.actions.retry')}</Button></div></Show>
    <UIFirstKeepAlivePanel active={!props.resource} render={props.renderInstalled} class="min-h-0 flex-1" />
    <Show when={props.resource}>
      <Show when={drafts.loading || preview.loading}><p role="status" class="text-sm text-muted-foreground">{i18n.t('common.status.loading')}</p></Show>
      <Show when={!drafts.loading && !preview.loading && !confirmed()}><p role="alert" class="text-sm text-destructive">{i18n.t(selectedDraft() && previewData() && !previewData()?.pluginInstanceID ? 'settings.plugins.previewEmpty' : 'settings.targetUnavailable')}</p></Show>
    </Show>
    <For each={visited()}>{entry => <div hidden={exactKey() !== entry.key || !props.resource} class="min-h-0 flex-1 overflow-auto">
      <PluginAuthorAccess workspaceID={entry.target.workspaceID} pluginInstanceID={entry.target.pluginInstanceID}
        embeddedConnections visible={active() && exactKey() === entry.key && !!props.resource}
        authorityKey={authority()} refreshRevision={refresh()} canManage={!!authority() && ctx.canAdmin()}
        onChanged={async () => { env.bumpSettingsSeq(); }} onError={error => ctx.notify.error(i18n.t('uiCopy.plugin.creation.accessLoadFailed'), String(error))} />
    </div>}</For>
  </div>;
}
