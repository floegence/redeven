import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { Terminal, Plus, Trash, Home, MonitorPointer, Folder, Pencil } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Switch } from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog, Dialog } from '../../../primitives/EnvAppModal';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, SettingsList, AutoSaveIndicator, SettingRow, SubSectionHeader } from '../SettingsPrimitives';
import { formatUnknownError } from '../../../maintenance/shared';
import { useI18n } from '../../../i18n';
import type { FilesystemRootPolicy } from '../types';
import { normalizeFilesystemScopeDraft } from '../../../services/filesystemScopeSettings';

const AUTO_SAVE_DELAY_MS = 700;

function nextCustomRootID(roots: readonly FilesystemRootPolicy[]): string {
  const ids = new Set(roots.map((r) => String(r.id ?? '').trim()).filter(Boolean));
  for (let i = 1; i < 1000; i++) { const c = i === 1 ? 'custom' : `custom-${i}`; if (!ids.has(c)) return c; }
  return `custom-${Date.now()}`;
}

export function RuntimeConfigSection() {
  const ctx = useEnvSettingsPage();
  const canEdit = () => ctx.canInteract() && ctx.canAdmin();
  const i18n = useI18n();

  const [agentHomeDir, setAgentHomeDir] = createSignal('');
  const [shell, setShell] = createSignal('');
  const [roots, setRoots] = createSignal<FilesystemRootPolicy[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [rootEditor, setRootEditor] = createSignal<{ id: string; label: string; path: string; isNew: boolean } | null>(null);
  const [writeConfirmTarget, setWriteConfirmTarget] = createSignal<{ index: number; root: FilesystemRootPolicy } | null>(null);

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      setAgentHomeDir(String(s.runtime?.agent_home_dir ?? ''));
      setShell(String(s.runtime?.shell ?? ''));
      setRoots([...normalizeFilesystemScopeDraft(String(s.runtime?.agent_home_dir ?? ''), s.runtime?.filesystem_scope).roots]);
    }
  });

  let autoSaveTimer: number | undefined;
  const clearTimer = (t: number | undefined) => { if (t != null) { window.clearTimeout(t); return undefined; } return undefined; };

  createEffect(() => {
    if (!dirty() || saving() || error() || !canEdit()) { autoSaveTimer = clearTimer(autoSaveTimer); return; }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || error() || !canEdit()) return;
      setSaving(true);
      try {
        await ctx.saveSettings({
          agent_home_dir: agentHomeDir().trim(), shell: shell().trim(),
          filesystem_scope: {
            ...normalizeFilesystemScopeDraft(agentHomeDir(), ctx.settings()?.runtime.filesystem_scope),
            roots: roots().map((root) => ({ ...root, path: root.kind === 'home' ? agentHomeDir().trim() || '~' : root.path })),
          },
        });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || i18n.t('runtimeConfig.saveFailed'));
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const updateRootAt = (index: number, fn: (r: FilesystemRootPolicy) => FilesystemRootPolicy) => {
    setRoots((prev) => prev.map((r, i) => (i === index ? fn(r) : r))); setError(null); setDirty(true);
  };
  const addRoot = () => setRootEditor({ id: nextCustomRootID(roots()), label: '', path: '', isNew: true });
  const saveRoot = () => {
    const draft = rootEditor();
    if (!draft || !canEdit() || !draft.path.trim()) return;
    if (draft.isNew) setRoots(previous => [...previous, { id: draft.id, label: draft.label.trim(), path: draft.path.trim(), kind: 'custom', permissions: { read: true, write: false }, system: false }]);
    else setRoots(previous => previous.map(root => root.id === draft.id ? { ...root, label: draft.label.trim(), path: draft.path.trim() } : root));
    setError(null); setDirty(true); setRootEditor(null);
  };
  const removeRoot = (index: number) => { setRoots((prev) => prev.filter((_, i) => i !== index)); setError(null); setDirty(true); };
  const requestWriteChange = (index: number, root: FilesystemRootPolicy, enable: boolean) => {
    if (!canEdit() || root.system) return;
    if (!enable) { updateRootAt(index, (r) => ({ ...r, permissions: { ...r.permissions, write: false } })); return; }
    setWriteConfirmTarget({ index, root });
  };
  const confirmWriteAccess = () => {
    const target = writeConfirmTarget();
    if (target && canEdit()) { updateRootAt(target.index, (r) => ({ ...r, permissions: { ...r.permissions, write: true } })); }
    setWriteConfirmTarget(null);
  };

  return (
    <>
      <SettingsSection
      variant="page"
        icon={Terminal}
        title={i18n.t('runtimeConfig.title')}
        description={i18n.t('runtimeConfig.description')}
        badge={i18n.t('runtimeConfig.manualRestartRequired')}
        badgeVariant="warning"
        error={error()}
        actions={
          <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={canEdit()} />
        }
      >
        {/* Shell environment card */}
        <SettingsList>
          <SettingRow
            title={i18n.t('settingsDesign.homeDirectory')}
            description={i18n.t('uiCopy.runtime.homeDirectoryDescription')}
            control={
              <Input value={agentHomeDir()} onInput={(e) => { setAgentHomeDir(e.currentTarget.value); setError(null); setDirty(true); }}
                placeholder="/home/user" size="sm" class="w-full min-w-0 font-mono text-xs sm:w-64" disabled={!canEdit()} />
            }
          />
          <SettingRow
            title={i18n.t('settingsDesign.defaultShell')}
            description={i18n.t('uiCopy.runtime.shellDescription')}
            control={
              <Input value={shell()} onInput={(e) => { setShell(e.currentTarget.value); setError(null); setDirty(true); }}
                placeholder="/bin/bash" size="sm" class="w-full min-w-0 font-mono text-xs sm:w-64" disabled={!canEdit()} />
            }
          />
        </SettingsList>

        {/* Filesystem roots */}
        <div class="space-y-3">
          <SubSectionHeader title={i18n.t('runtimeConfig.filesystemRootsTitle')}
            actions={<Button size="sm" variant="ghost" icon={Plus} onClick={addRoot} disabled={!canEdit()}>{i18n.t('runtimeConfig.addRoot')}</Button>} />
          <SettingsList>
            <For each={roots()}>
              {(root, index) => (
                <SettingRow class="runtime-filesystem-root"
                  icon={root.kind === 'home' ? Home : root.kind === 'computer' ? MonitorPointer : Folder}
                  title={root.kind === 'home' ? i18n.t('settingsDesign.homeDirectory') : root.kind === 'computer' ? i18n.t('settingsDesign.computerRoot') : root.label || i18n.t('runtimeConfig.customRoot')}
                  description={root.kind === 'home' ? agentHomeDir() || '~' : root.path}
                  control={<div class="settings-row-actions">
                    <Show when={root.system} fallback={
                      <Switch label={i18n.t('runtimeConfig.allowWrites')} labelPosition="left"
                        checked={Boolean(root.permissions?.write)} disabled={!canEdit()}
                        onChange={(value) => requestWriteChange(index(), root, value)} />
                    }>
                      <span class="text-xs text-muted-foreground">{i18n.t(root.permissions?.write ? 'runtimeConfig.readWrite' : 'runtimeConfig.readOnly')}</span>
                    </Show>
                    <Show when={!root.system}>
                      <Button size="icon" variant="ghost" icon={Pencil} disabled={!canEdit()} aria-label={i18n.t('settingsDesign.editDirectory')}
                        onClick={() => setRootEditor({ id: root.id, label: root.label, path: root.path, isNew: false })} />
                      <Button size="icon" variant="ghost" icon={Trash} class="text-muted-foreground hover:text-destructive"
                      onClick={() => removeRoot(index())} disabled={!canEdit()} aria-label={i18n.t('runtimeConfig.removeRoot')} /></Show>
                  </div>}
                />
              )}
            </For>
          </SettingsList>
          <p class="mt-2 text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.systemRootsNote')}</p>
        </div>
      </SettingsSection>

      <Dialog open={Boolean(rootEditor())} onOpenChange={(open) => { if (!open) setRootEditor(null); }}
        title={i18n.t(rootEditor()?.isNew ? 'runtimeConfig.addRoot' : 'settingsDesign.editDirectory')}
        class="redeven-settings-dialog w-[min(30rem,94vw)]"
        footer={<div class="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRootEditor(null)}>{i18n.t('common.actions.cancel')}</Button>
          <Button disabled={!canEdit() || !rootEditor()?.path.trim()} onClick={saveRoot}>{i18n.t('common.actions.save')}</Button>
        </div>}>
        <div class="space-y-4">
          <label class="block space-y-2 text-xs"><span>{i18n.t('runtimeConfig.rootLabel')}</span>
            <Input value={rootEditor()?.label ?? ''} disabled={!canEdit()} class="w-full"
              onInput={e => setRootEditor(value => value ? { ...value, label: e.currentTarget.value } : null)} />
          </label>
          <label class="block space-y-2 text-xs"><span>{i18n.t('runtimeConfig.pathHeader')}</span>
            <Input value={rootEditor()?.path ?? ''} disabled={!canEdit()} class="w-full font-mono" placeholder="/path/to/folder"
              onInput={e => setRootEditor(value => value ? { ...value, path: e.currentTarget.value } : null)} />
          </label>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(writeConfirmTarget())}
        onOpenChange={(open) => { if (!open) setWriteConfirmTarget(null); }}
        title={i18n.t('runtimeConfig.allowWritesDialogTitle')}
        confirmText={i18n.t('runtimeConfig.allowWrites')}
        variant="destructive"
        onConfirm={confirmWriteAccess}
      >
        <div class="space-y-3">
          <p class="text-[length:var(--floe-type-body)]">{i18n.t('runtimeConfig.allowWritesDialogDescription')}</p>
          <p class="text-xs text-muted-foreground break-all">{i18n.t('runtimeConfig.rootLabel')}: {writeConfirmTarget()?.root.label || writeConfirmTarget()?.root.id || i18n.t('runtimeConfig.customRoot')}</p>
          <p class="text-xs text-muted-foreground break-all">{i18n.t('runtimeConfig.pathHeader')}: <span class="font-mono">{writeConfirmTarget()?.root.path || '-'}</span></p>
        </div>
      </ConfirmDialog>
    </>
  );
}
