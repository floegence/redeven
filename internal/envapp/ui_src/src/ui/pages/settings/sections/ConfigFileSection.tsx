import { createMemo } from 'solid-js';
import { FileCode, FileText } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, SettingsList, CopyButton, SettingRow } from '../SettingsPrimitives';
import { useI18n } from '../../../i18n';

export function ConfigFileSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const configPath = createMemo(() => String(ctx.settings()?.config_path ?? ''));

  return (
    <SettingsSection
      icon={FileCode}
      title={i18n.t('settings.configFile.title')}
      description={i18n.t('settings.configFile.description')}
    >
      <SettingsList>
        <SettingRow
          icon={FileText}
          title={i18n.t('settings.configFile.title')}
          description={i18n.t('settings.configFile.readOnlyRuntimeManaged')}
          control={<CopyButton value={configPath() || ''} />}
        >
          <code class="block break-all font-mono text-sm leading-relaxed text-foreground">
            {configPath() || i18n.t('settings.configFile.unknownPath')}
          </code>
        </SettingRow>
      </SettingsList>
    </SettingsSection>
  );
}
