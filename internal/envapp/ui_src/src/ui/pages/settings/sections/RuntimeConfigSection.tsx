import { For, createSignal, createEffect, onCleanup } from 'solid-js';
import { Terminal, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Input, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, AutoSaveIndicator, CardRow, DotIndicator } from '../SettingsPrimitives';
import { formatUnknownError } from '../../../maintenance/shared';
import { useI18n } from '../../../i18n';
import type { FilesystemRootPolicy, FilesystemScope } from '../types';

const AUTO_SAVE_DELAY_MS = 700;

function runtimeFilesystemRoots(agentHomeDir: string, scope: FilesystemScope | null): readonly FilesystemRootPolicy[] {
  if (scope?.roots?.length) return scope.roots;
  const home = String(agentHomeDir ?? '').trim();
  return [
    { id: 'home', label: 'Home', path: home || '~', kind: 'home', permissions: { read: true, write: true }, system: true },
    { id: 'computer', label: 'Computer', path: '/', kind: 'computer', permissions: { read: true, write: false }, system: true },
  ];
}

function cloneFilesystemRoot(root: FilesystemRootPolicy): FilesystemRootPolicy {
  return {
    id: String(root.id ?? ''), label: String(root.label ?? ''), path: String(root.path ?? ''),
    kind: root.kind, permissions: { read: Boolean(root.permissions?.read), write: Boolean(root.permissions?.write) },
    hidden: Boolean(root.hidden), system: Boolean(root.system),
  };
}

function nextCustomRootID(roots: readonly FilesystemRootPolicy[]): string {
  const ids = new Set(roots.map((r) => String(r.id ?? '').trim()).filter(Boolean));
  for (let i = 1; i < 1000; i++) { const c = i === 1 ? 'custom' : `custom-${i}`; if (!ids.has(c)) return c; }
  return `custom-${Date.now()}`;
}

export function RuntimeConfigSection() {
  const ctx = useEnvSettingsPage();
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
      setRoots(runtimeFilesystemRoots(String(s.runtime?.agent_home_dir ?? ''), s.runtime?.filesystem_scope ?? null).map(cloneFilesystemRoot));
    }
  });

  let autoSaveTimer: number | undefined;
  const clearTimer = (t: number | undefined) => { if (t != null) { window.clearTimeout(t); return undefined; } return undefined; };

  createEffect(() => {
    if (!dirty() || saving() || !ctx.canInteract()) { autoSaveTimer = clearTimer(autoSaveTimer); return; }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || !ctx.canInteract()) return;
      setSaving(true);
      try {
        await ctx.saveSettings({
          runtime: {
            agent_home_dir: agentHomeDir() || null,
            shell: shell() || null,
            filesystem_roots: roots().map((r) => ({ id: r.id, path: r.path, permissions: r.permissions, label: r.label })),
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
    setRoots((prev) => prev.map((r, i) => (i === index ? fn(r) : r)));
    setDirty(true);
  };
  const addRoot = () => { setRoots((prev: any) => [...prev, { id: nextCustomRootID(prev), label: '', path: '', kind: 'custom' as const, permissions: { read: true, write: false }, hidden: false, system: false }]); setDirty(true); };
  const removeRoot = (index: number) => { setRoots((prev) => prev.filter((_, i) => i !== index)); setDirty(true); };
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
        icon={Terminal}
        title={i18n.t('runtimeConfig.title')}
        description={i18n.t('runtimeConfig.description')}
        badge={i18n.t('runtimeConfig.manualRestartRequired')}
        badgeVariant="warning"
        error={error()}
        actions={
          <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
        }
      >
        <div class="space-y-5">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div class="sm:max-w-[45%]">
              <label class="text-xs font-medium text-foreground">agent_home_dir</label>
              <p class="mt-0.5 text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.agentHomeDirNote')}</p>
            </div>
            <Input value={agentHomeDir()} onInput={(e) => { setAgentHomeDir(e.currentTarget.value); setDirty(true); }}
              placeholder="/home/user" size="sm" class="sm:w-56" disabled={!ctx.canInteract()} />
          </div>
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div class="sm:max-w-[45%]">
              <label class="text-xs font-medium text-foreground">shell</label>
              <p class="mt-0.5 text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.shellNote')}</p>
            </div>
            <Input value={shell()} onInput={(e) => { setShell(e.currentTarget.value); setDirty(true); }}
              placeholder="/bin/bash" size="sm" class="sm:w-56" disabled={!ctx.canInteract()} />
          </div>
        </div>

        <div class="mt-6 pt-5 border-t border-border/20 space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold text-foreground">{i18n.t('runtimeConfig.filesystemRootsTitle')}</div>
              <p class="mt-0.5 text-xs text-muted-foreground">{i18n.t('runtimeConfig.filesystemRootsDescription')}</p>
            </div>
            <Button size="sm" variant="outline" icon={Plus} onClick={addRoot} disabled={!ctx.canInteract()}>{i18n.t('runtimeConfig.addRoot')}</Button>
          </div>

          <For each={roots()}>
            {(root, index) => (
              <CardRow
                label={
                  <div class="flex items-center gap-1.5">
                    <span>{root.label || root.id}</span>
                    <code class="text-[10px] font-mono text-muted-foreground">{root.id}</code>
                  </div>
                }
                badge={root.system ? i18n.t('runtimeConfig.systemRoot') : i18n.t('runtimeConfig.customRoot')}
                badgeTone={root.system ? 'default' : 'success'}
                actions={
                  <Button size="icon" variant="ghost" icon={Trash} aria-label={i18n.t('runtimeConfig.removeRoot')}
                    class={root.system ? 'invisible' : 'text-muted-foreground hover:text-destructive'}
                    onClick={() => removeRoot(index())} disabled={!ctx.canInteract() || root.system} />
                }
              >
                <div class="space-y-2">
                  <Input value={root.path} onInput={(e) => updateRootAt(index(), (r) => ({ ...r, path: e.currentTarget.value }))}
                    placeholder="/path/to/folder" size="sm" class="w-full font-mono text-xs" disabled={!ctx.canInteract() || root.system} />
                  <div class="flex items-center gap-4">
                    <DotIndicator active={Boolean(root.permissions?.read)} label={i18n.t('permissionPolicy.permission.read')} />
                    <DotIndicator active={Boolean(root.permissions?.write)} label={i18n.t('permissionPolicy.permission.write')} onClick={root.system ? undefined : () => requestWriteChange(index(), root, !root.permissions?.write)} />
                  </div>
                </div>
              </CardRow>
            )}
          </For>
          <p class="text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.systemRootsNote')}</p>
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
          <p class="text-sm">{i18n.t('runtimeConfig.allowWritesDialogDescription')}</p>
          <p class="text-xs text-muted-foreground break-all">{i18n.t('runtimeConfig.rootLabel')}: {writeConfirmTarget()?.root.label || writeConfirmTarget()?.root.id || i18n.t('runtimeConfig.customRoot')}</p>
          <p class="text-xs text-muted-foreground break-all">{i18n.t('runtimeConfig.pathHeader')}: <span class="font-mono">{writeConfirmTarget()?.root.path || '-'}</span></p>
        </div>
      </ConfirmDialog>
    </>
  );
}
