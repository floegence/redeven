import { Show, createSignal, type JSX } from 'solid-js';
import { ChevronDown, Copy, Globe, Hash, Home, Link, ShieldCheck } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { CopyButton, SettingsSection } from '../SettingsPrimitives';
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
      <CopyButton value={value()} label={props.label} />
    </Show>
  );
}

function ConnectionStatusLine(props: Readonly<{ active: boolean; label: string }>) {
  return (
    <span class="inline-flex items-center gap-1.5 text-xs">
      <span class={`inline-block h-1.5 w-1.5 rounded-full ${props.active ? 'bg-success' : 'border border-warning/60 bg-warning/10'}`} />
      <span class={props.active ? 'text-foreground' : 'text-muted-foreground'}>{props.label}</span>
    </span>
  );
}

function ConnectionInfoRow(props: Readonly<{
  icon: IconComponent;
  label: string;
  technicalLabel?: string;
  description?: string;
  value: JSX.Element;
  action?: JSX.Element;
}>) {
  return (
    <div class="rounded-lg border border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)] px-4 py-3">
      <div class="grid min-w-0 gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] md:items-center">
        <div class="flex min-w-0 items-start gap-3">
          <span class="redeven-setting-row__icon mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md">
            <props.icon class="h-3.5 w-3.5" />
          </span>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-foreground">{props.label}</div>
            <Show when={props.technicalLabel}>
              <div class="mt-0.5 text-[11px] font-mono text-muted-foreground">{props.technicalLabel}</div>
            </Show>
            <Show when={props.description}>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{props.description}</p>
            </Show>
          </div>
        </div>
        <div class="min-w-0 md:text-right">{props.value}</div>
        <Show when={props.action}>
          <div class="flex md:justify-end">{props.action}</div>
        </Show>
      </div>
    </div>
  );
}

function TechnicalRow(props: Readonly<{ label: string; value: string; emptyLabel: string }>) {
  const value = () => String(props.value ?? '').trim();
  return (
    <tr class="border-t border-border/40 first:border-t-0">
      <th class="w-40 px-3 py-2 text-left align-top text-[11px] font-medium text-muted-foreground">{props.label}</th>
      <td class="px-3 py-2">
        <code class="break-all text-[11px] font-mono text-foreground">{value() || props.emptyLabel}</code>
      </td>
    </tr>
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
  const runtimeInstanceID = () => String(conn()?.agent_instance_id ?? '').trim();
  const e2eeReady = () => Boolean(direct()?.e2ee_psk_set);
  const hasConnectionInfo = () => Boolean(controlPlaneURL() || environmentID() || runtimeInstanceID());

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
      badge={i18n.t('settings.connection.readOnly')}
    >
      <div class="rounded-lg border border-[color-mix(in_srgb,var(--redeven-stroke-panel)_76%,transparent)] bg-[var(--redeven-settings-row-bg)] px-4 py-3">
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <ConnectionStatusLine
            active={hasConnectionInfo()}
            label={hasConnectionInfo() ? i18n.t('settings.connection.connectedRuntime') : i18n.t('settings.connection.incompleteConnectionInfo')}
          />
          <ConnectionStatusLine
            active={e2eeReady()}
            label={e2eeReady() ? i18n.t('settings.connection.keyProvisioned') : i18n.t('settings.connection.keyNotProvisioned')}
          />
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{i18n.t('settings.connection.coreInformation')}</div>
        <ConnectionInfoRow
          icon={Hash}
          label={i18n.t('settings.connection.currentEnvironmentId')}
          technicalLabel={i18n.t('settings.connection.environmentId')}
          action={<OptionalCopyButton value={environmentID()} label={i18n.t('settings.copyValue', { value: i18n.t('settings.connection.environmentId') })} />}
          value={
            <code class="block break-all font-mono text-sm leading-relaxed text-foreground">
              {valueOrEmpty(environmentID())}
            </code>
          }
        />
        <ConnectionInfoRow
          icon={Link}
          label={i18n.t('settings.connection.connectionServiceAddress')}
          technicalLabel={i18n.t('settings.connection.controlPlaneUrl')}
          action={<OptionalCopyButton value={controlPlaneURL()} label={i18n.t('settings.copyValue', { value: i18n.t('settings.connection.controlPlaneUrl') })} />}
          value={
            <code class="block break-all font-mono text-sm leading-relaxed text-foreground">
              {valueOrEmpty(controlPlaneURL())}
            </code>
          }
        />
        <ConnectionInfoRow
          icon={Hash}
          label={i18n.t('settings.connection.runtimeInstance')}
          technicalLabel={i18n.t('settings.connection.instanceId')}
          action={<OptionalCopyButton value={runtimeInstanceID()} label={i18n.t('settings.copyValue', { value: i18n.t('settings.connection.instanceId') })} />}
          value={
            <code class="block break-all font-mono text-sm leading-relaxed text-foreground">
              {valueOrEmpty(runtimeInstanceID())}
            </code>
          }
        />
        <ConnectionInfoRow
          icon={ShieldCheck}
          label={i18n.t('settings.connection.securityKey')}
          technicalLabel={i18n.t('settings.connection.e2eePsk')}
          description={i18n.t('settings.connection.securityKeyDescription')}
          value={
            <span class={e2eeReady() ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'}>
              {e2eeReady() ? i18n.t('settings.connection.keyProvisioned') : i18n.t('settings.connection.keyNotProvisioned')}
            </span>
          }
        />
      </div>

      <div class="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-foreground">{i18n.t('settings.connection.changeConnectionTitle')}</div>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i18n.t('settings.connection.changeConnectionDescription')}</p>
          </div>
          <Show when={desktopShellBridgeAvailable()}>
            <Button size="sm" variant="outline" icon={Home} onClick={() => void openConnectionManager()}>
              {i18n.t('settings.connection.manageConnection')}
            </Button>
          </Show>
        </div>
      </div>

      <div>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowDetails(!showDetails())}
          aria-expanded={showDetails()}
        >
          <ChevronDown class={`h-3 w-3 transition-transform ${showDetails() ? '' : '-rotate-90'}`} />
          {i18n.t('settings.connection.technicalInformation')}
        </button>
        <Show when={showDetails()}>
          <div class="mt-2 overflow-hidden rounded-lg border border-border/40 bg-muted/20">
            <table class="w-full table-fixed text-xs">
              <tbody>
                <TechnicalRow label={i18n.t('settings.connection.channelId')} value={String(direct()?.channel_id ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
                <TechnicalRow label={i18n.t('settings.connection.webSocketUrl')} value={String(direct()?.ws_url ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
                <TechnicalRow label={i18n.t('settings.connection.directSuite')} value={String(direct()?.default_suite ?? '')} emptyLabel={i18n.t('settings.connection.emptyValue')} />
                <TechnicalRow
                  label={i18n.t('settings.connection.channelInitExpiresAt')}
                  value={direct()?.channel_init_expire_at_unix_s ? String(direct()!.channel_init_expire_at_unix_s) : ''}
                  emptyLabel={i18n.t('settings.connection.emptyValue')}
                />
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </SettingsSection>
  );
}
