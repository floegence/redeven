import { createMemo } from 'solid-js';
import { FileCode } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, CopyButton } from '../SettingsPrimitives';
import { useI18n } from '../../../i18n';

export function ConfigFileSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const configPath = createMemo(() => String(ctx.settings()?.config_path ?? ''));

  return (
    <SettingsSection
      icon={FileCode}
      title={i18n.t('settings.configFile.title')}
      description={`${i18n.t('settings.configFile.description')} ${i18n.t('settings.configFile.readOnlyRuntimeManaged')}`}
    >
      <div class="group flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
        <code class="min-w-0 flex-1 break-all font-mono text-xs">{configPath() || i18n.t('settings.configFile.unknownPath')}</code>
        <div class="flex-shrink-0 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <CopyButton value={configPath() || ''} />
        </div>
      </div>
    </SettingsSection>
  );
}
