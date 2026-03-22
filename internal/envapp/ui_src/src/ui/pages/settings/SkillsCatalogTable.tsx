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
import type { SkillCatalogEntry, SkillSourceItem } from './types';

function skillScopeLabel(scope: string): string {
  const value = String(scope ?? '').trim().toLowerCase();
  if (value === 'user') return 'User (.redeven)';
  if (value === 'user_agents') return 'User (.agents)';
  return value || 'unknown';
}

function skillSourceLabel(sourceType: string): string {
  const value = String(sourceType ?? '').trim().toLowerCase();
  if (value === 'github_import') return 'GitHub import';
  if (value === 'local_manual') return 'Local manual';
  if (value === 'system_bundle') return 'System bundle';
  return value || 'unknown';
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
  return (
    <SettingsTable minWidthClass="min-w-[66rem]">
      <SettingsTableHead sticky>
        <SettingsTableHeaderRow>
          <SettingsTableHeaderCell class="w-56">Name</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-36">Scope</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-48">Source</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-48">Status</SettingsTableHeaderCell>
          <SettingsTableHeaderCell>Path</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-56">Actions</SettingsTableHeaderCell>
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
                    <div class="mt-1 text-[11px] text-muted-foreground" title={item.description}>{item.description || 'No description.'}</div>
                  </div>
                </SettingsTableCell>
                <SettingsTableCell class="text-[11px] text-muted-foreground">{skillScopeLabel(item.scope)}</SettingsTableCell>
                <SettingsTableCell>
                  <div class="space-y-1">
                    <div class="text-[11px] text-muted-foreground">{skillSourceLabel(String(source()?.source_type ?? ''))}</div>
                    <Show when={String(source()?.source_id ?? '').trim()}>
                      <div class="break-all font-mono text-[11px] text-muted-foreground">{source()?.source_id}</div>
                    </Show>
                  </div>
                </SettingsTableCell>
                <SettingsTableCell>
                  <div class="flex flex-wrap gap-1.5">
                    <Show when={item.effective}>
                      <SettingsPill tone="success">Effective</SettingsPill>
                    </Show>
                    <Show when={!item.enabled}>
                      <SettingsPill tone="warning">Disabled</SettingsPill>
                    </Show>
                    <Show when={item.dependency_state === 'degraded'}>
                      <SettingsPill tone="warning">Dependency degraded</SettingsPill>
                    </Show>
                    <Show when={item.shadowed_by}>
                      <SettingsPill tone="danger">Shadowed</SettingsPill>
                    </Show>
                  </div>
                </SettingsTableCell>
                <SettingsTableCell>
                  <div class="break-all font-mono text-[11px] text-muted-foreground">{item.path}</div>
                  <Show when={item.shadowed_by}>
                    <div class="mt-1 break-all text-[11px] text-warning">Shadowed by: {item.shadowed_by}</div>
                  </Show>
                </SettingsTableCell>
                <SettingsTableCell>
                  <div class="flex flex-wrap items-center gap-2">
                    <Checkbox
                      checked={!!item.enabled}
                      onChange={(value) => props.onToggle(item, value)}
                      disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving?.[item.path]}
                      label={item.enabled ? 'Enabled' : 'Disabled'}
                      size="sm"
                    />
                    <Button size="sm" variant="outline" onClick={() => props.onBrowse(item)} disabled={!props.canInteract}>
                      Browse
                    </Button>
                    <Show when={String(source()?.source_type ?? '').toLowerCase() === 'github_import'}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => props.onReinstall(item)}
                        loading={!!props.reinstalling?.[item.path]}
                        disabled={!props.canInteract || !props.canAdmin}
                      >
                        Reinstall
                      </Button>
                    </Show>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive"
                      onClick={() => props.onDelete(item)}
                      disabled={!props.canInteract || !props.canAdmin || !!props.toggleSaving?.[item.path] || !!props.reinstalling?.[item.path]}
                    >
                      Delete
                    </Button>
                  </div>
                </SettingsTableCell>
              </SettingsTableRow>
            );
          }}
        </For>
        {props.skills.length === 0 ? (
          <SettingsTableEmptyRow colSpan={6}>
            {props.loading ? 'Loading skills catalog...' : 'No skills found for current filters.'}
          </SettingsTableEmptyRow>
        ) : null}
      </SettingsTableBody>
    </SettingsTable>
  );
}
