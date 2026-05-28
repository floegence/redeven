import { createMemo } from 'solid-js';
import { RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, SettingsPill } from '../SettingsPrimitives';
import { EnvDebugConsoleSettingsPanel } from '../../EnvDebugConsoleSettingsPanel';
import { useI18n } from '../../../i18n';

export function DebugConsoleSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const debugConsoleEnabled = createMemo(() => ctx.env.debugConsoleEnabled());

  return (
    <SettingsCard
      icon={RefreshIcon}
      title={i18n.t('debugConsoleSettings.title')}
      description={i18n.t('debugConsoleSettings.description')}
      actions={<SettingsPill tone="success">{i18n.t('debugConsoleSettings.localUIState')}</SettingsPill>}
    >
      <EnvDebugConsoleSettingsPanel
        enabled={debugConsoleEnabled()}
        canInteract={ctx.canInteract()}
        onEnabledChange={(value) => ctx.env.setDebugConsoleEnabled(value)}
      />
    </SettingsCard>
  );
}
