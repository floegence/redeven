import { Show, createSignal, type JSX } from 'solid-js';
import { ArrowRight, ChevronDown, Copy, Globe, Hash, Home, Key, Link, ShieldCheck, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { CopyButton, DotIndicator, SettingsPill, SettingsSection } from '../SettingsPrimitives';
import { desktopShellBridgeAvailable, openConnectionCenter } from '../../../services/desktopShellBridge';
import { useI18n } from '../../../i18n';

type IconComponent = (props: { class?: string }) => JSX.Element;

function OptionalCopyButton(props: Readonly<{ value: string; label: string }>) {
  const value = () => String(props.value ?? '').trim();
  return (
    <Show
      when={value()}
      fallback={<Button variant="ghost" size="xs" icon={Copy} disabled aria-label={props.label} />}
    >
      <CopyButton value={value()} />
    </Show>
  );
}

function SummaryCard(props: Readonly<{
  icon: IconComponent;
  title: string;
  technicalLabel: string;
  description: string;
  value: JSX.Element;
  action?: JSX.Element;
  tone?: 'default' | 'info' | 'success';
}>) {
  const toneClass = () => {
    switch (props.tone) {
      case 'info': return 'border-primary/25 bg-primary/5';
      case 'success': return 'border-success/30 bg-success/5';
      default: return 'border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)]';
    }
  };

  return (
    <div class={`rounded-lg border p-4 ${toneClass()}`}>
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <span class="redeven-setting-row__icon mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md">
            <props.icon class="h-4 w-4" />
          </span>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-foreground">{props.title}</div>
            <div class="mt-0.5 text-[11px] font-mono text-muted-foreground">{props.technicalLabel}</div>
            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{props.description}</p>
          </div>
        </div>
        <Show when={props.action}>
          <div class="flex-shrink-0">{props.action}</div>
        </Show>
      </div>
      <div class="mt-3 min-w-0">{props.value}</div>
    </div>
  );
}

function DetailRow(props: Readonly<{ icon: IconComponent; label: string; value: string; emptyLabel: string }>) {
  const value = () => String(props.value ?? '').trim();
  return (
    <div class="flex min-w-0 items-start gap-2">
      <props.icon class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <div class="min-w-0">
        <div class="text-[11px] text-muted-foreground">{props.label}</div>
        <code class="break-all text-[11px] font-mono text-foreground">{value() || props.emptyLabel}</code>
      </div>
    </div>
  );
}

export function ConnectionSection() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();
  const [showDetails, setShowDetails] = createSignal(false);

  const s = () => ctx.settings();
  const conn = () => s()?.connection;
  const direct = () => conn()?.direct;
  const valueOrEmpty = (value: unknown) => String(value ?? '').trim() || i18n.t('settings.connection.notProvided');
  const controlPlaneURL = () => String(conn()?.controlplane_base_url ?? '').trim();
  const environmentID = () => String(conn()?.environment_id ?? '').trim();
  const e2eeReady = () => Boolean(direct()?.e2ee_psk_set);

  const openConnectionManager = async () => {
    try {
      const opened = await openConnectionCenter();
      if (!opened) {
        ctx.notify.error(i18n.t('settings.connection.manageConnectionFailedTitle'), i18n.t('settings.connection.manageConnectionFailedMessage'));
      }
    } catch {
      ctx.notify.error(i18n.t('settings.connection.manageConnectionFailedTitle'), i18n.t('settings.connection.manageConnectionFailedMessage'));
    }
  };

  return (
    <SettingsSection
      icon={Globe}
      title={i18n.t('settings.connection.title')}
      description={i18n.t('settings.connection.description')}
      badge={i18n.t('settings.connection.readOnlyDiagnostics')}
      actions={
        <Show when={desktopShellBridgeAvailable()}>
          <Button size="sm" variant="outline" icon={Home} onClick={() => void openConnectionManager()}>
            {i18n.t('settings.connection.manageConnection')}
          </Button>
        </Show>
      }
    >
      <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div class="flex items-start gap-3">
          <span class="redeven-setting-row__icon mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md">
            <Globe class="h-4 w-4" />
          </span>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-foreground">{i18n.t('settings.connection.explainerTitle')}</div>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{i18n.t('settings.connection.explainerBody')}</p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <SettingsPill tone="success">{i18n.t('settings.connection.generatedAutomatically')}</SettingsPill>
              <SettingsPill>{i18n.t('settings.connection.readOnly')}</SettingsPill>
              <SettingsPill>{i18n.t('settings.connection.troubleshootingUse')}</SettingsPill>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <SummaryCard
          icon={Globe}
          title={i18n.t('settings.connection.connectionServiceAddress')}
          technicalLabel={i18n.t('settings.connection.controlPlaneUrl')}
          description={i18n.t('settings.connection.connectionServiceAddressDescription')}
          tone="info"
          action={<OptionalCopyButton value={controlPlaneURL()} label={i18n.t('settings.copyValue', { value: i18n.t('settings.connection.controlPlaneUrl') })} />}
          value={
            <code class="block break-all font-mono text-sm leading-relaxed text-foreground">
              {valueOrEmpty(controlPlaneURL())}
            </code>
          }
        />
        <SummaryCard
          icon={Key}
          title={i18n.t('settings.connection.securityKeyStatus')}
          technicalLabel={i18n.t('settings.connection.e2eePsk')}
          description={i18n.t('settings.connection.securityKeyStatusDescription')}
          tone={e2eeReady() ? 'success' : 'default'}
          value={
            <DotIndicator
              active={e2eeReady()}
              label={e2eeReady() ? i18n.t('settings.connection.keyProvisioned') : i18n.t('settings.connection.keyNotProvisioned')}
            />
          }
        />
        <SummaryCard
          icon={ShieldCheck}
          title={i18n.t('settings.connection.currentEnvironmentId')}
          technicalLabel={i18n.t('settings.connection.environmentId')}
          description={i18n.t('settings.connection.currentEnvironmentIdDescription')}
          action={<OptionalCopyButton value={environmentID()} label={i18n.t('settings.copyValue', { value: i18n.t('settings.connection.environmentId') })} />}
          value={
            <code class="block break-all font-mono text-sm leading-relaxed text-foreground">
              {valueOrEmpty(environmentID())}
            </code>
          }
        />
      </div>

      <div class="rounded-lg border border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)] p-4">
        <div class="mb-3 text-sm font-semibold text-foreground">{i18n.t('settings.connection.sourceFlowTitle')}</div>
        <div class="grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
          <div class="rounded-md border border-border/50 bg-background px-3 py-2">
            <div class="font-semibold text-foreground">{i18n.t('settings.connection.sourceDesktop')}</div>
            <div class="mt-0.5">{i18n.t('settings.connection.sourceDesktopDescription')}</div>
          </div>
          <ArrowRight class="hidden h-4 w-4 text-muted-foreground md:block" />
          <div class="rounded-md border border-border/50 bg-background px-3 py-2">
            <div class="font-semibold text-foreground">{i18n.t('settings.connection.sourceConnectionService')}</div>
            <div class="mt-0.5">{i18n.t('settings.connection.sourceConnectionServiceDescription')}</div>
          </div>
          <ArrowRight class="hidden h-4 w-4 text-muted-foreground md:block" />
          <div class="rounded-md border border-border/50 bg-background px-3 py-2">
            <div class="font-semibold text-foreground">{i18n.t('settings.connection.sourceRuntime')}</div>
            <div class="mt-0.5">{i18n.t('settings.connection.sourceRuntimeDescription')}</div>
          </div>
        </div>
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{i18n.t('settings.connection.sourceFlowNote')}</p>
      </div>

      <div>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowDetails(!showDetails())}
          aria-expanded={showDetails()}
        >
          <ChevronDown class={`h-3 w-3 transition-transform ${showDetails() ? '' : '-rotate-90'}`} />
          {i18n.t('settings.connection.troubleshootingDetails')}
        </button>
        <Show when={showDetails()}>
          <div class="mt-2 space-y-2.5 rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
            <DetailRow icon={Terminal} label={i18n.t('settings.connection.runtimeInstanceId')} value={String(conn()?.agent_instance_id ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
            <DetailRow icon={Hash} label={i18n.t('settings.connection.channelId')} value={String(direct()?.channel_id ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
            <DetailRow icon={Link} label={i18n.t('settings.connection.webSocketUrl')} value={String(direct()?.ws_url ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
            <DetailRow icon={Key} label={i18n.t('settings.connection.directSuite')} value={String(direct()?.default_suite ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
            <div class="flex min-w-0 items-start gap-2">
              <Hash class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <div class="min-w-0">
                <div class="text-[11px] text-muted-foreground">{i18n.t('settings.connection.channelInitExpiresAt')}</div>
                <code class="break-all text-[11px] font-mono text-foreground">
                  {direct()?.channel_init_expire_at_unix_s ? String(direct()!.channel_init_expire_at_unix_s) : i18n.t('settings.connection.emptyValue')}
                </code>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </SettingsSection>
  );
}
