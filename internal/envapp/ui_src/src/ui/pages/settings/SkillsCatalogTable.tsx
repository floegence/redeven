import { For, Show } from 'solid-js';
import { Button, Checkbox } from '@floegence/floe-webapp-core/ui';
import {
  SettingsPill,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableEmptyRow,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
} from './SettingsPrimitives';
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

export function SkillsCatalogTable(props: {
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
    <SettingsTable minWidthClass="min-w-[66rem]">
      <SettingsTableHead sticky>
        <SettingsTableHeaderRow>
          <SettingsTableHeaderCell class="w-56">{i18n.t('skillsSettings.table.name')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-36">{i18n.t('skillsSettings.table.scope')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-48">{i18n.t('skillsSettings.table.source')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-48">{i18n.t('skillsSettings.table.status')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell>{i18n.t('skillsSettings.table.path')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-56">{i18n.t('settings.table.actions')}</SettingsTableHeaderCell>
        </SettingsTableHeaderRow>
      </SettingsTableHead>
      <SettingsTableBody>
        <For each={props.skills}>
          {(item) => {
            const source = () => props.sources[String(item.path ?? '').trim()];
            return (
              <SettingsTableRow>
                <SettingsTableCell>
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-foreground" title={item.name}>{item.name}</div>
                    <div class="mt-1 text-[11px] text-muted-foreground" title={item.description}>{item.description || i18n.t('skillsSettings.noDescription')}</div>
                  </div>
                </SettingsTableCell>
                <SettingsTableCell class="text-[11px] text-muted-foreground">{skillScopeLabel(item.scope, i18n)}</SettingsTableCell>
                <SettingsTableCell>
                  <div class="space-y-1">
                    <div class="text-[11px] text-muted-foreground">{skillSourceLabel(String(source()?.source_type ?? ''), i18n)}</div>
                    <Show when={String(source()?.source_id ?? '').trim()}>
                      <div class="break-all font-mono text-[11px] text-muted-foreground">{source()?.source_id}</div>
                    </Show>
                  </div>
                </SettingsTableCell>
                <SettingsTableCell>
                  <div class="flex flex-wrap gap-1.5">
                    <Show when={item.effective}>
                      <SettingsPill tone="success">{i18n.t('skillsSettings.status.effective')}</SettingsPill>
                    </Show>
                    <Show when={!item.enabled}>
                      <SettingsPill tone="warning">{i18n.t('skillsSettings.status.disabled')}</SettingsPill>
                    </Show>
                    <Show when={item.dependency_state === 'degraded'}>
                      <SettingsPill tone="warning">{i18n.t('skillsSettings.status.dependencyDegraded')}</SettingsPill>
                    </Show>
                    <Show when={item.shadowed_by}>
                      <SettingsPill tone="danger">{i18n.t('skillsSettings.status.shadowed')}</SettingsPill>
                    </Show>
                  </div>
                </SettingsTableCell>
                <SettingsTableCell>
                  <div class="break-all font-mono text-[11px] text-muted-foreground">{item.path}</div>
                  <Show when={item.shadowed_by}>
                    <div class="mt-1 break-all text-[11px] text-warning">{i18n.t('skillsSettings.shadowedBy', { path: item.shadowed_by ?? '' })}</div>
                  </Show>
                </SettingsTableCell>
                <SettingsTableCell>
                  <div class="flex flex-wrap items-center gap-2">
                    <Checkbox
                      checked={!!item.enabled}
                      onChange={(value) => props.onToggle(item, value)}
                      disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving?.[item.path]}
                      label={item.enabled ? i18n.t('skillsSettings.enabled') : i18n.t('skillsSettings.disabled')}
                      size="sm"
                    />
                    <Button size="sm" variant="outline" onClick={() => props.onBrowse(item)} disabled={!props.canInteract}>
                      {i18n.t('skillsSettings.browse')}
                    </Button>
                    <Show when={String(source()?.source_type ?? '').toLowerCase() === 'github_import'}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => props.onReinstall(item)}
                        loading={!!props.reinstalling?.[item.path]}
                        disabled={!props.canInteract || !props.canAdmin}
                      >
                        {i18n.t('skillsSettings.reinstall')}
                      </Button>
                    </Show>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive"
                      onClick={() => props.onDelete(item)}
                      disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving?.[item.path] || !!props.reinstalling?.[item.path]}
                    >
                      {i18n.t('common.actions.delete')}
                    </Button>
                  </div>
                </SettingsTableCell>
              </SettingsTableRow>
            );
          }}
        </For>
        {props.skills.length === 0 ? (
          <SettingsTableEmptyRow colSpan={6}>
            {props.loading ? i18n.t('skillsSettings.loadingCatalog') : i18n.t('skillsSettings.noSkillsForFilters')}
          </SettingsTableEmptyRow>
        ) : null}
      </SettingsTableBody>
    </SettingsTable>
  );
}
