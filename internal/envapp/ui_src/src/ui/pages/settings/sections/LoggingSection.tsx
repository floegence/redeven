import { createSignal, createEffect, onCleanup } from 'solid-js';
import { Database, FileText, Filter } from '@floegence/floe-webapp-core/icons';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, SettingsList, AutoSaveIndicator, SettingRow } from '../SettingsPrimitives';
import { formatUnknownError } from '../../../maintenance/shared';
import { useI18n } from '../../../i18n';

const AUTO_SAVE_DELAY_MS = 700;

export function LoggingSection() {
  const ctx = useEnvSettingsPage();
  const canEdit = () => ctx.canInteract() && ctx.canAdmin();
  const i18n = useI18n();

  const [logFormat, setLogFormat] = createSignal('');
  const [logLevel, setLogLevel] = createSignal('');
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      setLogFormat(String(s.logging?.log_format ?? ''));
      setLogLevel(String(s.logging?.log_level ?? ''));
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
        await ctx.saveSettings({ log_format: logFormat(), log_level: logLevel() });
        setSaving(false); setSavedAt(Date.now()); setDirty(false); setError(null);
      } catch (e) {
        setSaving(false); setError(formatUnknownError(e) || i18n.t('loggingSettings.saveFailed'));
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  return (
    <SettingsSection
      variant="page"
      icon={Database}
      title={i18n.t('loggingSettings.title')}
      description={i18n.t('loggingSettings.description')}
      feedback={error() ? [{ id: 'save', severity: 'error', summary: error()!, actions: <Button size="sm" variant="outline" disabled={!canEdit() || saving()} onClick={() => setError(null)}>{i18n.t('common.actions.retry')}</Button> }] : []}
      badge={i18n.t('loggingSettings.restartRequired')}
      badgeVariant="warning"
      actions={<AutoSaveIndicator dirty={dirty()} saving={saving()} savedAt={savedAt()} enabled={canEdit()} />}
    >
      <SettingsList>
        <SettingRow
          icon={FileText}
          title={i18n.t('loggingSettings.formatLabel')}
          description={i18n.t('loggingSettings.defaultJson')}
          control={
          <Select
            value={logFormat()} onChange={(v) => { setLogFormat(v); setError(null); setDirty(true); }} disabled={!canEdit()}
            options={[{ value: '', label: i18n.t('loggingSettings.defaultJson') }, { value: 'json', label: 'json' }, { value: 'text', label: 'text' }]}
            class="w-44"
          />
          }
        />
        <SettingRow
          icon={Filter}
          title={i18n.t('loggingSettings.levelLabel')}
          description={i18n.t('loggingSettings.defaultInfo')}
          control={
          <Select
            value={logLevel()} onChange={(v) => { setLogLevel(v); setError(null); setDirty(true); }} disabled={!canEdit()}
            options={[{ value: '', label: i18n.t('loggingSettings.defaultInfo') }, { value: 'debug', label: 'debug' }, { value: 'info', label: 'info' }, { value: 'warn', label: 'warn' }, { value: 'error', label: 'error' }]}
            class="w-44"
          />
          }
        />
      </SettingsList>
    </SettingsSection>
  );
}
