import { Globe } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, PropertyRow, DotIndicator } from '../SettingsPrimitives';
import { useI18n } from '../../../i18n';

export function ConnectionSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const settings = () => ctx.settings();

  return (
    <SettingsSection
      icon={Globe}
      title={i18n.t('settings.connection.title')}
      description={`${i18n.t('settings.connection.description')} ${i18n.t('settings.connection.readOnlyControlPlaneManaged')}`}
    >
      <PropertyRow label={i18n.t('settings.connection.controlPlane')} mono copyValue={String(settings()?.connection?.controlplane_base_url ?? '')}>
        {String(settings()?.connection?.controlplane_base_url ?? '')}
      </PropertyRow>
      <PropertyRow label={i18n.t('settings.connection.e2eePsk')}>
        <DotIndicator active={Boolean(settings()?.connection?.direct?.e2ee_psk_set)} label={settings()?.connection?.direct?.e2ee_psk_set ? i18n.t('settings.connection.configured') : i18n.t('settings.connection.notSet')} />
      </PropertyRow>
      <PropertyRow label={i18n.t('settings.connection.environmentId')} mono copyValue={String(settings()?.connection?.environment_id ?? '')}>
        {String(settings()?.connection?.environment_id ?? '')}
      </PropertyRow>
      <PropertyRow label={i18n.t('settings.connection.instanceId')} mono>
        {String(settings()?.connection?.agent_instance_id ?? '')}
      </PropertyRow>
      <PropertyRow label={i18n.t('settings.connection.channelId')} mono>
        {String(settings()?.connection?.direct?.channel_id ?? '')}
      </PropertyRow>
      <PropertyRow label={i18n.t('settings.connection.directSuite')} mono>
        {String(settings()?.connection?.direct?.default_suite ?? '')}
      </PropertyRow>
      <PropertyRow label={i18n.t('settings.connection.webSocketUrl')} mono>
        {String(settings()?.connection?.direct?.ws_url ?? '')}
      </PropertyRow>
    </SettingsSection>
  );
}
