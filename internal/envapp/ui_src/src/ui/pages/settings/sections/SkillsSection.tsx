import { For, Show, createMemo, createSignal } from 'solid-js';
import { Layers } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Select, Dialog, ConfirmDialog, Checkbox } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, FieldLabel } from '../SettingsPrimitives';
import { SkillsCatalogTable } from '../SkillsCatalogTable';
import { fetchLocalApiJSON } from '../../../services/localApi';
import { useI18n } from '../../../i18n';
import type { SkillCatalogEntry } from '../types';

export function SkillsSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const [skillsData, setSkillsData] = createSignal<any>(null);
  const [sourcesData, setSourcesData] = createSignal<any>(null);

  const refetchSkills = async () => {
    try {
      const data = await fetchLocalApiJSON<any>('/_redeven_proxy/api/skills', { method: 'GET' });
      setSkillsData(data);
    } catch {}
  };
  const refetchSources = async () => {
    try {
      const data = await fetchLocalApiJSON<any>('/_redeven_proxy/api/skills/sources', { method: 'GET' });
      setSourcesData(data);
    } catch {}
  };

  const [skillQuery, setSkillQuery] = createSignal('');
  const [skillScopeFilter, setSkillScopeFilter] = createSignal<'all' | 'user' | 'user_agents'>('all');
  const [skillsReloading, setSkillsReloading] = createSignal(false);
  const [skillsLoading, setSkillsLoading] = createSignal(false);
  const [skillToggleSaving] = createSignal<Record<string, boolean>>({});
  const [skillReinstalling] = createSignal<Record<string, boolean>>({});

  const skillsCatalog = () => skillsData();
  const skillsError = () => null;
  const skillSources = () => (sourcesData() as any)?.sources ?? [];

  const filteredSkills = createMemo(() => {
    const all = (skillsCatalog()?.skills ?? []) as SkillCatalogEntry[];
    const q = skillQuery().trim().toLowerCase();
    const scope = skillScopeFilter();
    return all.filter((s) => {
      if (scope !== 'all' && s.scope !== scope) return false;
      if (q && !(s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q) || s.path?.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  const refreshSkillsCatalog = async (reload?: boolean) => {
    if (reload) setSkillsReloading(true); else setSkillsLoading(true);
    try { await refetchSkills(); await refetchSources(); }
    finally { setSkillsReloading(false); setSkillsLoading(false); }
  };

  // Placeholder actions
  const toggleSkill = async (_entry: SkillCatalogEntry, _enabled: boolean) => {};
  const openSkillBrowse = (_entry: SkillCatalogEntry) => {};
  const reinstallSkill = async (_entry: SkillCatalogEntry) => {};
  const askDeleteSkill = (_entry: SkillCatalogEntry) => {};

  // Install dialog
  const [skillInstallOpen, setSkillInstallOpen] = createSignal(false);
  const [skillInstallScope, setSkillInstallScope] = createSignal('user');
  const [skillInstallURL, setSkillInstallURL] = createSignal('');
  const [skillInstallRepo, setSkillInstallRepo] = createSignal('');
  const [skillInstallRef, setSkillInstallRef] = createSignal('main');
  const [skillInstallPaths, setSkillInstallPaths] = createSignal('');
  const [skillInstallOverwrite, setSkillInstallOverwrite] = createSignal(false);
  const [, setSkillInstallResolved] = createSignal<any[]>([]);
  const [skillInstallSaving, setSkillInstallSaving] = createSignal(false);
  const [skillInstallValidating, setSkillInstallValidating] = createSignal(false);

  const openInstallDialog = () => setSkillInstallOpen(true);
  const validateSkillInstall = async () => { setSkillInstallValidating(true); setSkillInstallValidating(false); };
  const installSkillsFromGitHub = async () => { setSkillInstallSaving(true); setSkillInstallSaving(false); };

  // Create dialog
  const [skillCreateOpen, setSkillCreateOpen] = createSignal(false);
  const [skillCreateScope, setSkillCreateScope] = createSignal('user');
  const [skillCreateName, setSkillCreateName] = createSignal('');
  const [skillCreateDescription, setSkillCreateDescription] = createSignal('');
  const [skillCreateBody, setSkillCreateBody] = createSignal('');
  const [skillCreateSaving] = createSignal(false);
  const createSkill = async () => {};

  return (
    <>
      <SettingsSection
        icon={Layers}
        title={i18n.t('skillsSettings.title')}
        description={i18n.t('skillsSettings.description')}
        badge={skillsReloading() || skillsLoading() ? i18n.t('skillsSettings.loading') : i18n.tn('skillsSettings.skillCount', skillsCatalog()?.skills?.length ?? 0)}
        error={skillsError()}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void refreshSkillsCatalog(true)} loading={skillsReloading()} disabled={!ctx.canInteract()}>{i18n.t('skillsSettings.reload')}</Button>
            <Button size="sm" variant="default" onClick={openInstallDialog} disabled={!ctx.canInteract() || !ctx.canAdmin()}>{i18n.t('skillsSettings.installFromGitHub')}</Button>
            <Button size="sm" variant="default" onClick={() => setSkillCreateOpen(true)} disabled={!ctx.canInteract() || !ctx.canAdmin()}>{i18n.t('skillsSettings.createSkill')}</Button>
          </>
        }
      >
        <div class="space-y-4">
          <div class="flex items-end gap-3">
            <div class="flex-1 min-w-0">
              <FieldLabel>{i18n.t('skillsSettings.searchLabel')}</FieldLabel>
              <Input value={skillQuery()} onInput={(e) => setSkillQuery(e.currentTarget.value)}
                placeholder={i18n.t('skillsSettings.searchPlaceholder')} size="sm" class="w-full" disabled={!ctx.canInteract()} />
            </div>
            <div class="w-40 flex-shrink-0">
              <FieldLabel>{i18n.t('skillsSettings.scopeLabel')}</FieldLabel>
              <Select value={skillScopeFilter()} onChange={(v) => setSkillScopeFilter(v as any)}
                disabled={!ctx.canInteract()}
                options={[{ value: 'all', label: i18n.t('skillsSettings.scopeAll') }, { value: 'user', label: i18n.t('skillsSettings.scopeUserRedeven') }, { value: 'user_agents', label: i18n.t('skillsSettings.scopeUserAgents') }]}
                class="w-full" />
            </div>
          </div>

          <SkillsCatalogTable
            skills={filteredSkills()} sources={skillSources()} loading={skillsLoading()}
            canInteract={ctx.canInteract()} canAdmin={ctx.canAdmin()}
            toggleSaving={skillToggleSaving()} reinstalling={skillReinstalling()}
            onToggle={(entry, enabled) => { void toggleSkill(entry, enabled); }}
            onBrowse={openSkillBrowse} onReinstall={(entry) => { void reinstallSkill(entry); }}
            onDelete={askDeleteSkill} />

          <Show when={(skillsCatalog()?.conflicts?.length ?? 0) > 0}>
            <div class="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div class="text-xs font-semibold text-warning">{i18n.t('skillsSettings.conflictsDetected', { count: skillsCatalog()?.conflicts?.length ?? 0 })}</div>
              <For each={(skillsCatalog()?.conflicts ?? []).slice(0, 5)}>
                {(item: any) => <div class="break-all text-[11px] text-warning">{item.name}: {item.path}</div>}
              </For>
            </div>
          </Show>

          <Show when={(skillsCatalog()?.errors?.length ?? 0) > 0}>
            <div class="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <div class="text-xs font-semibold text-destructive">{i18n.t('skillsSettings.catalogErrors', { count: skillsCatalog()?.errors?.length ?? 0 })}</div>
              <For each={(skillsCatalog()?.errors ?? []).slice(0, 5)}>
                {(item: any) => <div class="break-all text-[11px] text-destructive">{item.path}: {item.message}</div>}
              </For>
            </div>
          </Show>
        </div>
      </SettingsSection>

      {/* Install dialog */}
      <Dialog open={skillInstallOpen()} onOpenChange={(open) => { setSkillInstallOpen(open); if (!open) setSkillInstallResolved([]); }}
        title={i18n.t('skillsSettings.installDialogTitle')}
        footer={
          <div class="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setSkillInstallOpen(false)} disabled={skillInstallSaving() || skillInstallValidating()}>{i18n.t('common.actions.cancel')}</Button>
            <Button size="sm" variant="outline" onClick={() => void validateSkillInstall()} loading={skillInstallValidating()} disabled={!ctx.canInteract() || !ctx.canAdmin() || skillInstallSaving()}>{i18n.t('skillsSettings.validate')}</Button>
            <Button size="sm" variant="default" onClick={() => void installSkillsFromGitHub()} loading={skillInstallSaving()} disabled={!ctx.canInteract() || !ctx.canAdmin()}>{i18n.t('skillsSettings.install')}</Button>
          </div>
        }>
        <div class="space-y-4">
          <div><FieldLabel>{i18n.t('skillsSettings.scopeLabel')}</FieldLabel><Select value={skillInstallScope()} onChange={(v) => setSkillInstallScope(v as any)} options={[{ value: 'user', label: i18n.t('skillsSettings.scopeUserRedeven') }, { value: 'user_agents', label: i18n.t('skillsSettings.scopeUserAgents') }]} class="w-full" /></div>
          <div><FieldLabel hint={i18n.t('skillsSettings.preferredHint')}>{i18n.t('skillsSettings.githubUrlLabel')}</FieldLabel><Input value={skillInstallURL()} onInput={(e) => setSkillInstallURL(e.currentTarget.value)} placeholder="https://github.com/openai/skills/tree/main/skills/.curated/skill-installer" size="sm" class="w-full" /></div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><FieldLabel>{i18n.t('skillsSettings.repoLabel')}</FieldLabel><Input value={skillInstallRepo()} onInput={(e) => setSkillInstallRepo(e.currentTarget.value)} placeholder="openai/skills" size="sm" class="w-full font-mono text-xs" /></div>
            <div><FieldLabel>{i18n.t('skillsSettings.refLabel')}</FieldLabel><Input value={skillInstallRef()} onInput={(e) => setSkillInstallRef(e.currentTarget.value)} placeholder="main" size="sm" class="w-full font-mono text-xs" /></div>
            <div class="md:col-span-2"><FieldLabel hint={i18n.t('skillsSettings.pathsHint')}>{i18n.t('skillsSettings.pathsLabel')}</FieldLabel><textarea class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" style={{ 'min-height': '5rem' }} value={skillInstallPaths()} onInput={(e) => setSkillInstallPaths(e.currentTarget.value)} spellcheck={false} /></div>
          </div>
          <Checkbox checked={skillInstallOverwrite()} onChange={(v) => setSkillInstallOverwrite(v)} label={i18n.t('skillsSettings.overwriteExisting')} size="sm" disabled={!ctx.canInteract() || !ctx.canAdmin()} />
        </div>
      </Dialog>

      {/* Create dialog */}
      <ConfirmDialog open={skillCreateOpen()} onOpenChange={(open) => setSkillCreateOpen(open)} title={i18n.t('skillsSettings.createDialogTitle')} confirmText={i18n.t('skillsSettings.create')} loading={skillCreateSaving()} onConfirm={() => void createSkill()}>
        <div class="space-y-3">
          <div><FieldLabel>{i18n.t('skillsSettings.scopeLabel')}</FieldLabel><Select value={skillCreateScope()} onChange={(v) => setSkillCreateScope(v as any)} options={[{ value: 'user', label: i18n.t('skillsSettings.scopeUserRedeven') }, { value: 'user_agents', label: i18n.t('skillsSettings.scopeUserAgents') }]} class="w-full" /></div>
          <div><FieldLabel>{i18n.t('skillsSettings.nameLabel')}</FieldLabel><Input value={skillCreateName()} onInput={(e) => setSkillCreateName(e.currentTarget.value)} placeholder="incident-response" size="sm" class="w-full" /></div>
          <div><FieldLabel>{i18n.t('skillsSettings.descriptionLabel')}</FieldLabel><Input value={skillCreateDescription()} onInput={(e) => setSkillCreateDescription(e.currentTarget.value)} placeholder={i18n.t('skillsSettings.briefDescriptionPlaceholder')} size="sm" class="w-full" /></div>
          <div><FieldLabel hint={i18n.t('skillsSettings.optionalHint')}>{i18n.t('skillsSettings.initialBodyLabel')}</FieldLabel><textarea class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" style={{ 'min-height': '7rem' }} value={skillCreateBody()} onInput={(e) => setSkillCreateBody(e.currentTarget.value)} spellcheck={false} /></div>
        </div>
      </ConfirmDialog>
    </>
  );
}
