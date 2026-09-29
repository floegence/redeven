import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { Download, Plus, Refresh, Search, Wand } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Select, Checkbox } from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog, Dialog } from '@floegence/floe-webapp-core/ui';
import { SettingsSection, FieldLabel } from './primitives';
import { SkillsCatalogList } from './SkillsCatalogList';
import { useFlowerExtensions } from './context';
import type { SkillCatalogEntry, SkillsCatalogResponse, SkillSourceItem, SkillGitHubValidateItem } from './types';
const formatUnknownError = (error: unknown) => error instanceof Error ? error.message : String(error);
import { SkillFilesDialog } from './SkillFilesDialog';

export function SkillsSection() {
  const ctx = useFlowerExtensions();
  const i18n = ctx.i18n;
  const [skillsData, setSkillsData] = createSignal<SkillsCatalogResponse | null>(null);
  const [sourcesData, setSourcesData] = createSignal<Record<string, SkillSourceItem>>({});
  const [skillsError, setSkillsError] = createSignal<string | null>(null);
  const [skillQuery, setSkillQuery] = createSignal('');
  const [skillScopeFilter, setSkillScopeFilter] = createSignal<'all' | 'user' | 'user_agents' | 'system'>('all');
  const [skillsReloading, setSkillsReloading] = createSignal(false);
  const [skillsLoading, setSkillsLoading] = createSignal(false);
  const [skillToggleSaving, setSkillToggleSaving] = createSignal<Record<string, boolean>>({});
  const [skillReinstalling, setSkillReinstalling] = createSignal<Record<string, boolean>>({});
  const skillsCatalog = skillsData;
  const skillSources = sourcesData;
  const canManage = () => ctx.canInteract() && ctx.canAdmin();
  const catalogBusy = () => skillsLoading() || skillsReloading() || actionSaving() || skillCreateSaving() || skillInstallSaving() || Object.values(skillToggleSaving()).some(Boolean);
  const canMutateCatalog = () => canManage() && !catalogBusy();
  const errorMessage = (error: unknown) => formatUnknownError(error) || i18n.t('settingsDesign.skillRequestFailed');
  const refetchSources = async () => {
    const response = await ctx.listSkillSources();
    setSourcesData(Object.fromEntries(response.items.map((item) => [item.skill_path, item])));
  };

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

  const refreshSkillsCatalog = async (reload = false) => {
    if (!ctx.canInteract() || catalogBusy()) return;
    if (reload) setSkillsReloading(true); else setSkillsLoading(true);
    setSkillsError(null);
    try {
      const catalog = await ctx.listSkills(reload);
      setSkillsData(catalog);
      await refetchSources();
    } catch (error) { setSkillsError(errorMessage(error)); }
    finally { setSkillsReloading(false); setSkillsLoading(false); }
  };
  createEffect(on(ctx.canInteract, (available) => {
    if (available && !skillsData()) void refreshSkillsCatalog();
  }));

  const toggleSkill = async (entry: SkillCatalogEntry, enabled: boolean) => {
    if (!canMutateCatalog()) return;
    setSkillToggleSaving((previous) => ({ ...previous, [entry.path]: true }));
    setSkillsError(null);
    try { setSkillsData(await ctx.toggleSkill(entry.path, enabled)); }
    catch (error) { setSkillsError(errorMessage(error)); }
    finally { setSkillToggleSaving((previous) => ({ ...previous, [entry.path]: false })); }
  };
  const [browsingSkill, setBrowsingSkill] = createSignal<SkillCatalogEntry | null>(null);
  const openSkillBrowse = (entry: SkillCatalogEntry) => { if (ctx.canInteract()) setBrowsingSkill(entry); };
  const [pendingAction, setPendingAction] = createSignal<{ kind: 'delete' | 'reinstall'; entry: SkillCatalogEntry } | null>(null);
  const [actionSaving, setActionSaving] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const askDeleteSkill = (entry: SkillCatalogEntry) => { if (canManage()) { setActionError(null); setPendingAction({ kind: 'delete', entry }); } };
  const reinstallSkill = (entry: SkillCatalogEntry) => { if (canManage()) { setActionError(null); setPendingAction({ kind: 'reinstall', entry }); } };
  const confirmAction = async () => {
    const action = pendingAction();
    if (!action || !canMutateCatalog()) return;
    setActionSaving(true); setActionError(null);
    if (action.kind === 'reinstall') setSkillReinstalling((previous) => ({ ...previous, [action.entry.path]: true }));
    try {
      if (action.kind === 'delete') setSkillsData(await ctx.deleteSkill({ scope: action.entry.scope, name: action.entry.name }));
      else {
        const result = await ctx.reinstallSkill(action.entry.path);
        setSkillsData(result.catalog);
      }
      setPendingAction(null);
      try { await refetchSources(); } catch (error) { setSkillsError(errorMessage(error)); }
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setActionSaving(false); setSkillReinstalling((previous) => ({ ...previous, [action.entry.path]: false })); }
  };

  // Install dialog
  const [skillInstallOpen, setSkillInstallOpen] = createSignal(false);
  const [skillInstallScope, setSkillInstallScope] = createSignal('user');
  const [skillInstallURL, setSkillInstallURL] = createSignal('');
  const [skillInstallRepo, setSkillInstallRepo] = createSignal('');
  const [skillInstallRef, setSkillInstallRef] = createSignal('main');
  const [skillInstallPaths, setSkillInstallPaths] = createSignal('');
  const [skillInstallOverwrite, setSkillInstallOverwrite] = createSignal(false);
  const [skillInstallResolved, setSkillInstallResolved] = createSignal<readonly SkillGitHubValidateItem[]>([]);
  const [skillInstallError, setSkillInstallError] = createSignal<string | null>(null);
  const [validatedRequest, setValidatedRequest] = createSignal('');
  const installRequest = createMemo(() => ({ scope: skillInstallScope(), url: skillInstallURL().trim(), repo: skillInstallRepo().trim(), ref: skillInstallRef().trim(), paths: skillInstallPaths().split(/[,\n]/).map((path) => path.trim()).filter(Boolean), overwrite: skillInstallOverwrite() }));
  const installValidated = () => validatedRequest() === JSON.stringify(installRequest()) && skillInstallResolved().length > 0;
  const [skillInstallSaving, setSkillInstallSaving] = createSignal(false);
  const [skillInstallValidating, setSkillInstallValidating] = createSignal(false);

  const openInstallDialog = () => { setSkillInstallError(null); setSkillInstallOpen(true); };
  const validateSkillInstall = async () => {
    if (!canManage() || skillInstallValidating() || skillInstallSaving()) return;
    const body = installRequest();
    setSkillInstallValidating(true); setSkillInstallError(null); setValidatedRequest('');
    try {
      const response = await ctx.validateSkillImport(body);
      setSkillInstallResolved(response.resolved); setValidatedRequest(JSON.stringify(body));
    } catch (error) { setSkillInstallError(errorMessage(error)); }
    finally { setSkillInstallValidating(false); }
  };
  const installSkillsFromGitHub = async () => {
    if (!canMutateCatalog() || !installValidated() || skillInstallValidating()) return;
    setSkillInstallSaving(true); setSkillInstallError(null);
    try {
      const result = await ctx.importSkills(installRequest());
      setSkillsData(result.catalog); setSkillInstallOpen(false); setValidatedRequest('');
      try { await refetchSources(); } catch (error) { setSkillsError(errorMessage(error)); }
    } catch (error) { setSkillInstallError(errorMessage(error)); }
    finally { setSkillInstallSaving(false); }
  };

  // Create dialog
  const [skillCreateOpen, setSkillCreateOpen] = createSignal(false);
  const [skillCreateScope, setSkillCreateScope] = createSignal('user');
  const [skillCreateName, setSkillCreateName] = createSignal('');
  const [skillCreateDescription, setSkillCreateDescription] = createSignal('');
  const [skillCreateBody, setSkillCreateBody] = createSignal('');
  const [skillCreateSaving, setSkillCreateSaving] = createSignal(false);
  const [skillCreateError, setSkillCreateError] = createSignal<string | null>(null);
  const createSkill = async () => {
    if (!canMutateCatalog() || !skillCreateName().trim() || !skillCreateDescription().trim()) return;
    setSkillCreateSaving(true); setSkillCreateError(null);
    try {
      setSkillsData(await ctx.createSkill({ scope: skillCreateScope(), name: skillCreateName().trim(), description: skillCreateDescription().trim(), body: skillCreateBody() }));
      setSkillCreateOpen(false); setSkillCreateName(''); setSkillCreateDescription(''); setSkillCreateBody('');
      try { await refetchSources(); } catch (error) { setSkillsError(errorMessage(error)); }
    } catch (error) { setSkillCreateError(errorMessage(error)); }
    finally { setSkillCreateSaving(false); }
  };

  return (
    <>
      <SettingsSection
        title={i18n.t('skillsSettings.title')}
        badge={skillsReloading() || skillsLoading() ? i18n.t('skillsSettings.loading') : i18n.tn('skillsSettings.skillCount', skillsCatalog()?.skills?.length ?? 0)}
        error={!skillsCatalog() ? skillsError() : null}
        feedback={skillsCatalog() && skillsError() ? [{ id: 'catalog', severity: 'error', summary: skillsError()!, actions: <Button size="sm" variant="outline" disabled={!ctx.canInteract() || catalogBusy()} onClick={() => void refreshSkillsCatalog()}>{i18n.t('common.actions.retry')}</Button> }] : []}
        actions={
          <>
            <Button size="sm" variant="ghost" icon={Download} onClick={openInstallDialog} disabled={!ctx.canInteract() || !ctx.canAdmin()}>{i18n.t('skillsSettings.installFromGitHub')}</Button>
            <Button size="sm" variant="default" icon={Plus} onClick={() => { setSkillCreateError(null); setSkillCreateOpen(true); }} disabled={!ctx.canInteract() || !ctx.canAdmin()}>{i18n.t('skillsSettings.createSkill')}</Button>
          </>
        }
      >
        <div class="flower-extension-section-body">
          <Show when={!skillsCatalog() && skillsError()}><Button size="sm" variant="outline" disabled={!ctx.canInteract() || catalogBusy()} onClick={() => void refreshSkillsCatalog()}>{i18n.t('common.actions.retry')}</Button></Show>
          <Show when={skillsCatalog()?.skills.length === 0}>
            <div class="flower-extension-empty"><span class="flower-extension-empty-icon"><Wand class="h-6 w-6" aria-hidden="true" /></span><h3>{i18n.t('skillEmpty')}</h3><p>{i18n.t('skillEmptyHint')}</p></div>
          </Show>
          <Show when={skillsCatalog()?.skills.length !== 0}>
          <div class="flower-extension-toolbar">
            <div class="flower-extension-search">
                <Search class="h-3.5 w-3.5" />
                <Input value={skillQuery()} onInput={(e) => setSkillQuery(e.currentTarget.value)}
                  aria-label={i18n.t('skillsSettings.searchLabel')} placeholder={i18n.t('skillsSettings.searchPlaceholder')} size="sm" class="w-full" disabled={!ctx.canInteract()} />
            </div>
            <div class="flower-extension-filter">
              <Select aria-label={i18n.t('skillsSettings.scopeLabel')} value={skillScopeFilter()} onChange={(v) => { if (v === 'all' || v === 'user' || v === 'user_agents' || v === 'system') setSkillScopeFilter(v); }}
                disabled={!ctx.canInteract()}
                options={[{ value: 'all', label: i18n.t('skillsSettings.scopeAll') }, { value: 'system', label: i18n.t('skillsSettings.source.systemBundle') }, { value: 'user', label: i18n.t('skillsSettings.scopeUserRedeven') }, { value: 'user_agents', label: i18n.t('skillsSettings.scopeUserAgents') }]}
                class="w-full" />
            </div>
            <Button size="icon" variant="ghost" icon={Refresh} aria-label={i18n.t('skillsSettings.reload')}
              onClick={() => void refreshSkillsCatalog(true)} loading={skillsReloading() || skillsLoading()} disabled={!ctx.canInteract() || catalogBusy()} />
          </div>

          <SkillsCatalogList
            skills={filteredSkills()} sources={skillSources()} loading={skillsLoading() && !skillsCatalog()}
            canInteract={ctx.canInteract()} canAdmin={canMutateCatalog()}
            toggleSaving={skillToggleSaving()} reinstalling={skillReinstalling()}
            onToggle={(entry, enabled) => { void toggleSkill(entry, enabled); }}
            onBrowse={openSkillBrowse} onReinstall={(entry) => { void reinstallSkill(entry); }}
            onDelete={askDeleteSkill} />
          <Show when={skillsCatalog() && filteredSkills().length === 0}>
            <Button variant="ghost" onClick={() => { setSkillQuery(''); setSkillScopeFilter('all'); }}>{i18n.t('clear')}</Button>
          </Show>
          </Show>

          <Show when={(skillsCatalog()?.conflicts?.length ?? 0) > 0}>
            <div class="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div class="text-xs font-semibold text-warning">{i18n.t('skillsSettings.conflictsDetected', { count: skillsCatalog()?.conflicts?.length ?? 0 })}</div>
              <For each={(skillsCatalog()?.conflicts ?? []).slice(0, 5)}>
                {(item) => <div class="break-all text-[11px] text-warning">{item.name}: {item.path}</div>}
              </For>
            </div>
          </Show>

          <Show when={(skillsCatalog()?.errors?.length ?? 0) > 0}>
            <div class="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <div class="text-xs font-semibold text-destructive">{i18n.t('skillsSettings.catalogErrors', { count: skillsCatalog()?.errors?.length ?? 0 })}</div>
              <For each={(skillsCatalog()?.errors ?? []).slice(0, 5)}>
                {(item) => <div class="break-all text-[11px] text-destructive">{item.path}: {item.message}</div>}
              </For>
            </div>
          </Show>
        </div>
      </SettingsSection>

      {/* Install dialog */}
      <Dialog open={skillInstallOpen()} onOpenChange={(open) => { if (!skillInstallSaving() && !skillInstallValidating()) { setSkillInstallOpen(open); if (!open) { setSkillInstallResolved([]); setValidatedRequest(''); } } }}
        class="flower-extension-dialog w-[min(42rem,94vw)]"
        title={i18n.t('skillsSettings.installDialogTitle')}
        footer={
          <div class="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setSkillInstallOpen(false)} disabled={skillInstallSaving() || skillInstallValidating()}>{i18n.t('common.actions.cancel')}</Button>
            <Button size="sm" variant="outline" onClick={() => void validateSkillInstall()} loading={skillInstallValidating()} disabled={!ctx.canInteract() || !ctx.canAdmin() || skillInstallSaving()}>{i18n.t('skillsSettings.validate')}</Button>
            <Button size="sm" variant="default" onClick={() => void installSkillsFromGitHub()} loading={skillInstallSaving()} disabled={!canMutateCatalog() || !installValidated() || skillInstallValidating()}>{i18n.t('skillsSettings.install')}</Button>
          </div>
        }>
        <Show when={skillInstallError()}><p role="alert" class="mb-4 text-[length:var(--floe-type-body)] text-destructive">{skillInstallError()}</p></Show>
        <fieldset disabled={!canManage() || skillInstallSaving() || skillInstallValidating()} class="space-y-4 min-w-0">
          <div><FieldLabel>{i18n.t('skillsSettings.scopeLabel')}</FieldLabel><Select aria-label={i18n.t('skillsSettings.scopeLabel')} value={skillInstallScope()} onChange={(v) => setSkillInstallScope(v)} options={[{ value: 'user', label: i18n.t('skillsSettings.scopeUserRedeven') }, { value: 'user_agents', label: i18n.t('skillsSettings.scopeUserAgents') }]} class="w-full" /></div>
          <div><FieldLabel hint={i18n.t('skillsSettings.preferredHint')}>{i18n.t('skillsSettings.githubUrlLabel')}</FieldLabel><Input aria-label={i18n.t('skillsSettings.githubUrlLabel')} value={skillInstallURL()} onInput={(e) => setSkillInstallURL(e.currentTarget.value)} placeholder="https://github.com/openai/skills/tree/main/skills/.curated/skill-installer" size="sm" class="w-full" /></div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><FieldLabel>{i18n.t('skillsSettings.repoLabel')}</FieldLabel><Input aria-label={i18n.t('skillsSettings.repoLabel')} value={skillInstallRepo()} onInput={(e) => setSkillInstallRepo(e.currentTarget.value)} placeholder="openai/skills" size="sm" class="w-full font-mono text-xs" /></div>
            <div><FieldLabel>{i18n.t('skillsSettings.refLabel')}</FieldLabel><Input aria-label={i18n.t('skillsSettings.refLabel')} value={skillInstallRef()} onInput={(e) => setSkillInstallRef(e.currentTarget.value)} placeholder="main" size="sm" class="w-full font-mono text-xs" /></div>
            <div class="md:col-span-2"><FieldLabel hint={i18n.t('skillsSettings.pathsHint')}>{i18n.t('skillsSettings.pathsLabel')}</FieldLabel><textarea class="flower-extension-control w-full resize-y rounded-lg border px-3 py-2.5 font-mono text-xs" style={{ 'min-height': '5rem' }} aria-label={i18n.t('skillsSettings.pathsLabel')} value={skillInstallPaths()} onInput={(e) => setSkillInstallPaths(e.currentTarget.value)} spellcheck={false} /></div>
          </div>
          <Checkbox checked={skillInstallOverwrite()} onChange={(v) => setSkillInstallOverwrite(v)} label={i18n.t('skillsSettings.overwriteExisting')} size="sm" disabled={!ctx.canInteract() || !ctx.canAdmin()} />
          <Show when={installValidated()}><div class="flower-extension-inset rounded-lg border p-4">
            <h3 class="text-sm font-medium">{i18n.t('settingsDesign.validatedSkills')}</h3>
            <For each={skillInstallResolved()}>{(item) => <div class="mt-3"><div class="text-[length:var(--floe-type-body)]">{item.name}</div><code class="break-all text-xs text-muted-foreground">{item.target_dir}</code></div>}</For>
          </div></Show>
        </fieldset>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={skillCreateOpen()} onOpenChange={(open) => { if (!skillCreateSaving()) setSkillCreateOpen(open); }} title={i18n.t('skillsSettings.createDialogTitle')} class="flower-extension-dialog w-[min(42rem,94vw)]"
        footer={<><Button variant="outline" onClick={() => setSkillCreateOpen(false)} disabled={skillCreateSaving()}>{i18n.t('common.actions.cancel')}</Button><Button onClick={() => void createSkill()} loading={skillCreateSaving()} disabled={!canMutateCatalog() || !skillCreateName().trim() || !skillCreateDescription().trim()}>{i18n.t('skillsSettings.create')}</Button></>}>
        <Show when={skillCreateError()}><p role="alert" class="mb-4 text-[length:var(--floe-type-body)] text-destructive">{skillCreateError()}</p></Show>
        <fieldset disabled={!canManage() || skillCreateSaving()} class="space-y-3 min-w-0">
          <div><FieldLabel>{i18n.t('skillsSettings.scopeLabel')}</FieldLabel><Select aria-label={i18n.t('skillsSettings.scopeLabel')} value={skillCreateScope()} onChange={(v) => setSkillCreateScope(v)} options={[{ value: 'user', label: i18n.t('skillsSettings.scopeUserRedeven') }, { value: 'user_agents', label: i18n.t('skillsSettings.scopeUserAgents') }]} class="w-full" /></div>
          <div><FieldLabel>{i18n.t('skillsSettings.nameLabel')}</FieldLabel><Input aria-label={i18n.t('skillsSettings.nameLabel')} value={skillCreateName()} onInput={(e) => setSkillCreateName(e.currentTarget.value)} placeholder="incident-response" size="sm" class="w-full" /></div>
          <div><FieldLabel>{i18n.t('skillsSettings.descriptionLabel')}</FieldLabel><Input aria-label={i18n.t('skillsSettings.descriptionLabel')} value={skillCreateDescription()} onInput={(e) => setSkillCreateDescription(e.currentTarget.value)} placeholder={i18n.t('skillsSettings.briefDescriptionPlaceholder')} size="sm" class="w-full" /></div>
          <div><FieldLabel hint={i18n.t('skillsSettings.optionalHint')}>{i18n.t('skillsSettings.initialBodyLabel')}</FieldLabel><textarea class="flower-extension-control w-full resize-y rounded-lg border px-3 py-2.5 font-mono text-xs" style={{ 'min-height': '7rem' }} aria-label={i18n.t('skillsSettings.initialBodyLabel')} value={skillCreateBody()} onInput={(e) => setSkillCreateBody(e.currentTarget.value)} spellcheck={false} /></div>
        </fieldset>
      </Dialog>
      <ConfirmDialog open={Boolean(pendingAction()) && canManage()} onOpenChange={(open) => { if (!open && !actionSaving()) setPendingAction(null); }}
        title={pendingAction()?.kind === 'delete' ? i18n.t('common.actions.delete') : i18n.t('skillsSettings.reinstall')}
        confirmText={pendingAction()?.kind === 'delete' ? i18n.t('common.actions.delete') : i18n.t('skillsSettings.reinstall')}
        cancelText={i18n.t('common.actions.cancel')} variant="destructive" loading={actionSaving()} onConfirm={confirmAction}>
        <p class="text-[length:var(--floe-type-body)]">{i18n.t(pendingAction()?.kind === 'delete' ? 'settingsDesign.skillDeleteDescription' : 'settingsDesign.skillReinstallDescription', { name: pendingAction()?.entry.name ?? '' })}</p>
        <Show when={actionError()}><p role="alert" class="mt-3 text-[length:var(--floe-type-body)] text-destructive">{actionError()}</p></Show>
      </ConfirmDialog>
      <SkillFilesDialog entry={browsingSkill()} onClose={() => setBrowsingSkill(null)} canInteract={ctx.canInteract()} />
    </>
  );
}
