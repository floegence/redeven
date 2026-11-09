import { For, Show, batch, createSignal, createEffect, onCleanup, untrack } from 'solid-js';
import { createStore, produce, type SetStoreFunction } from 'solid-js/store';
import { Shield, Trash } from '@floegence/floe-webapp-core/icons';
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
  // IMPORTANT: A rule owns stable input identity. Mutate its store fields rather
  // than replacing rows on every keystroke; retain surviving subjects on removal
  // and reconcile acknowledged server rows by subject, never by array position.
  const [byUser, setByUser] = createStore<PermissionRow[]>([]);
  const [byApp, setByApp] = createStore<PermissionRow[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [failure, setFailure] = createSignal<{ kind: 'validation' | 'request'; message: string } | null>(null);
  const error = () => failure()?.message;
  let editRevision = 0;
  const changed = () => { editRevision += 1; setFailure(null); setDirty(true); };
  const localMaxDescription = () => [
    i18n.t('permissionPolicy.localMaxDescription'),
    localExecute() && !localWrite() ? i18n.t('terminal.executePermissionDescription') : '',
  ].filter(Boolean).join(' ');

  const syncRules = (rows: PermissionRow[], setRows: SetStoreFunction<PermissionRow[]>, value: Record<string, PermissionSet> | undefined) => untrack(() => {
    const remaining = new Map(mapToPermissionRows(value).map(row => [row.key, row]));
    const next: PermissionRow[] = [];
    // IMPORTANT: Acknowledgements canonicalize subjects without moving their
    // existing controls. Even moving the same focused DOM node can blur it.
    // Read local rows untracked: typing must not trigger server reconciliation
    // before the input handler marks its revision dirty.
    batch(() => {
      rows.forEach((row, index) => {
        const canonical = remaining.get(row.key.trim());
        if (!canonical) return;
        setRows(index, canonical);
        next.push(row);
        remaining.delete(canonical.key);
      });
      setRows([...next, ...remaining.values()]);
    });
  });

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      const p = s?.permission_policy;
      setLocalRead(p?.local_max?.read ?? true);
      setLocalWrite(p?.local_max?.write ?? false);
      setLocalExecute(p?.local_max?.execute ?? true);
      syncRules(byUser, setByUser, p?.by_user);
      syncRules(byApp, setByApp, p?.by_app);
    }
  });

  createEffect(() => {
    const r = localRead(), w = localWrite(), x = localExecute();
    const applyCeiling = produce<PermissionRow[]>(rows => {
      for (const row of rows) {
        if (!r) row.read = false;
        if (!w) row.write = false;
        if (!x) row.execute = false;
      }
    });
    setByUser(applyCeiling);
    setByApp(applyCeiling);
  });

  let autoSaveTimer: number | undefined;
  const clearTimer = (t: number | undefined) => { if (t != null) { window.clearTimeout(t); return undefined; } return undefined; };

  createEffect(() => {
    if (!dirty() || saving() || error() || !canEdit()) { autoSaveTimer = clearTimer(autoSaveTimer); return; }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || error() || !canEdit()) return;
      let body;
      try {
        body = buildPermissionPolicyValue(
          { read: localRead(), write: localWrite(), execute: localExecute() },
          byUser, byApp,
        );
      } catch (e) {
        setFailure({ kind: 'validation', message: formatUnknownError(e) || i18n.t('permissionPolicy.saveFailed') });
        return;
      }
      const savingRevision = editRevision;
      setSaving(true);
      try {
        await ctx.saveSettings({ permission_policy: body });
        // IMPORTANT: An admitted save may settle after further typing. Only its
        // own revision becomes clean; keep newer edits queued and controls mounted.
        batch(() => {
          setSaving(false); setSavedAt(Date.now());
          setDirty(editRevision !== savingRevision); setFailure(null);
        });
      } catch (e) {
        batch(() => { setSaving(false); setFailure({ kind: 'request', message: formatUnknownError(e) || i18n.t('permissionPolicy.saveFailed') }); });
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const addUserRule = () => {
    setByUser((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]);
    changed();
  };
  const addAppRule = () => {
    setByApp((prev) => [...prev, { key: '', read: localRead(), write: localWrite(), execute: localExecute() }]);
    changed();
  };

  // One matrix owns the shared user/app rule interaction and permission ceiling.
  const renderRules = (kind: 'user' | 'app') => {
    const rows = kind === 'user' ? byUser : byApp;
    const setRows = kind === 'user' ? setByUser : setByApp;
    const permissions = ['read', 'write', 'execute'] as const;
    const ceiling = (permission: typeof permissions[number]) => ({ read: localRead(), write: localWrite(), execute: localExecute() })[permission];
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
            <For each={rows}>{(row, index) => <tr class="settings-permission-rule">
              <td class="settings-permission-subject"><Input value={row.key} size="sm" class="w-full min-w-0 font-mono text-xs" disabled={!canEdit()}
                aria-label={i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}
                placeholder={i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}
                onInput={e => { setRows(index(), 'key', e.currentTarget.value); changed(); }} /></td>
              <For each={permissions}>{permission => <td class="settings-permission-value">
                <span class="settings-permission-name" aria-hidden="true">{i18n.t(`permissionPolicy.permission.${permission}`)}</span>
                <Checkbox checked={row[permission]} disabled={!canEdit() || !ceiling(permission)}
                  aria-label={`${row.key || i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader')}: ${i18n.t(`permissionPolicy.permission.${permission}`)}`}
                  onChange={value => { setRows(index(), permission, value); changed(); }} />
              </td>}</For>
              <td class="settings-permission-remove"><Button size="icon" variant="ghost" icon={Trash} disabled={!canEdit()}
                aria-label={i18n.t('permissionPolicy.removeRuleAria', { subject: row.key || i18n.t(kind === 'user' ? 'permissionPolicy.userHeader' : 'permissionPolicy.appHeader') })}
                onClick={() => { setRows(previous => previous.filter((_, i) => i !== index())); changed(); }} /></td>
            </tr>}</For>
            <Show when={!rows.length}><tr><td colSpan={5} class="settings-permission-empty">{i18n.t(kind === 'user' ? 'permissionPolicy.noUserOverrides' : 'permissionPolicy.noAppOverrides')}</td></tr></Show>
          </tbody>
        </table>
      </div>
    </div>;
  };

  return (
    <SettingsSection variant="page" icon={Shield} title={i18n.t('permissionPolicy.title')} description={i18n.t('permissionPolicy.description')}
      badge={i18n.t('permissionPolicy.manualRestartRequired')} badgeVariant="warning" error={failure()?.kind === 'validation' ? error() : null}
      feedback={failure()?.kind === 'request' ? [{ id: 'save', severity: 'error', summary: error()!, actions: <Button size="sm" variant="outline" disabled={!canEdit() || saving()} onClick={() => setFailure(null)}>{i18n.t('common.actions.retry')}</Button> }] : []}
      actions={<AutoSaveIndicator dirty={dirty()} saving={saving()} error={failure()?.kind === 'validation' ? error() : null} savedAt={savedAt()} enabled={canEdit()} />}>
      <SettingsList>
        <SettingRow title={i18n.t('settingsDesign.permissionCeiling')} description={localMaxDescription()}
          control={<div class="settings-permission-ceiling">
            <For each={[
              { key: 'read' as const, value: localRead, set: setLocalRead },
              { key: 'write' as const, value: localWrite, set: setLocalWrite },
              { key: 'execute' as const, value: localExecute, set: setLocalExecute },
            ]}>{permission => <Checkbox label={i18n.t(`permissionPolicy.permission.${permission.key}`)}
              checked={permission.value()} disabled={!canEdit()} onChange={value => { permission.set(value); changed(); }} />}</For>
          </div>} />
      </SettingsList>
      {renderRules('user')}
      {renderRules('app')}
    </SettingsSection>
  );
}
