import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { Terminal, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Input, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, AutoSaveIndicator, DotIndicator, SettingRow } from '../SettingsPrimitives';
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
            agent_home_dir: agentHomeDir() || null, shell: shell() || null,
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
    setRoots((prev) => prev.map((r, i) => (i === index ? fn(r) : r))); setDirty(true);
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
        {/* Shell environment card */}
        <div class="space-y-3">
          <SettingRow
            title="agent_home_dir"
            description="Runtime home directory used for local state and shell defaults."
            control={
              <Input value={agentHomeDir()} onInput={(e) => { setAgentHomeDir(e.currentTarget.value); setDirty(true); }}
                placeholder="/home/user" size="sm" class="w-full min-w-[16rem] font-mono text-xs sm:w-[28rem]" disabled={!ctx.canInteract()} />
            }
          />
          <SettingRow
            title="shell"
            description="Default shell executable used for new runtime terminal sessions."
            control={
              <Input value={shell()} onInput={(e) => { setShell(e.currentTarget.value); setDirty(true); }}
                placeholder="/bin/bash" size="sm" class="w-full min-w-[16rem] font-mono text-xs sm:w-[28rem]" disabled={!ctx.canInteract()} />
            }
          />
        </div>

        {/* Filesystem roots */}
        <div class="mt-5">
          <div class="flex items-center justify-between mb-3">
            <div class="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">文件系统根路径</div>
            <Button size="sm" variant="outline" icon={Plus} onClick={addRoot} disabled={!ctx.canInteract()}>{i18n.t('runtimeConfig.addRoot')}</Button>
          </div>
          <div class="space-y-2">
            <For each={roots()}>
              {(root, index) => (
                <div class="rounded-lg border border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)] px-4 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 mb-1">
                        <code class="text-sm font-mono font-semibold text-foreground">{root.path}</code>
                        <span class="text-[10px] text-muted-foreground">{root.label || root.id}</span>
                      </div>
                      <div class="flex items-center gap-2 mt-2">
                        <span class={root.system ? 'text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground' : 'text-[10px] bg-success/10 px-1.5 py-0.5 rounded text-success'}>
                          {root.system ? i18n.t('runtimeConfig.systemRoot') : i18n.t('runtimeConfig.customRoot')}
                        </span>
                        <DotIndicator active={Boolean(root.permissions?.read)} label="读" />
                        <DotIndicator active={Boolean(root.permissions?.write)} label="写" onClick={root.system ? undefined : () => requestWriteChange(index(), root, !root.permissions?.write)} />
                      </div>
                    </div>
                    <Show when={!root.system}>
                      <Button size="icon" variant="ghost" icon={Trash} class="text-muted-foreground hover:text-destructive"
                        onClick={() => removeRoot(index())} disabled={!ctx.canInteract()} aria-label={i18n.t('runtimeConfig.removeRoot')} />
                    </Show>
                  </div>
                  <Show when={!root.system}>
                    <div class="mt-2 pt-2 border-t border-border/30">
                      <Input value={root.path} onInput={(e) => updateRootAt(index(), (r) => ({ ...r, path: e.currentTarget.value }))}
                        placeholder="/path/to/folder" size="sm" class="w-full font-mono text-xs" disabled={!ctx.canInteract()} />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
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
          <p class="text-sm">{i18n.t('runtimeConfig.allowWritesDialogDescription')}</p>
          <p class="text-xs text-muted-foreground break-all">{i18n.t('runtimeConfig.rootLabel')}: {writeConfirmTarget()?.root.label || writeConfirmTarget()?.root.id || i18n.t('runtimeConfig.customRoot')}</p>
          <p class="text-xs text-muted-foreground break-all">{i18n.t('runtimeConfig.pathHeader')}: <span class="font-mono">{writeConfirmTarget()?.root.path || '-'}</span></p>
        </div>
      </ConfirmDialog>
    </>
  );
}
