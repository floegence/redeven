import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Terminal, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Checkbox, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsCard, SettingsTable, SettingsTableHead, SettingsTableHeaderRow, SettingsTableHeaderCell,
  SettingsTableBody, SettingsTableRow, SettingsTableCell, SettingsPill, ViewToggle,
  AutoSaveIndicator, JSONEditor, SubSectionHeader, type ViewMode,
} from '../SettingsPrimitives';
import { formatUnknownError } from '../../../maintenance/shared';
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
        const resp = await ctx.saveSettings({
          runtime: {
            agent_home_dir: agentHomeDir() || null,
            shell: shell() || null,
            filesystem_roots: roots().map((r) => ({ id: r.id, path: r.path, permissions: r.permissions, label: r.label })),
          },
        });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || 'Save failed.');
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
      <SettingsCard
        icon={Terminal}
        title="Shell & Workspace"
        description="Default shell and working directory for runtime-backed tools."
        badge="Manual restart required"
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
                <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
                <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
                <SettingsTableHeaderCell class="w-72">Notes</SettingsTableHeaderCell>
              </SettingsTableHeaderRow>
            </SettingsTableHead>
            <SettingsTableBody>
              <SettingsTableRow>
                <SettingsTableCell class="font-medium text-muted-foreground">agent_home_dir</SettingsTableCell>
                <SettingsTableCell>
                  <Input value={agentHomeDir()} onInput={(e) => { setAgentHomeDir(e.currentTarget.value); setDirty(true); }}
                    placeholder="/home/user" size="sm" class="w-full" disabled={!ctx.canInteract()} />
                </SettingsTableCell>
                <SettingsTableCell class="text-[11px] text-muted-foreground">Defaults to the user home directory if left empty.</SettingsTableCell>
              </SettingsTableRow>
              <SettingsTableRow>
                <SettingsTableCell class="font-medium text-muted-foreground">shell</SettingsTableCell>
                <SettingsTableCell>
                  <Input value={shell()} onInput={(e) => { setShell(e.currentTarget.value); setDirty(true); }}
                    placeholder="/bin/bash" size="sm" class="w-full" disabled={!ctx.canInteract()} />
                </SettingsTableCell>
                <SettingsTableCell class="text-[11px] text-muted-foreground">Defaults to `$SHELL` if left empty.</SettingsTableCell>
              </SettingsTableRow>
            </SettingsTableBody>
          </SettingsTable>

          <div class="mt-5">
            <SubSectionHeader title="Filesystem Roots" description="Directory-level file access exposed to Files, Git, Flower tools, and Code App."
              actions={<Button size="sm" variant="outline" icon={Plus} onClick={addRoot} disabled={!ctx.canInteract()}>Add Root</Button>} />
            <SettingsTable minWidthClass="min-w-[58rem]">
              <SettingsTableHead>
                <SettingsTableHeaderRow>
                  <SettingsTableHeaderCell class="w-52">Root</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-[22rem]">Path</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-36">Access</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-28">Type</SettingsTableHeaderCell>
                  <SettingsTableHeaderCell class="w-24" align="right">Actions</SettingsTableHeaderCell>
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
                            {root.permissions?.write ? 'Read/write' : 'Read-only'}
                          </SettingsPill>
                          <label class={`flex items-center gap-2 text-[11px] text-muted-foreground ${ctx.canInteract() && !root.system ? 'cursor-pointer' : ''}`}>
                            <Checkbox checked={Boolean(root.permissions?.write)}
                              onChange={(v) => requestWriteChange(index(), root, Boolean(v))} disabled={!ctx.canInteract() || root.system} />
                            Allow writes
                          </label>
                        </div>
                      </SettingsTableCell>
                      <SettingsTableCell class="text-[11px] text-muted-foreground">{root.system ? 'System' : 'Custom'}</SettingsTableCell>
                      <SettingsTableCell align="right">
                        <Button size="icon" variant="ghost" icon={Trash} aria-label="Remove root"
                          class={root.system ? 'opacity-40' : 'text-muted-foreground hover:text-destructive'}
                          onClick={() => removeRoot(index())} disabled={!ctx.canInteract() || root.system} />
                      </SettingsTableCell>
                    </SettingsTableRow>
                  )}
                </For>
              </SettingsTableBody>
            </SettingsTable>
            <div class="text-[11px] leading-relaxed text-muted-foreground mt-2">
              System roots are managed by the runtime. Custom roots require a manual restart after save.
            </div>
          </div>
        </Show>
      </SettingsCard>

      <ConfirmDialog
        open={Boolean(writeConfirmTarget())}
        onOpenChange={(open) => { if (!open) setWriteConfirmTarget(null); }}
        title="Allow filesystem writes?"
        confirmText="Allow writes"
        variant="destructive"
        onConfirm={confirmWriteAccess}
      >
        <div class="space-y-3">
          <p class="text-sm">This custom root will allow create, rename, overwrite, and delete operations from runtime file capabilities.</p>
          <p class="text-xs text-muted-foreground break-all">Root: {writeConfirmTarget()?.root.label || writeConfirmTarget()?.root.id || 'Custom Root'}</p>
          <p class="text-xs text-muted-foreground break-all">Path: <span class="font-mono">{writeConfirmTarget()?.root.path || '-'}</span></p>
        </div>
      </ConfirmDialog>
    </>
  );
}
