import { Folder, Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { For, Show } from 'solid-js';
import { Button, Switch } from '@floegence/floe-webapp-core/ui';
import { SettingsPill, SettingsList, SettingRow, RowMenu } from './primitives';
import { useFlowerExtensions, type ExtensionI18n as I18nHelpers } from './context';
import type { SkillCatalogEntry, SkillSourceItem } from './types';
import { ExtensionIcon } from './ExtensionIcon';

function skillScopeLabel(scope: string, i18n: I18nHelpers): string {
  const value = String(scope ?? '').trim().toLowerCase();
  if (value === 'agent_plugin') return i18n.t('plugins');
  if (value === 'system') return i18n.t('skillsSettings.source.systemBundle');
  if (value === 'user') return i18n.t('skillsSettings.scopeUserRedeven');
  if (value === 'user_agents') return i18n.t('skillsSettings.scopeUserAgents');
  return value || i18n.t('skillsSettings.unknown');
}

function skillSourceLabel(sourceType: string, i18n: I18nHelpers): string {
  const value = String(sourceType ?? '').trim().toLowerCase();
  if (value === 'github_import') return i18n.t('skillsSettings.source.githubImport');
  if (value === 'local_manual') return i18n.t('skillsSettings.source.localManual');
  if (value === 'system_bundle') return i18n.t('skillsSettings.source.systemBundle');
  return value || i18n.t('skillsSettings.unknown');
}

export function SkillsCatalogList(props: {
  skills: SkillCatalogEntry[];
  sources: Record<string, SkillSourceItem>;
  loading: boolean;
  canInteract: boolean;
  canAdmin: boolean;
  toggleSaving: Record<string, boolean>;
  reinstalling: Record<string, boolean>;
  onToggle: (entry: SkillCatalogEntry, enabled: boolean) => void;
  onBrowse: (entry: SkillCatalogEntry) => void;
  onReinstall: (entry: SkillCatalogEntry) => void;
  onDelete: (entry: SkillCatalogEntry) => void;
}) {
  const ctx = useFlowerExtensions();
  const i18n = ctx.i18n;

  return (
    <SettingsList>
      <For each={props.skills}>{(item) => {
        const source = () => props.sources[String(item.path ?? '').trim()];
        return (
          <SettingRow title={item.plugin_id ? item.name.split('/').at(-1) ?? item.name : item.name} description={item.description || i18n.t('skillsSettings.noDescription')}
            icon={<ExtensionIcon identity={`skill:${item.id}`} name={item.name} icons={item.icons} />}
            metadata={<>
              <span class="flower-extension-source" title={skillScopeLabel(item.scope, i18n)}>{skillScopeLabel(item.scope, i18n)}</span>
              <div class="flower-extension-statuses">
              <Show when={item.effective}><SettingsPill tone="success">{i18n.t('skillsSettings.status.effective')}</SettingsPill></Show>
              <Show when={!item.enabled}><SettingsPill>{i18n.t('skillsSettings.status.disabled')}</SettingsPill></Show>
              <Show when={item.dependency_state === 'degraded'}><SettingsPill tone="warning">{i18n.t('skillsSettings.status.dependencyDegraded')}</SettingsPill></Show>
              <Show when={item.shadowed_by}><SettingsPill tone="warning">{i18n.t('skillsSettings.status.shadowed')}</SettingsPill></Show>
              </div>
            </>}
            control={<Show when={!item.plugin_id} fallback={<Button size="sm" variant="outline" onClick={() => ctx.openPlugin?.(item.plugin_id!)}>{i18n.t('plugins.manage')}</Button>}><>
              <Button size="icon" variant="ghost" icon={Folder} aria-label={`${i18n.t('skillsSettings.browse')}: ${item.name}`} title={i18n.t('skillsSettings.browse')} onClick={() => props.onBrowse(item)} disabled={!props.canInteract} />
              <RowMenu name={item.name} busy={!!props.reinstalling[item.path] || !!props.toggleSaving[item.path]} items={[
                ...(source()?.source_type === 'github_import' ? [{ id: 'reinstall', label: i18n.t('skillsSettings.reinstall'), icon: () => <Refresh class="h-4 w-4" />, disabled: !props.canInteract || !props.canAdmin || !!props.reinstalling[item.path] }] : []),
                ...(item.scope === 'user' || item.scope === 'user_agents' ? [{ id: 'delete', label: i18n.t('common.actions.delete'), tone: 'danger' as const, icon: () => <Trash class="h-4 w-4" />, disabled: !props.canInteract || !props.canAdmin || !!props.toggleSaving[item.path] || !!props.reinstalling[item.path] }] : []),
              ]} onSelect={id => { if (id === 'reinstall') props.onReinstall(item); else if (id === 'delete') props.onDelete(item); }} />
              <Switch checked={!!item.enabled} onChange={(value) => props.onToggle(item, value)}
                disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving[item.path]}
                aria-label={`${item.name}: ${i18n.t('skillsSettings.enabled')}`} />
            </></Show>}>
            <Show when={source()}><p class="flower-extension-detail-source">{skillSourceLabel(source()?.source_type ?? '', i18n)}</p></Show>
            <code class="mt-2 block break-all text-[11px] text-muted-foreground">{item.path}</code>
            <Show when={source()?.source_id}><code class="mt-1 block break-all text-[11px] text-muted-foreground">{source()?.source_id}</code></Show>
            <Show when={item.shadowed_by}><p class="mt-2 break-all text-xs text-warning">{i18n.t('skillsSettings.shadowedBy', { path: item.shadowed_by ?? '' })}</p></Show>
          </SettingRow>
        );
      }}</For>
      <Show when={props.skills.length === 0}><Show when={props.loading} fallback={<p role="status" class="px-6 py-12 text-center text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t('skillsSettings.noSkillsForFilters')}</p>}><div class="flower-extension-skeleton" role="status" aria-label={i18n.t('skillsSettings.loadingCatalog')}><span /><span /><span /></div></Show></Show>
    </SettingsList>
  );
}
