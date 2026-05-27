import { Show, createMemo, createSignal } from 'solid-js';
import { Globe, Key, Link } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsCard, ViewToggle, CopyButton, InfoRow, JSONEditor, type ViewMode } from '../SettingsPrimitives';

export function ConnectionSection() {
  const ctx = useEnvSettingsPage();

  const [viewMode, setViewMode] = createSignal<ViewMode>('ui');

  const connectionJSONText = createMemo(() => {
    const s = ctx.settings();
    return JSON.stringify(s?.connection ?? {}, null, 2);
  });

  const settings = () => ctx.settings();

  return (
    <SettingsCard
      icon={Globe}
      title="Connection"
      description="Connection details managed by the control plane."
      actions={<ViewToggle value={viewMode} onChange={(v) => setViewMode(v)} />}
    >
      <Show
        when={viewMode() === 'ui'}
        fallback={<JSONEditor value={connectionJSONText()} onChange={() => undefined} disabled rows={10} />}
      >
        <div class="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          <InfoRow icon={Globe} label="Control Plane" mono>{String(settings()?.connection?.controlplane_base_url ?? '')}</InfoRow>
          <InfoRow icon={Key} label="E2EE PSK">{settings()?.connection?.direct?.e2ee_psk_set ? 'Configured' : 'Not set'}</InfoRow>
          <InfoRow icon={Link} label="Environment ID" mono actions={<CopyButton value={String(settings()?.connection?.environment_id ?? '')} />}>
            {String(settings()?.connection?.environment_id ?? '')}
          </InfoRow>
          <InfoRow icon={Link} label="Instance ID" mono>{String(settings()?.connection?.agent_instance_id ?? '')}</InfoRow>
          <InfoRow icon={Link} label="Channel ID" mono>{String(settings()?.connection?.direct?.channel_id ?? '')}</InfoRow>
          <InfoRow icon={Link} label="Direct Suite" mono>{String(settings()?.connection?.direct?.default_suite ?? '')}</InfoRow>
          <InfoRow icon={Link} label="WebSocket URL" mono>{String(settings()?.connection?.direct?.ws_url ?? '')}</InfoRow>
        </div>
        <p class="mt-3 text-[11px] text-muted-foreground">Read-only. Managed by the control plane.</p>
      </Show>
    </SettingsCard>
  );
}
