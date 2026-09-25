import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { Terminal, Plus, Trash, Home, FolderOpen } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog } from '../../../primitives/EnvAppModal';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, SettingsList, AutoSaveIndicator, DotIndicator, SettingRow } from '../SettingsPrimitives';
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
  const addRoot = () => { setRoots((prev: any) => [...prev, { id: nextCustomRootID(prev), label: '', path: '', kind: 'custom' as const, permissions: { read: true, write: false }, hidden: false, system: false }]); setError(null); setDirty(true); };
  const removeRoot = (index: number) => { setRoots((prev) => prev.filter((_, i) => i !== index)); setError(null); setDirty(true); };
  const requestWriteChange = (index: number, root: FilesystemRootPolicy, enable: boolean) => {
    if (!enable) { updateRootAt(index, (r) => ({ ...r, permissions: { ...r.permissions, write: false } })); return; }
    setWriteConfirmTarget({ index, root });
  };
  const confirmWriteAccess = () => {
    const target = writeConfirmTarget();
    if (target) { updateRootAt(target.index, (r) => ({ ...r, permissions: { ...r.permissions, write: true } })); }
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
            icon={Home}
            title={i18n.t('settingsDesign.homeDirectory')}
            description={i18n.t('uiCopy.runtime.homeDirectoryDescription')}
            control={
              <Input value={agentHomeDir()} onInput={(e) => { setAgentHomeDir(e.currentTarget.value); setError(null); setDirty(true); }}
                placeholder="/home/user" size="sm" class="w-full min-w-0 font-mono text-xs sm:w-64" disabled={!canEdit()} />
            }
          />
          <SettingRow
            icon={Terminal}
            title={i18n.t('settingsDesign.defaultShell')}
            description={i18n.t('uiCopy.runtime.shellDescription')}
            control={
              <Input value={shell()} onInput={(e) => { setShell(e.currentTarget.value); setError(null); setDirty(true); }}
                placeholder="/bin/bash" size="sm" class="w-full min-w-0 font-mono text-xs sm:w-64" disabled={!canEdit()} />
            }
          />
        </SettingsList>

        {/* Filesystem roots */}
        <div class="mt-5">
          <div class="flex items-center justify-between mb-3">
            <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{i18n.t('runtimeConfig.filesystemRootsTitle')}</div>
            <Button size="sm" variant="outline" icon={Plus} onClick={addRoot} disabled={!canEdit()}>{i18n.t('runtimeConfig.addRoot')}</Button>
          </div>
          <SettingsList>
            <For each={roots()}>
              {(root, index) => (
                <div class="redeven-settings-list-row px-4 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex min-w-0 flex-1 items-start gap-3">
                      <span class="redeven-setting-row__icon mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md">
                        {root.kind === 'home' ? <Home class="h-3.5 w-3.5" /> : <FolderOpen class="h-3.5 w-3.5" />}
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                          <code class="break-all text-[length:var(--floe-type-body)] font-mono font-medium text-foreground">{root.path}</code>
                          <span class="text-[10px] text-muted-foreground">{root.label || root.id}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-2">
                          <span class={root.system ? 'text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground' : 'text-[10px] bg-success/10 px-1.5 py-0.5 rounded text-success'}>
                            {root.system ? i18n.t('runtimeConfig.systemRoot') : i18n.t('runtimeConfig.customRoot')}
                          </span>
                          <DotIndicator active={Boolean(root.permissions?.read)} label={i18n.t('permissionPolicy.permission.read')} />
                          <DotIndicator active={Boolean(root.permissions?.write)} label={i18n.t('permissionPolicy.permission.write')} onClick={root.system ? undefined : () => requestWriteChange(index(), root, !root.permissions?.write)} />
                        </div>
                      </div>
                    </div>
                    <Show when={!root.system}>
                      <Button size="icon" variant="ghost" icon={Trash} class="text-muted-foreground hover:text-destructive"
                        onClick={() => removeRoot(index())} disabled={!canEdit()} aria-label={i18n.t('runtimeConfig.removeRoot')} />
                    </Show>
                  </div>
                  <Show when={!root.system}>
                    <div class="mt-2 border-t border-[var(--redeven-settings-divider)] pt-2">
                      <Input value={root.path} onInput={(e) => updateRootAt(index(), (r) => ({ ...r, path: e.currentTarget.value }))}
                        placeholder="/path/to/folder" size="sm" class="w-full font-mono text-xs" disabled={!canEdit()} />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </SettingsList>
          <p class="mt-2 text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.systemRootsNote')}</p>
        </div>
      </SettingsSection>

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
