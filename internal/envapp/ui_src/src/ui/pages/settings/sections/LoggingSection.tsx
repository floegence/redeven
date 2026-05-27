import { Show, createMemo } from 'solid-js';
import { Database, FileText, Zap } from '@floegence/floe-webapp-core/icons';
import { Select } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { ViewToggle, AutoSaveIndicator } from '../SettingsPrimitives';
import { SettingsCard, CompactField, JSONEditor, type ViewMode as VM } from '../SettingsPrimitives';
import { createSignal, createEffect, onCleanup } from 'solid-js';
import { formatUnknownError } from '../../../maintenance/shared';

const AUTO_SAVE_DELAY_MS = 700;

export function LoggingSection() {
  const ctx = useEnvSettingsPage();

  const [viewMode, setViewMode] = createSignal<VM>('ui');
  const [logFormat, setLogFormat] = createSignal('');
  const [logLevel, setLogLevel] = createSignal('');
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Load from settings
  createEffect(() => {
    const s = ctx.settings();
    if (!s) return;
    if (!dirty()) {
      setLogFormat(String(s.logging?.log_format ?? ''));
      setLogLevel(String(s.logging?.log_level ?? ''));
    }
  });

  const jsonText = createMemo(() => JSON.stringify({ log_format: logFormat(), log_level: logLevel() }, null, 2));

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
        setError(formatUnknownError(e) || 'Save failed.');
      }
    }, AUTO_SAVE_DELAY_MS);
  });

  onCleanup(() => { autoSaveTimer = clearTimer(autoSaveTimer); });

  const switchView = (next: VM) => {
    if (next === 'json') setViewMode('json');
    else setViewMode('ui');
  };

  return (
    <SettingsCard
      icon={Database}
      title="Logging"
      description="Log format and verbosity for backend runtime logs."
      badge="Log changes require restart"
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
        fallback={
          <JSONEditor value={jsonText()} onChange={(v) => { try { const p = JSON.parse(v); setLogFormat(p.log_format ?? ''); setLogLevel(p.log_level ?? ''); setDirty(true); } catch {} }} disabled={!ctx.canInteract()} rows={5} />
        }
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <CompactField icon={FileText} label="Format">
            <Select value={logFormat()} onChange={(v) => { setLogFormat(v); setDirty(true); }} disabled={!ctx.canInteract()}
              options={[{ value: '', label: 'Default (json)' }, { value: 'json', label: 'json' }, { value: 'text', label: 'text' }]} class="w-full" />
          </CompactField>
          <CompactField icon={Zap} label="Level">
            <Select value={logLevel()} onChange={(v) => { setLogLevel(v); setDirty(true); }} disabled={!ctx.canInteract()}
              options={[{ value: '', label: 'Default (info)' }, { value: 'debug', label: 'debug' }, { value: 'info', label: 'info' }, { value: 'warn', label: 'warn' }, { value: 'error', label: 'error' }]} class="w-full" />
          </CompactField>
        </div>
      </Show>
    </SettingsCard>
  );
}
