import { Show } from 'solid-js';
import { Globe, Home } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { CopyButton, SettingsList, SettingsSection, SettingRow, DotIndicator } from '../SettingsPrimitives';
import { desktopShellBridgeAvailable, openConnectionCenter } from '../../../services/desktopShellBridge';
import { useI18n } from '../../../i18n';

function ConnectionValue(props: { value: string; label: string }) {
  const i18n = useI18n();
  return <div class="settings-copy-value">
    <code>{props.value || i18n.t('settings.connection.notProvided')}</code>
    <Show when={props.value}><CopyButton value={props.value} label={i18n.t('settings.copyValue', { value: props.label })} iconOnly /></Show>
  </div>;
}

export function ConnectionSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();
  const conn = () => ctx.settings()?.connection;
  const controlPlaneURL = () => String(conn()?.access_point_origin ?? '').trim();
  const environmentID = () => String(conn()?.environment_id ?? '').trim();
  const runtimeInstanceID = () => String(conn()?.agent_instance_id ?? '').trim();
  const artifactReady = () => Boolean(conn()?.direct?.artifact_provisioned);
  const connected = () => ctx.protocol.status() === 'connected';
  const connectionStatus = () => i18n.t(connected() ? 'shell.framework.connected' : ctx.protocol.status() === 'connecting' ? 'shell.framework.connecting' : 'shell.framework.disconnected');

  const openConnectionManager = async () => {
    try {
      if (await openConnectionCenter()) return;
    } catch {
      // The same recovery applies when the Desktop bridge rejects the request.
    }
    ctx.notify.error(i18n.t('settings.connection.manageConnectionFailedTitle'), i18n.t('settings.connection.manageConnectionFailedMessage'));
  };

  return (
    <SettingsSection variant="page" icon={Globe} title={i18n.t('settings.connection.title')} description={i18n.t('settings.connection.description')}>
      <SettingsList>
        <SettingRow title={i18n.t('settings.connection.title')} control={<DotIndicator active={connected()} label={connectionStatus()} />} />
        <SettingRow title={i18n.t('settings.connection.connectionServiceAddress')}
          control={<ConnectionValue value={controlPlaneURL()} label={i18n.t('settings.connection.controlPlaneUrl')} />} />
        <SettingRow title={i18n.t('settings.connection.securityKey')} description={i18n.t('settings.connection.securityKeyDescription')}
          control={<DotIndicator active={artifactReady()} label={i18n.t(artifactReady() ? 'settings.connection.keyProvisioned' : 'settings.connection.keyNotProvisioned')} />} />
      </SettingsList>
      <SettingsList>
        <SettingRow title={i18n.t('settings.connection.changeConnectionTitle')} description={i18n.t('settings.connection.changeConnectionDescription')}
          control={<Show when={desktopShellBridgeAvailable()}>
            <Button size="sm" variant="outline" icon={Home} onClick={() => void openConnectionManager()}>{i18n.t('settings.connection.manageConnection')}</Button>
          </Show>} />
      </SettingsList>
      <details class="settings-technical-details connection-details">
        <summary>{i18n.t('settings.connection.technicalInformation')}</summary>
        <SettingsList>
          <SettingRow title={i18n.t('settings.connection.environmentId')}
            control={<ConnectionValue value={environmentID()} label={i18n.t('settings.connection.environmentId')} />} />
          <SettingRow title={i18n.t('settings.connection.instanceId')}
            control={<ConnectionValue value={runtimeInstanceID()} label={i18n.t('settings.connection.instanceId')} />} />
          <SettingRow title={i18n.t('settings.connection.channelInitExpiresAt')}
            control={<code class="text-xs">{conn()?.direct?.expires_at_unix_s || i18n.t('settings.connection.emptyValue')}</code>} />
        </SettingsList>
      </details>
    </SettingsSection>
  );
}
