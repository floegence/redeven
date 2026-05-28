import { createSignal, createEffect, onCleanup } from 'solid-js';
import { Database } from '@floegence/floe-webapp-core/icons';
import { Select } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, AutoSaveIndicator } from '../SettingsPrimitives';
import { formatUnknownError } from '../../../maintenance/shared';
import { useI18n } from '../../../i18n';

const AUTO_SAVE_DELAY_MS = 700;

export function LoggingSection() {
  const ctx = useEnvSettingsPage();
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
    if (!dirty() || saving() || !ctx.canInteract()) {
      autoSaveTimer = clearTimer(autoSaveTimer);
      return;
    }
    autoSaveTimer = clearTimer(autoSaveTimer);
    autoSaveTimer = window.setTimeout(async () => {
      autoSaveTimer = undefined;
      if (!dirty() || saving() || !ctx.canInteract()) return;
      setSaving(true);
      try {
        await ctx.saveSettings({ logging: { log_format: logFormat() || null, log_level: logLevel() || null } });
        setSaving(false);
        setSavedAt(Date.now());
        setDirty(false);
        setError(null);
      } catch (e) {
        setSaving(false);
        setError(formatUnknownError(e) || i18n.t('loggingSettings.saveFailed'));
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  return (
    <SettingsSection
      icon={Database}
      title={i18n.t('loggingSettings.title')}
      description={`${i18n.t('loggingSettings.description')} ${i18n.t('loggingSettings.restartRequired')}`}
      error={error()}
      actions={
        <AutoSaveIndicator dirty={dirty()} saving={saving()} error={error()} savedAt={savedAt()} enabled={ctx.canInteract()} />
      }
    >
      <div class="space-y-5">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div class="sm:max-w-[55%]">
            <label class="text-xs font-medium text-foreground">{i18n.t('loggingSettings.formatLabel')}</label>
            <p class="mt-0.5 text-[11px] text-muted-foreground">{i18n.t('loggingSettings.defaultJson')}</p>
          </div>
          <Select
            value={logFormat()} onChange={(v) => { setLogFormat(v); setDirty(true); }} disabled={!ctx.canInteract()}
            options={[{ value: '', label: i18n.t('loggingSettings.defaultJson') }, { value: 'json', label: 'json' }, { value: 'text', label: 'text' }]}
            class="sm:w-48"
          />
        </div>
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div class="sm:max-w-[55%]">
            <label class="text-xs font-medium text-foreground">{i18n.t('loggingSettings.levelLabel')}</label>
            <p class="mt-0.5 text-[11px] text-muted-foreground">{i18n.t('loggingSettings.defaultInfo')}</p>
          </div>
          <Select
            value={logLevel()} onChange={(v) => { setLogLevel(v); setDirty(true); }} disabled={!ctx.canInteract()}
            options={[{ value: '', label: i18n.t('loggingSettings.defaultInfo') }, { value: 'debug', label: 'debug' }, { value: 'info', label: 'info' }, { value: 'warn', label: 'warn' }, { value: 'error', label: 'error' }]}
            class="sm:w-48"
          />
        </div>
      </div>
    </SettingsSection>
  );
}
