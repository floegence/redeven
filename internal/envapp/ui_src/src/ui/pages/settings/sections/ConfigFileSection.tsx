import { Show, createMemo, createSignal } from 'solid-js';
import { FileCode } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, ViewToggle, CopyButton, JSONEditor, type ViewMode } from '../SettingsPrimitives';
import { useI18n } from '../../../i18n';

export function ConfigFileSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');

  const configPath = createMemo(() => String(ctx.settings()?.config_path ?? ''));
  const configJSONText = createMemo(() => JSON.stringify({ config_path: configPath() }, null, 2));

  return (
    <SettingsCard
      icon={FileCode}
      title={i18n.t('settings.configFile.title')}
      description={i18n.t('settings.configFile.description')}
      actions={<ViewToggle value={viewMode} onChange={(v) => setViewMode(v)} />}
    >
      <Show
        when={viewMode() === 'ui'}
        fallback={<JSONEditor value={configJSONText()} onChange={() => undefined} disabled rows={4} />}
      >
        <div class="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <FileCode class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <code class="min-w-0 flex-1 break-all font-mono text-[11px]">{configPath() || i18n.t('settings.configFile.unknownPath')}</code>
          <CopyButton value={configPath() || ''} />
        </div>
        <p class="mt-2 text-[11px] text-muted-foreground">{i18n.t('settings.configFile.readOnlyRuntimeManaged')}</p>
      </Show>
    </SettingsCard>
  );
}
