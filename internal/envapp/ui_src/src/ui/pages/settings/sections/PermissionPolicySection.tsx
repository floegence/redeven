import { For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import { Shield } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsCard, SettingsTable, SettingsTableHead, SettingsTableHeaderRow, SettingsTableHeaderCell,
  SettingsTableBody, SettingsTableRow, SettingsTableCell, ViewToggle,
  AutoSaveIndicator, JSONEditor, SubSectionHeader, CodeBadge, type ViewMode,
} from '../SettingsPrimitives';
import { PermissionMatrixTable, PermissionRuleTable } from '../PermissionPolicyTables';
import { buildPermissionPolicyValue } from '../permissionPolicy';
import { formatUnknownError } from '../../../maintenance/shared';
import type { PermissionPolicy, PermissionRow, PermissionSet } from '../types';

const AUTO_SAVE_DELAY_MS = 700;

function mapToPermissionRows(m: Record<string, PermissionSet> | undefined): PermissionRow[] {
  if (!m) return [];
  const keys = Object.keys(m);
  keys.sort();
  return keys.map((k) => ({ key: k, read: !!m[k]?.read, write: !!m[k]?.write, execute: !!m[k]?.execute }));
}

export function PermissionPolicySection() {
  const ctx = useEnvSettingsPage();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');
  const [localRead, setLocalRead] = createSignal(true);
  const [localWrite, setLocalWrite] = createSignal(false);
  const [localExecute, setLocalExecute] = createSignal(true);
  const [byUser, setByUser] = createSignal<PermissionRow[]>([]);
  const [byApp, setByApp] = createSignal<PermissionRow[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      const p = s?.permission_policy;
      setLocalRead(p?.local_max?.read ?? true);
      setLocalWrite(p?.local_max?.write ?? false);
      setLocalExecute(p?.local_max?.execute ?? true);
      setByUser(mapToPermissionRows(p?.by_user as any));
      setByApp(mapToPermissionRows(p?.by_app as any));
    }
  });

  // Clamp rows when local max tightens
  createEffect(() => {
    const r = localRead(), w = localWrite(), x = localExecute();
    setByUser((prev) => prev.map((it) => ({ ...it, read: r ? it.read : false, write: w ? it.write : false, execute: x ? it.execute : false })));
    setByApp((prev) => prev.map((it) => ({ ...it, read: r ? it.read : false, write: w ? it.write : false, execute: x ? it.execute : false })));
  });

  const jsonText = createMemo(() => JSON.stringify(buildPermissionPolicyValue(
    { read: localRead(), write: localWrite(), execute: localExecute() },
    byUser(),
    byApp(),
  ), null, 2));

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
        const body = buildPermissionPolicyValue(
          { read: localRead(), write: localWrite(), execute: localExecute() },
          byUser(),
          byApp(),
        );
        await ctx.saveSettings({ permission_policy: body });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || 'Save failed.');
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const switchView = (next: ViewMode) => setViewMode(next);

  return (
    <SettingsCard
      icon={Shield}
      title="Permission Policy"
      description="Control read, write, and execute permissions. Saved changes apply after a manual restart."
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
        fallback={<JSONEditor value={jsonText()} onChange={(v) => { try { const p = JSON.parse(v); if (p.local_max) { setLocalRead(p.local_max.read ?? true); setLocalWrite(p.local_max.write ?? false); setLocalExecute(p.local_max.execute ?? true); } setDirty(true); } catch {} }} disabled={!ctx.canInteract()} rows={12} />}
      >
        <div class="space-y-6">
          <div class="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
            <span class="text-xs text-muted-foreground">schema_version</span>
            <CodeBadge>1</CodeBadge>
          </div>

          <div class="space-y-3">
            <SubSectionHeader title="local_max" description="Global permission ceiling for this runtime. User and app rules are clamped to these limits." />
            <PermissionMatrixTable
              read={localRead()} write={localWrite()} execute={localExecute()}
              canInteract={ctx.canInteract()}
              onChange={(key, value) => { if (key === 'read') setLocalRead(value); else if (key === 'write') setLocalWrite(value); else setLocalExecute(value); setDirty(true); }}
            />
          </div>

          <div class="space-y-3">
            <SubSectionHeader title="by_user" description="Per-user permission overrides."
              actions={<Button size="sm" variant="outline" onClick={() => { setByUser((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]); setDirty(true); }} disabled={!ctx.canInteract()}>Add Rule</Button>} />
            <PermissionRuleTable rows={byUser()} emptyMessage="No user-specific overrides."
              keyHeader="User" keyPlaceholder="user_public_id" canInteract={ctx.canInteract()}
              readEnabled={localRead()} writeEnabled={localWrite()} executeEnabled={localExecute()}
              onChangeKey={(i, v) => { setByUser((prev) => prev.map((it, idx) => idx === i ? { ...it, key: v } : it)); setDirty(true); }}
              onChangePerm={(i, k, v) => { setByUser((prev) => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it)); setDirty(true); }}
              onRemove={(i) => { setByUser((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); }} />
          </div>

          <div class="space-y-3">
            <SubSectionHeader title="by_app" description="Per-application permission overrides."
              actions={<Button size="sm" variant="outline" onClick={() => { setByApp((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]); setDirty(true); }} disabled={!ctx.canInteract()}>Add Rule</Button>} />
            <PermissionRuleTable rows={byApp()} emptyMessage="No app-specific overrides."
              keyHeader="App" keyPlaceholder="floe_app identifier" canInteract={ctx.canInteract()}
              readEnabled={localRead()} writeEnabled={localWrite()} executeEnabled={localExecute()}
              onChangeKey={(i, v) => { setByApp((prev) => prev.map((it, idx) => idx === i ? { ...it, key: v } : it)); setDirty(true); }}
              onChangePerm={(i, k, v) => { setByApp((prev) => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it)); setDirty(true); }}
              onRemove={(i) => { setByApp((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); }} />
          </div>
        </div>
      </Show>
    </SettingsCard>
  );
}
