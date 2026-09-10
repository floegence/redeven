import { Switch } from '@floegence/floe-webapp-core/ui';
import { BugIcon } from '@floegence/floe-webapp-core/icons';
import { SettingsPill, SettingRow } from './settings/SettingsPrimitives';
import { useI18n } from '../i18n';

export type EnvDebugConsoleSettingsPanelProps = Readonly<{
  enabled?: boolean;
  canInteract: boolean;
  onEnabledChange?: (value: boolean) => void;
}>;

export function EnvDebugConsoleSettingsPanel(props: EnvDebugConsoleSettingsPanelProps) {
  const i18n = useI18n();
  return (
    <SettingRow
      icon={BugIcon}
      title={props.enabled ? i18n.t('debugConsoleSettings.enabled') : i18n.t('debugConsoleSettings.disabled')}
      description={i18n.t('debugConsoleSettings.localOnlyDescription')}
      tone={props.enabled ? 'success' : 'default'}
      control={
        <>
          <Switch
            size="lg"
            aria-label={props.enabled ? i18n.t('debugConsoleSettings.disableSwitch') : i18n.t('debugConsoleSettings.enableSwitch')}
            checked={Boolean(props.enabled)}
            onChange={(value) => props.onEnabledChange?.(value)}
            disabled={!props.canInteract}
          />
          <SettingsPill tone="success">{i18n.t('debugConsoleSettings.frontendOnly')}</SettingsPill>
        </>
      }
    />
  );
}
