import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Terminal, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Checkbox, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsSection, SettingsTable, SettingsTableHead, SettingsTableHeaderRow, SettingsTableHeaderCell,
  SettingsTableBody, SettingsTableRow, SettingsTableCell, SettingsPill, ViewToggle,
  AutoSaveIndicator, JSONEditor, SubSectionHeader, type ViewMode,
} from '../SettingsPrimitives';
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

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');
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

  const jsonText = createMemo(() => JSON.stringify({
    agent_home_dir: agentHomeDir() || null,
    shell: shell() || null,
    filesystem_scope: { roots: roots() },
  }, null, 2));

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

  const switchView = (next: ViewMode) => setViewMode(next);

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
          <>
            <ViewToggle value={viewMode} disabled={!ctx.canInteract()} onChange={switchView} />
            <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
          </>
        }
      >
        <Show
          when={viewMode() === 'ui'}
          fallback={<JSONEditor value={jsonText()} onChange={(v) => { try { const p = JSON.parse(v); setAgentHomeDir(p.agent_home_dir ?? ''); setShell(p.shell ?? ''); setDirty(true); } catch {} }} disabled={!ctx.canInteract()} rows={5} />}
        >
          <SettingsTable minWidthClass="min-w-[42rem]">
            <SettingsTableHead>
              <SettingsTableHeaderRow>
                <SettingsTableHeaderCell class="w-48">{i18n.t('settings.table.setting')}</SettingsTableHeaderCell>
                <SettingsTableHeaderCell>{i18n.t('settings.table.value')}</SettingsTableHeaderCell>
                <SettingsTableHeaderCell class="w-72">{i18n.t('settings.table.notes')}</SettingsTableHeaderCell>
              </SettingsTableHeaderRow>
            </SettingsTableHead>
            <SettingsTableBody>
              <SettingsTableRow>
                <SettingsTableCell class="font-medium text-muted-foreground">agent_home_dir</SettingsTableCell>
                <SettingsTableCell>
                  <Input value={agentHomeDir()} onInput={(e) => { setAgentHomeDir(e.currentTarget.value); setDirty(true); }}
                    placeholder="/home/user" size="sm" class="w-full" disabled={!ctx.canInteract()} />
                </SettingsTableCell>
                <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.agentHomeDirNote')}</SettingsTableCell>
              </SettingsTableRow>
              <SettingsTableRow>
                <SettingsTableCell class="font-medium text-muted-foreground">shell</SettingsTableCell>
                <SettingsTableCell>
                  <Input value={shell()} onInput={(e) => { setShell(e.currentTarget.value); setDirty(true); }}
                    placeholder="/bin/bash" size="sm" class="w-full" disabled={!ctx.canInteract()} />
                </SettingsTableCell>
                <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeConfig.shellNote')}</SettingsTableCell>
              </SettingsTableRow>
            </SettingsTableBody>
          </SettingsTable>

          <div class="mt-5">
            <SubSectionHeader title={i18n.t('runtimeConfig.filesystemRootsTitle')} description={i18n.t('runtimeConfig.filesystemRootsDescription')}
              actions={<Button size="sm" variant="outline" icon={Plus} onClick={addRoot} disabled={!ctx.canInteract()}>{i18n.t('runtimeConfig.addRoot')}</Button>} />
            <SettingsTable minWidthClass="min-w-[58rem]">
              <SettingsTableHead>
                <SettingsTableHeaderRow>
                  <SettingsTableHeaderCell class="w-52">{i18n.t('runtimeConfig.rootHeader')}</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-[22rem]">{i18n.t('runtimeConfig.pathHeader')}</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-36">{i18n.t('runtimeConfig.accessHeader')}</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-28">{i18n.t('runtimeConfig.typeHeader')}</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-24" align="right">{i18n.t('settings.table.actions')}</SettingsTableHeaderCell>
                </SettingsTableHeaderRow>
              </SettingsTableHead>
              <SettingsTableBody>
                <For each={roots()}>
                  {(root, index) => (
                    <SettingsTableRow>
                      <SettingsTableCell>
                        <div class="space-y-1">
                          <Input value={root.label || root.id} onInput={(e) => updateRootAt(index(), (r) => ({ ...r, label: e.currentTarget.value }))}
                            size="sm" class="w-full" disabled={!ctx.canInteract() || root.system} />
                          <div class="font-mono text-[11px] text-muted-foreground">{root.id}</div>
                        </div>
                      </SettingsTableCell>
                      <SettingsTableCell>
                        <Input value={root.path} onInput={(e) => updateRootAt(index(), (r) => ({ ...r, path: e.currentTarget.value }))}
                          placeholder="/path/to/folder" size="sm" class="w-full font-mono text-[11px]" disabled={!ctx.canInteract() || root.system} />
                      </SettingsTableCell>
                      <SettingsTableCell>
                        <div class="space-y-1.5">
                          <SettingsPill tone={root.permissions?.write ? 'success' : 'warning'}>
                            {root.permissions?.write ? i18n.t('runtimeConfig.readWrite') : i18n.t('runtimeConfig.readOnly')}
                          </SettingsPill>
                          <label class={`flex items-center gap-2 text-[11px] text-muted-foreground ${ctx.canInteract() && !root.system ? 'cursor-pointer' : ''}`}>
                            <Checkbox checked={Boolean(root.permissions?.write)}
                              onChange={(v) => requestWriteChange(index(), root, Boolean(v))} disabled={!ctx.canInteract() || root.system} />
                            {i18n.t('runtimeConfig.allowWrites')}
                          </label>
                        </div>
                      </SettingsTableCell>
                      <SettingsTableCell class="text-[11px] text-muted-foreground">{root.system ? i18n.t('runtimeConfig.systemRoot') : i18n.t('runtimeConfig.customRoot')}</SettingsTableCell>
                      <SettingsTableCell align="right">
                        <Button size="icon" variant="ghost" icon={Trash} aria-label={i18n.t('runtimeConfig.removeRoot')}
                          class={root.system ? 'opacity-40' : 'text-muted-foreground hover:text-destructive'}
                          onClick={() => removeRoot(index())} disabled={!ctx.canInteract() || root.system} />
                      </SettingsTableCell>
                    </SettingsTableRow>
                  )}
                </For>
              </SettingsTableBody>
            </SettingsTable>
            <div class="text-[11px] leading-relaxed text-muted-foreground mt-2">
              {i18n.t('runtimeConfig.systemRootsNote')}
            </div>
          </div>
        </Show>
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
