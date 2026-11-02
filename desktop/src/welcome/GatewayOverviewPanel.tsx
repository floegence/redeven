import { For, Show, createSignal, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Check, ChevronDown, ChevronRight, Copy, Globe, Monitor, Shield, Terminal } from '@floegence/floe-webapp-core/icons';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopI18n } from '../shared/i18n';
import { EnvironmentStatusIndicator } from './environmentCardPrimitives';

export function GatewayOverviewPanel(props: Readonly<{
  gateway?: DesktopGatewaySource;
  i18n: DesktopI18n;
  available: boolean;
  hostManaged: boolean;
  canManage: boolean;
  action: JSX.Element;
  saved: boolean;
  onNetwork: () => void;
  onClients: () => void;
  onRuntimes: () => void;
  onConnectRuntime: () => void;
}>) {
  const address = () => props.gateway?.endpoints?.map(endpoint => endpoint.address).join(', ') || props.gateway?.gateway_url;
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal(false);
  async function copyIdentity() {
    const identity = props.gateway?.identity_fingerprint;
    if (!identity) return;
    try { await navigator.clipboard.writeText(identity); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <div class="redeven-gateway-overview">
    <div class="redeven-gateway-section-heading">
      <h3>{props.i18n.t('gatewayExperience.overview')}</h3>{props.action}
    </div>
    <Show when={props.saved}><p role="status" class="redeven-gateway-saved"><Check aria-hidden="true" />{props.i18n.t('gatewayWorkspace.connectionSaved')}</p></Show>
    <section class="redeven-gateway-address-summary">
      <Globe aria-hidden="true" />
      <div><span class="redeven-gateway-eyebrow">{props.i18n.t('gatewayJoin.address')}</span><strong classList={{'text-muted-foreground': !address()}}>{address() || props.i18n.t('gatewayWorkspace.addressMissing')}</strong></div>
      <Show when={props.hostManaged}><Button size="sm" variant={address() ? 'ghost' : 'default'} icon={address() ? ChevronRight : Globe} disabled={!props.available} onClick={props.onNetwork}>{props.i18n.t(address() ? 'gatewayWorkspace.editAddress' : 'gatewayWorkspace.setAddress')}</Button></Show>
    </section>
    <Show when={props.hostManaged}><div class="redeven-gateway-overview-actions">
      <Button size="sm" variant={address() ? 'default' : 'outline'} icon={Monitor} disabled={!props.canManage} onClick={props.onClients}>{props.i18n.t('gatewayExperience.connectClient')}</Button>
      <Button size="sm" variant="outline" icon={Terminal} data-gateway-add-environment disabled={!props.canManage} onClick={props.onConnectRuntime}>{props.i18n.t('gatewayExperience.connectRuntime')}</Button>
    </div></Show>
    <section class="redeven-gateway-overview-runtime-section">
      <div class="redeven-gateway-section-heading"><h3><Terminal aria-hidden="true" />{props.i18n.t('gatewayClients.runtimes')}<span class="redeven-gateway-count">{props.gateway?.environments.length ?? 0}</span></h3><Button size="icon" variant="ghost" icon={ChevronRight} aria-label={props.i18n.t('environmentCenter.viewEnvironments')} onClick={props.onRuntimes} /></div>
      <Show when={props.gateway?.environments.length} fallback={<div class="redeven-gateway-quiet-empty"><Terminal aria-hidden="true" /><span>{props.i18n.t('gatewayWorkspace.emptyRuntimes')}</span></div>}>
        <ul class="redeven-gateway-overview-members"><For each={props.gateway?.environments}>{member => <li><span class="redeven-gateway-item-name"><Terminal aria-hidden="true" /><strong>{member.display_name}</strong></span><EnvironmentStatusIndicator tone={member.connected ? 'success' : 'neutral'}>{props.i18n.t(member.connected ? 'gatewayMembers.connected' : 'gatewayMembers.offline')}</EnvironmentStatusIndicator></li>}</For></ul>
      </Show>
    </section>
    <details class="redeven-gateway-identity-details"><summary><Shield aria-hidden="true" /><span>{props.i18n.t('gatewayWorkspace.identityDetails')}</span><ChevronDown aria-hidden="true" /></summary>
      <div><code>{props.gateway?.identity_fingerprint || '—'}</code><Button size="icon" variant="ghost" icon={Copy} aria-label={props.i18n.t(copied() ? 'environmentCenter.copied' : 'common.copy')} disabled={!props.gateway?.identity_fingerprint} onClick={() => void copyIdentity()} /></div>
      <Show when={copyError()}><p role="alert">{props.i18n.t('gatewayJoin.copyFailed')}</p></Show>
    </details>
  </div>;
}
