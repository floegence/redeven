import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { Shield, Trash, ShieldCheck } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Checkbox } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, SettingsList, AutoSaveIndicator, SubSectionHeader, SettingRow } from '../SettingsPrimitives';
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
  const canEdit = () => ctx.canInteract() && ctx.canAdmin();
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
  const localMaxDescription = () => [
    i18n.t('permissionPolicy.localMaxDescription'),
    localExecute() && !localWrite() ? i18n.t('terminal.executePermissionDescription') : '',
  ].filter(Boolean).join(' ');

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
    if (!dirty() || saving() || error() || !canEdit()) { autoSaveTimer = clearTimer(autoSaveTimer); return; }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || error() || !canEdit()) return;
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
    setError(null); setDirty(true);
  };
  const addAppRule = () => {
    setByApp((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]);
    setError(null); setDirty(true);
  };

  // One matrix owns the shared user/app rule interaction and permission ceiling.
  const renderRules = (kind: 'user' | 'app') => {
    const rows = kind === 'user' ? byUser : byApp;
    const setRows = kind === 'user' ? setByUser : setByApp;
    const permissions = ['read', 'write', 'execute'] as const;
    const ceiling = (permission: typeof permissions[number]) => ({ read: localRead(), write: localWrite(), execute: localExecute() })[permission];
    const changed = () => { setError(null); setDirty(true); };
    return <div class="space-y-3">
      <SubSectionHeader title={i18n.t(kind === 'user' ? 'settingsDesign.userOverrides' : 'settingsDesign.appOverrides')}
        description={i18n.t(kind === 'user' ? 'permissionPolicy.byUserDescription' : 'permissionPolicy.byAppDescription')}
        actions={<Button size="sm" variant="ghost" onClick={kind === 'user' ? addUserRule : addAppRule} disabled={!canEdit()}>{i18n.t('permissionPolicy.addRule')}</Button>} />
      <div class="settings-permission-table">
        <table>
          <thead><tr>
            <th scope="col">{i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}</th>
            <For each={permissions}>{permission => <th scope="col">{i18n.t(`permissionPolicy.permission.${permission}`)}</th>}</For>
            <th scope="col"><span class="sr-only">{i18n.t('common.actions.delete')}</span></th>
          </tr></thead>
          <tbody>
            <For each={rows()}>{(row, index) => <tr>
              <td><Input value={row.key} size="sm" class="w-full min-w-0 font-mono text-xs" disabled={!canEdit()}
                aria-label={i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}
                placeholder={i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}
                onInput={e => { setRows(previous => previous.map((item, i) => i === index() ? { ...item, key: e.currentTarget.value } : item)); changed(); }} /></td>
              <For each={permissions}>{permission => <td>
                <Checkbox checked={row[permission]} disabled={!canEdit() || !ceiling(permission)}
                  aria-label={`${row.key || i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}: ${i18n.t(`permissionPolicy.permission.${permission}`)}`}
                  onChange={value => { setRows(previous => previous.map((item, i) => i === index() ? { ...item, [permission]: value } : item)); changed(); }} />
              </td>}</For>
              <td><Button size="icon" variant="ghost" icon={Trash} disabled={!canEdit()}
                aria-label={i18n.t('permissionPolicy.removeRuleAria', { subject: row.key || i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader') })}
                onClick={() => { setRows(previous => previous.filter((_, i) => i !== index())); changed(); }} /></td>
            </tr>}</For>
            <Show when={!rows().length}><tr><td colSpan={5} class="settings-permission-empty">{i18n.t(kind === 'user' ? 'permissionPolicy.noUserOverrides' : 'permissionPolicy.noAppOverrides')}</td></tr></Show>
          </tbody>
        </table>
      </div>
    </div>;
  };

  return (
    <SettingsSection variant="page" icon={Shield} title={i18n.t('permissionPolicy.title')} description={i18n.t('permissionPolicy.description')}
      badge={i18n.t('permissionPolicy.manualRestartRequired')} badgeVariant="warning" error={error()}
      actions={<AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={canEdit()} />}>
      <SettingsList>
        <SettingRow icon={ShieldCheck} title={i18n.t('settingsDesign.permissionCeiling')} description={localMaxDescription()}
          control={<div class="settings-permission-ceiling">
            <For each={[
              { key: 'read' as const, value: localRead, set: setLocalRead },
              { key: 'write' as const, value: localWrite, set: setLocalWrite },
              { key: 'execute' as const, value: localExecute, set: setLocalExecute },
            ]}>{permission => <Checkbox label={i18n.t(`permissionPolicy.permission.${permission.key}`)}
              checked={permission.value()} disabled={!canEdit()} onChange={value => { permission.set(value); setError(null); setDirty(true); }} />}</For>
          </div>} />
      </SettingsList>
      {renderRules('user')}
      {renderRules('app')}
    </SettingsSection>
  );
}
