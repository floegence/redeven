import { Show, createMemo, createSignal } from 'solid-js';
import { Globe, Key, Link } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, ViewToggle, CopyButton, InfoRow, JSONEditor, type ViewMode } from '../SettingsPrimitives';
import { useI18n } from '../../../i18n';

export function ConnectionSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');

  const connectionJSONText = createMemo(() => {
    const s = ctx.settings();
    return JSON.stringify(s?.connection ?? {}, null, 2);
  });

  const settings = () => ctx.settings();

  return (
    <SettingsSection
      icon={Globe}
      title={i18n.t('settings.connection.title')}
      description={i18n.t('settings.connection.description')}
      actions={<ViewToggle value={viewMode} onChange={(v) => setViewMode(v)} />}
    >
      <Show
        when={viewMode() === 'ui'}
        fallback={<JSONEditor value={connectionJSONText()} onChange={() => undefined} disabled rows={10} />}
      >
        <div class="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <InfoRow icon={Globe} label={i18n.t('settings.connection.controlPlane')} mono>{String(settings()?.connection?.controlplane_base_url ?? '')}</InfoRow>
          <InfoRow icon={Key} label={i18n.t('settings.connection.e2eePsk')}>
            {settings()?.connection?.direct?.e2ee_psk_set ? i18n.t('settings.connection.configured') : i18n.t('settings.connection.notSet')}
          </InfoRow>
          <InfoRow icon={Link} label={i18n.t('settings.connection.environmentId')} mono actions={<CopyButton value={String(settings()?.connection?.environment_id ?? '')} />}>
            {String(settings()?.connection?.environment_id ?? '')}
          </InfoRow>
          <InfoRow icon={Link} label={i18n.t('settings.connection.instanceId')} mono>{String(settings()?.connection?.agent_instance_id ?? '')}</InfoRow>
          <InfoRow icon={Link} label={i18n.t('settings.connection.channelId')} mono>{String(settings()?.connection?.direct?.channel_id ?? '')}</InfoRow>
          <InfoRow icon={Link} label={i18n.t('settings.connection.directSuite')} mono>{String(settings()?.connection?.direct?.default_suite ?? '')}</InfoRow>
          <InfoRow icon={Link} label={i18n.t('settings.connection.webSocketUrl')} mono>{String(settings()?.connection?.direct?.ws_url ?? '')}</InfoRow>
        </div>
        <p class="mt-3 text-[11px] text-muted-foreground">{i18n.t('settings.connection.readOnlyControlPlaneManaged')}</p>
      </Show>
    </SettingsSection>
  );
}
