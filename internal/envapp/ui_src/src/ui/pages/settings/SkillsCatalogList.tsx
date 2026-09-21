import { For, Show } from 'solid-js';
import { Button, Switch } from '@floegence/floe-webapp-core/ui';
import { SettingsPill, SettingsList, SettingRow } from './SettingsPrimitives';
import { useI18n, type I18nHelpers } from '../../i18n';
import type { SkillCatalogEntry, SkillSourceItem } from './types';

function skillScopeLabel(scope: string, i18n: I18nHelpers): string {
  const value = String(scope ?? '').trim().toLowerCase();
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
  const i18n = useI18n();

  return (
    <SettingsList>
      <For each={props.skills}>{(item) => {
        const source = () => props.sources[String(item.path ?? '').trim()];
        return (
          <SettingRow title={item.name} description={item.description || i18n.t('skillsSettings.noDescription')}
            control={<Switch checked={!!item.enabled} onChange={(value) => props.onToggle(item, value)}
              disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving[item.path]}
              aria-label={`${item.name}: ${i18n.t('skillsSettings.enabled')}`} />}>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{skillScopeLabel(item.scope, i18n)}</span><span aria-hidden="true">·</span><span>{skillSourceLabel(source()?.source_type ?? '', i18n)}</span>
              <Show when={item.effective}><SettingsPill tone="success">{i18n.t('skillsSettings.status.effective')}</SettingsPill></Show>
              <Show when={!item.enabled}><SettingsPill>{i18n.t('skillsSettings.status.disabled')}</SettingsPill></Show>
              <Show when={item.dependency_state === 'degraded'}><SettingsPill tone="warning">{i18n.t('skillsSettings.status.dependencyDegraded')}</SettingsPill></Show>
              <Show when={item.shadowed_by}><SettingsPill tone="warning">{i18n.t('skillsSettings.status.shadowed')}</SettingsPill></Show>
            </div>
            <code class="mt-2 block break-all text-[11px] text-muted-foreground">{item.path}</code>
            <Show when={source()?.source_id}><code class="mt-1 block break-all text-[11px] text-muted-foreground">{source()?.source_id}</code></Show>
            <Show when={item.shadowed_by}><p class="mt-2 break-all text-xs text-warning">{i18n.t('skillsSettings.shadowedBy', { path: item.shadowed_by ?? '' })}</p></Show>
            <div class="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => props.onBrowse(item)} disabled={!props.canInteract}>{i18n.t('skillsSettings.browse')}</Button>
              <Show when={source()?.source_type === 'github_import'}><Button size="sm" variant="outline" onClick={() => props.onReinstall(item)} loading={!!props.reinstalling[item.path]} disabled={!props.canInteract || !props.canAdmin}>{i18n.t('skillsSettings.reinstall')}</Button></Show>
              <Button size="sm" variant="ghost" onClick={() => props.onDelete(item)} disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving[item.path] || !!props.reinstalling[item.path]}>{i18n.t('common.actions.delete')}</Button>
            </div>
          </SettingRow>
        );
      }}</For>
      <Show when={props.skills.length === 0}><p role="status" class="px-6 py-12 text-center text-sm text-muted-foreground">{props.loading ? i18n.t('skillsSettings.loadingCatalog') : i18n.t('skillsSettings.noSkillsForFilters')}</p></Show>
    </SettingsList>
  );
}
