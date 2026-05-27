import { For, Show, createMemo, createSignal, createResource } from 'solid-js';
import { Layers } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Select, Dialog, ConfirmDialog, Checkbox } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, FieldLabel } from '../SettingsPrimitives';
import { SkillsCatalogTable } from '../SkillsCatalogTable';
import { fetchGatewayJSON } from '../../../services/gatewayApi';
import type { SkillCatalogEntry, SkillGitHubCatalogResponse, SkillGitHubValidateResponse, SkillSourcesResponse } from '../types';

export function SkillsSection() {
  const ctx = useEnvSettingsPage();

  const [skillsData, setSkillsData] = createSignal<any>(null);
  const [sourcesData, setSourcesData] = createSignal<any>(null);

  const refetchSkills = async () => {
    try {
      const data = await fetchGatewayJSON<any>('/_redeven_proxy/api/skills', { method: 'GET' });
      setSkillsData(data);
    } catch {}
  };
  const refetchSources = async () => {
    try {
      const data = await fetchGatewayJSON<any>('/_redeven_proxy/api/skills/sources', { method: 'GET' });
      setSourcesData(data);
    } catch {}
  };

  const [skillQuery, setSkillQuery] = createSignal('');
  const [skillScopeFilter, setSkillScopeFilter] = createSignal<'all' | 'user' | 'user_agents'>('all');
  const [skillsReloading, setSkillsReloading] = createSignal(false);
  const [skillsLoading, setSkillsLoading] = createSignal(false);
  const [skillToggleSaving, setSkillToggleSaving] = createSignal<Record<string, boolean>>({});
  const [skillReinstalling, setSkillReinstalling] = createSignal<Record<string, boolean>>({});

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
  const [skillInstallResolved, setSkillInstallResolved] = createSignal<any[]>([]);
  const [skillInstallSaving, setSkillInstallSaving] = createSignal(false);
  const [skillInstallValidating, setSkillInstallValidating] = createSignal(false);
  const [skillGitHubCatalogData, setSkillGitHubCatalogData] = createSignal<any>(null);
  const [skillGitHubCatalogLoading, setSkillGitHubCatalogLoading] = createSignal(false);

  const refetchGitHubCatalog = async () => {
    setSkillGitHubCatalogLoading(true);
    try {
      const data = await fetchGatewayJSON<any>('/_redeven_proxy/api/skills/github-catalog', { method: 'GET' });
      setSkillGitHubCatalogData(data);
    } catch {}
    setSkillGitHubCatalogLoading(false);
  };

  const gitHubCatalog = () => skillGitHubCatalogData();

  const openInstallDialog = () => setSkillInstallOpen(true);
  const validateSkillInstall = async () => { setSkillInstallValidating(true); setSkillInstallValidating(false); };
  const installSkillsFromGitHub = async () => { setSkillInstallSaving(true); setSkillInstallSaving(false); };
  const refreshGitHubCatalog = async (_force?: boolean) => { await refetchGitHubCatalog(); };

  // Create dialog
  const [skillCreateOpen, setSkillCreateOpen] = createSignal(false);
  const [skillCreateScope, setSkillCreateScope] = createSignal('user');
  const [skillCreateName, setSkillCreateName] = createSignal('');
  const [skillCreateDescription, setSkillCreateDescription] = createSignal('');
  const [skillCreateBody, setSkillCreateBody] = createSignal('');
  const [skillCreateSaving, setSkillCreateSaving] = createSignal(false);
  const createSkill = async () => {};

  return (
    <>
      <SettingsCard
        icon={Layers}
        title="Skills"
        description="Manage Flower skills: install from GitHub, browse skill files, toggle enable state, and maintain local skills."
        badge={skillsReloading() || skillsLoading() ? 'Loading' : `${skillsCatalog()?.skills?.length ?? 0} skills`}
        error={skillsError()}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void refreshSkillsCatalog(true)} loading={skillsReloading()} disabled={!ctx.canInteract()}>Reload</Button>
            <Button size="sm" variant="default" onClick={openInstallDialog} disabled={!ctx.canInteract() || !ctx.canAdmin()}>Install from GitHub</Button>
            <Button size="sm" variant="default" onClick={() => setSkillCreateOpen(true)} disabled={!ctx.canInteract() || !ctx.canAdmin()}>Create Skill</Button>
          </>
        }
      >
        <div class="space-y-4">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div class="md:col-span-2">
              <FieldLabel>Search</FieldLabel>
              <Input value={skillQuery()} onInput={(e) => setSkillQuery(e.currentTarget.value)}
                placeholder="Search by name, description, or path" size="sm" class="w-full" disabled={!ctx.canInteract()} />
            </div>
            <div>
              <FieldLabel>Scope</FieldLabel>
              <Select value={skillScopeFilter()} onChange={(v) => setSkillScopeFilter(v as any)}
                disabled={!ctx.canInteract()}
                options={[{ value: 'all', label: 'All scopes' }, { value: 'user', label: 'User (.redeven)' }, { value: 'user_agents', label: 'User (.agents)' }]}
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
              <div class="text-xs font-semibold text-warning">Conflicts detected: {skillsCatalog()?.conflicts?.length ?? 0}</div>
              <For each={(skillsCatalog()?.conflicts ?? []).slice(0, 5)}>
                {(item: any) => <div class="break-all text-[11px] text-warning">{item.name}: {item.path}</div>}
              </For>
            </div>
          </Show>

          <Show when={(skillsCatalog()?.errors?.length ?? 0) > 0}>
            <div class="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <div class="text-xs font-semibold text-destructive">Catalog errors: {skillsCatalog()?.errors?.length ?? 0}</div>
              <For each={(skillsCatalog()?.errors ?? []).slice(0, 5)}>
                {(item: any) => <div class="break-all text-[11px] text-destructive">{item.path}: {item.message}</div>}
              </For>
            </div>
          </Show>
        </div>
      </SettingsCard>

      {/* Install dialog */}
      <Dialog open={skillInstallOpen()} onOpenChange={(open) => { setSkillInstallOpen(open); if (!open) setSkillInstallResolved([]); }}
        title="Install skills from GitHub"
        footer={
          <div class="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setSkillInstallOpen(false)} disabled={skillInstallSaving() || skillInstallValidating()}>Cancel</Button>
            <Button size="sm" variant="outline" onClick={() => void validateSkillInstall()} loading={skillInstallValidating()} disabled={!ctx.canInteract() || !ctx.canAdmin() || skillInstallSaving()}>Validate</Button>
            <Button size="sm" variant="default" onClick={() => void installSkillsFromGitHub()} loading={skillInstallSaving()} disabled={!ctx.canInteract() || !ctx.canAdmin()}>Install</Button>
          </div>
        }>
        <div class="space-y-4">
          <div><FieldLabel>Scope</FieldLabel><Select value={skillInstallScope()} onChange={(v) => setSkillInstallScope(v as any)} options={[{ value: 'user', label: 'User (.redeven)' }, { value: 'user_agents', label: 'User (.agents)' }]} class="w-full" /></div>
          <div><FieldLabel hint="preferred">GitHub URL</FieldLabel><Input value={skillInstallURL()} onInput={(e) => setSkillInstallURL(e.currentTarget.value)} placeholder="https://github.com/openai/skills/tree/main/skills/.curated/skill-installer" size="sm" class="w-full" /></div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><FieldLabel>repo</FieldLabel><Input value={skillInstallRepo()} onInput={(e) => setSkillInstallRepo(e.currentTarget.value)} placeholder="openai/skills" size="sm" class="w-full font-mono text-xs" /></div>
            <div><FieldLabel>ref</FieldLabel><Input value={skillInstallRef()} onInput={(e) => setSkillInstallRef(e.currentTarget.value)} placeholder="main" size="sm" class="w-full font-mono text-xs" /></div>
            <div class="md:col-span-2"><FieldLabel hint="comma or newline separated">paths</FieldLabel><textarea class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" style={{ 'min-height': '5rem' }} value={skillInstallPaths()} onInput={(e) => setSkillInstallPaths(e.currentTarget.value)} spellcheck={false} /></div>
          </div>
          <Checkbox checked={skillInstallOverwrite()} onChange={(v) => setSkillInstallOverwrite(v)} label="Overwrite existing skills if target already exists" size="sm" disabled={!ctx.canInteract() || !ctx.canAdmin()} />
        </div>
      </Dialog>

      {/* Create dialog */}
      <ConfirmDialog open={skillCreateOpen()} onOpenChange={(open) => setSkillCreateOpen(open)} title="Create skill" confirmText="Create" loading={skillCreateSaving()} onConfirm={() => void createSkill()}>
        <div class="space-y-3">
          <div><FieldLabel>Scope</FieldLabel><Select value={skillCreateScope()} onChange={(v) => setSkillCreateScope(v as any)} options={[{ value: 'user', label: 'User (.redeven)' }, { value: 'user_agents', label: 'User (.agents)' }]} class="w-full" /></div>
          <div><FieldLabel>Name</FieldLabel><Input value={skillCreateName()} onInput={(e) => setSkillCreateName(e.currentTarget.value)} placeholder="incident-response" size="sm" class="w-full" /></div>
          <div><FieldLabel>Description</FieldLabel><Input value={skillCreateDescription()} onInput={(e) => setSkillCreateDescription(e.currentTarget.value)} placeholder="Brief description" size="sm" class="w-full" /></div>
          <div><FieldLabel hint="optional">Initial body</FieldLabel><textarea class="w-full font-mono text-xs border border-border rounded-lg px-3 py-2.5 bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" style={{ 'min-height': '7rem' }} value={skillCreateBody()} onInput={(e) => setSkillCreateBody(e.currentTarget.value)} spellcheck={false} /></div>
        </div>
      </ConfirmDialog>
    </>
  );
}
