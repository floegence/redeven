import { Show, createSignal } from 'solid-js';
import { Globe, ChevronDown } from '@floegence/floe-webapp-core/icons';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, CopyButton, DotIndicator } from '../SettingsPrimitives';
import { useI18n } from '../../../i18n';

export function ConnectionSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();
  const [showDetails, setShowDetails] = createSignal(false);

  const s = () => ctx.settings();
  const conn = () => s()?.connection;
  const direct = () => conn()?.direct;

  return (
    <SettingsSection
      icon={Globe}
      title={i18n.t('settings.connection.title')}
      description={i18n.t('settings.connection.description')}
    >
      {/* Two hero cards: URL + Security */}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="rounded-xl border border-border/50 bg-background p-4">
          <div class="text-[11px] text-muted-foreground mb-2">{i18n.t('settings.connection.controlPlane')}</div>
          <div class="flex items-start justify-between gap-3">
            <code class="text-sm font-mono text-foreground break-all leading-relaxed">
              {String(conn()?.controlplane_base_url ?? '')}
            </code>
            <CopyButton value={String(conn()?.controlplane_base_url ?? '')} />
          </div>
        </div>
        <div class="rounded-xl border border-border/50 bg-background p-4">
          <div class="text-[11px] text-muted-foreground mb-2">{i18n.t('settings.connection.e2eePsk')}</div>
          <DotIndicator
            active={Boolean(direct()?.e2ee_psk_set)}
            label={direct()?.e2ee_psk_set ? i18n.t('settings.connection.configured') : i18n.t('settings.connection.notSet')}
          />
        </div>
      </div>

      {/* Identity group */}
      <div class="mt-4 rounded-xl border border-border/50 bg-background p-4">
        <div class="text-[11px] font-medium text-muted-foreground mb-3 uppercase tracking-wider">身份标识</div>
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[11px] text-muted-foreground">{i18n.t('settings.connection.environmentId')}</div>
              <code class="text-xs font-mono text-foreground">{String(conn()?.environment_id ?? '')}</code>
            </div>
            <CopyButton value={String(conn()?.environment_id ?? '')} />
          </div>
          <div>
            <div class="text-[11px] text-muted-foreground">{i18n.t('settings.connection.instanceId')}</div>
            <code class="text-xs font-mono text-foreground">{String(conn()?.agent_instance_id ?? '')}</code>
          </div>
        </div>
      </div>

      {/* Collapsible technical details */}
      <div class="mt-3">
        <button
          type="button"
          class="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full"
          onClick={() => setShowDetails(!showDetails())}
        >
          <ChevronDown class={`h-3 w-3 transition-transform ${showDetails() ? '' : '-rotate-90'}`} />
          {i18n.t('codexSettings.notesTitle') || '技术详情'}
        </button>
        <Show when={showDetails()}>
          <div class="mt-2 rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2.5">
            <div>
              <div class="text-[11px] text-muted-foreground">{i18n.t('settings.connection.channelId')}</div>
              <code class="text-[11px] font-mono text-foreground">{String(direct()?.channel_id ?? '')}</code>
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground">{i18n.t('settings.connection.directSuite')}</div>
              <code class="text-[11px] font-mono text-foreground">{String(direct()?.default_suite ?? '')}</code>
            </div>
            <div>
              <div class="text-[11px] text-muted-foreground">{i18n.t('settings.connection.webSocketUrl')}</div>
              <code class="text-[11px] font-mono text-foreground break-all">{String(direct()?.ws_url ?? '')}</code>
            </div>
          </div>
        </Show>
      </div>

      <p class="mt-3 text-[11px] text-muted-foreground">{i18n.t('settings.connection.readOnlyControlPlaneManaged')}</p>
    </SettingsSection>
  );
}
