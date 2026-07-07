import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { Shield, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, AutoSaveIndicator, SubSectionHeader, PermissionDot, SettingRow } from '../SettingsPrimitives';
import { buildPermissionPolicyValue } from '../permissionPolicy';
import { formatUnknownError } from '../../../maintenance/shared';
import { useI18n } from '../../../i18n';
import type { PermissionRow, PermissionSet } from '../types';

const AUTO_SAVE_DELAY_MS = 700;

function mapToPermissionRows(m: Record<string, PermissionSet> | undefined): PermissionRow[] {
  if (!m) return [];
  const keys = Object.keys(m);
  keys.sort();
  return keys.map((k) => ({ key: k, read: !!m[k]?.read, write: !!m[k]?.write, execute: !!m[k]?.execute }));
}

export function PermissionPolicySection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

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

  createEffect(() => {
    const r = localRead(), w = localWrite(), x = localExecute();
    setByUser((prev) => prev.map((it) => ({ ...it, read: r ? it.read : false, write: w ? it.write : false, execute: x ? it.execute : false })));
    setByApp((prev) => prev.map((it) => ({ ...it, read: r ? it.read : false, write: w ? it.write : false, execute: x ? it.execute : false })));
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
        const body = buildPermissionPolicyValue(
          { read: localRead(), write: localWrite(), execute: localExecute() },
          byUser(), byApp(),
        );
        await ctx.saveSettings({ permission_policy: body });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || i18n.t('permissionPolicy.saveFailed'));
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const addUserRule = () => {
    setByUser((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]);
    setDirty(true);
  };
  const addAppRule = () => {
    setByApp((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]);
    setDirty(true);
  };

  return (
    <SettingsSection
      icon={Shield}
      title={i18n.t('permissionPolicy.title')}
      description={i18n.t('permissionPolicy.description')}
      badge={i18n.t('permissionPolicy.manualRestartRequired')}
      badgeVariant="warning"
      error={error()}
      actions={
        <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
      }
    >
      {/* local_max matrix card */}
      <SettingRow
        title="local_max"
        description={i18n.t('permissionPolicy.localMaxDescription')}
        tone="warning"
        control={
          <PermissionDot
            read={localRead()} write={localWrite()} execute={localExecute()}
            onReadChange={ctx.canInteract() ? (v) => { setLocalRead(v); setDirty(true); } : undefined}
            onWriteChange={ctx.canInteract() ? (v) => { setLocalWrite(v); setDirty(true); } : undefined}
            onExecuteChange={ctx.canInteract() ? (v) => { setLocalExecute(v); setDirty(true); } : undefined}
          />
        }
      />

      {/* by_user rules */}
      <div class="mt-5">
        <SubSectionHeader title="by_user" description={i18n.t('permissionPolicy.byUserDescription')}
          actions={<Button size="sm" variant="outline" onClick={addUserRule} disabled={!ctx.canInteract()}>{i18n.t('permissionPolicy.addRule')}</Button>} />
        <div class="mt-3 space-y-1.5">
          <Show when={byUser().length > 0} fallback={<p class="text-[11px] text-muted-foreground py-2">{i18n.t('permissionPolicy.noUserOverrides')}</p>}>
            <For each={byUser()}>
              {(row, index) => (
                <div class="flex flex-col gap-3 rounded-lg border border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)] px-3 py-2 sm:flex-row sm:items-center">
                  <Input value={row.key} onInput={(e) => { setByUser((prev) => prev.map((it, i) => i === index() ? { ...it, key: e.currentTarget.value } : it)); setDirty(true); }}
                    placeholder="user_public_id" size="sm" class="min-w-0 flex-1 font-mono text-xs" disabled={!ctx.canInteract()} />
                  <PermissionDot read={row.read} write={row.write} execute={row.execute}
                    readonly={!ctx.canInteract()}
                    onReadChange={localRead() && ctx.canInteract() ? (v) => { setByUser((prev) => prev.map((it, i) => i === index() ? { ...it, read: v } : it)); setDirty(true); } : undefined}
                    onWriteChange={localWrite() && ctx.canInteract() ? (v) => { setByUser((prev) => prev.map((it, i) => i === index() ? { ...it, write: v } : it)); setDirty(true); } : undefined}
                    onExecuteChange={localExecute() && ctx.canInteract() ? (v) => { setByUser((prev) => prev.map((it, i) => i === index() ? { ...it, execute: v } : it)); setDirty(true); } : undefined} />
                  <Button size="icon" variant="ghost" icon={Trash} class="text-muted-foreground hover:text-destructive" onClick={() => { setByUser((prev) => prev.filter((_, i) => i !== index())); setDirty(true); }} disabled={!ctx.canInteract()} aria-label={i18n.t('permissionPolicy.removeRuleAria', { subject: row.key || i18n.t('permissionPolicy.userHeader') })} />
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* by_app rules */}
      <div class="mt-5">
        <SubSectionHeader title="by_app" description={i18n.t('permissionPolicy.byAppDescription')}
          actions={<Button size="sm" variant="outline" onClick={addAppRule} disabled={!ctx.canInteract()}>{i18n.t('permissionPolicy.addRule')}</Button>} />
        <div class="mt-3 space-y-1.5">
          <Show when={byApp().length > 0} fallback={<p class="text-[11px] text-muted-foreground py-2">{i18n.t('permissionPolicy.noAppOverrides')}</p>}>
            <For each={byApp()}>
              {(row, index) => (
                <div class="flex flex-col gap-3 rounded-lg border border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)] px-3 py-2 sm:flex-row sm:items-center">
                  <Input value={row.key} onInput={(e) => { setByApp((prev) => prev.map((it, i) => i === index() ? { ...it, key: e.currentTarget.value } : it)); setDirty(true); }}
                    placeholder="floe_app identifier" size="sm" class="min-w-0 flex-1 font-mono text-xs" disabled={!ctx.canInteract()} />
                  <PermissionDot read={row.read} write={row.write} execute={row.execute}
                    readonly={!ctx.canInteract()}
                    onReadChange={localRead() && ctx.canInteract() ? (v) => { setByApp((prev) => prev.map((it, i) => i === index() ? { ...it, read: v } : it)); setDirty(true); } : undefined}
                    onWriteChange={localWrite() && ctx.canInteract() ? (v) => { setByApp((prev) => prev.map((it, i) => i === index() ? { ...it, write: v } : it)); setDirty(true); } : undefined}
                    onExecuteChange={localExecute() && ctx.canInteract() ? (v) => { setByApp((prev) => prev.map((it, i) => i === index() ? { ...it, execute: v } : it)); setDirty(true); } : undefined} />
                  <Button size="icon" variant="ghost" icon={Trash} class="text-muted-foreground hover:text-destructive" onClick={() => { setByApp((prev) => prev.filter((_, i) => i !== index())); setDirty(true); }} disabled={!ctx.canInteract()} aria-label={i18n.t('permissionPolicy.removeRuleAria', { subject: row.key || i18n.t('permissionPolicy.appHeader') })} />
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </SettingsSection>
  );
}
