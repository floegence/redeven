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
      description={i18n.t('settings.configFile.description')}
    >
      <div class="rounded-xl border border-border/50 bg-muted/20 px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[11px] text-muted-foreground mb-1.5">配置文件路径</div>
            <code class="text-sm font-mono text-foreground break-all leading-relaxed">
              {configPath() || i18n.t('settings.configFile.unknownPath')}
            </code>
          </div>
          <CopyButton value={configPath() || ''} />
        </div>
      </div>
      <p class="mt-2 text-[11px] text-muted-foreground">{i18n.t('settings.configFile.readOnlyRuntimeManaged')}</p>
    </SettingsSection>
  );
}
