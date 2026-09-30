import type { LocalUIAddressIssueCode } from './localUIAddressIssues';
import type { DesktopRuntimeHealth } from './desktopRuntimeHealth';
import type { DesktopRuntimeHostAccess, DesktopRuntimePlacement } from './desktopRuntimePlacement';
import { desktopRuntimeContainerReference } from './desktopRuntimePlacement';
import { desktopSSHAuthority } from './desktopSSH';
import { isLoopbackHost, isWildcardHost } from './desktopAccessModel';
import type { DesktopTranslationKey } from './i18n';

const addressOrder = new Intl.Collator('en', { numeric: true });

export type DesktopRuntimeConnectionContext = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
}>;

type ConnectionRowBase = Readonly<{
  id: string;
  label_key: DesktopTranslationKey;
  value: string;
  value_key?: DesktopTranslationKey;
  detail_key?: DesktopTranslationKey;
  detail_params?: Readonly<Record<string, string>>;
}>;

export type DesktopConnectionAddress = ConnectionRowBase & Readonly<{
  kind: 'address';
  detail_key: DesktopTranslationKey;
  access_scope: 'this_device' | 'network' | 'environment_only';
  copyable: boolean;
  browser_openable: boolean;
  shareable: boolean;
}>;

export type AddressRecoveryTarget = 'access' | 'certificate';

export type DesktopConnectionRow = DesktopConnectionAddress
  | (ConnectionRowBase & Readonly<{ kind: 'connection'; copyable: boolean }>)
  | (ConnectionRowBase & Readonly<{ kind: 'status'; value_key: DesktopTranslationKey; recovery?: AddressRecoveryTarget }>);

export type DesktopShareableConnectionAddress = DesktopConnectionAddress & Readonly<{ shareable: true }>;

export function isShareableConnectionAddress(row: DesktopConnectionRow): row is DesktopShareableConnectionAddress {
  return row.kind === 'address' && row.shareable;
}

/** An explicitly empty reported list is authoritative, including after Stop. */
export function reportedRuntimeURLs(report: Readonly<{
  local_ui_url?: string;
  local_ui_urls?: readonly string[];
}> | null | undefined): readonly string[] {
  return report?.local_ui_urls ?? (report?.local_ui_url ? [report.local_ui_url] : []);
}

export function runtimeConnectionIsOnThisDevice(context: DesktopRuntimeConnectionContext): boolean {
  return context.host_access.kind === 'local_host' && context.placement.kind === 'host_process';
}

export function runtimeConnectionRows(context: DesktopRuntimeConnectionContext): readonly DesktopConnectionRow[] {
  const host = context.host_access;
  const rows: DesktopConnectionRow[] = [host.kind === 'ssh_host'
    ? { id: 'host', kind: 'connection', label_key: 'environmentFacts.sshHost', value: desktopSSHAuthority(host.ssh), copyable: true }
    : host.kind === 'wsl_host'
      ? { id: 'host', kind: 'connection', label_key: 'environmentConnection.wsl', value: `${host.distribution_name} · ${host.linux_user}`, copyable: true }
      : { id: 'host', kind: 'connection', label_key: 'environmentFacts.runsOn', value: '', value_key: 'environmentFacts.thisDevice', copyable: false }];
  if (context.placement.kind === 'container_process') {
    rows.push({
      id: 'container', kind: 'connection', label_key: 'environmentFacts.container',
      value: `${context.placement.container_engine} · ${desktopRuntimeContainerReference(context.placement)}`,
      copyable: true,
    });
  }
  return rows;
}

/** Public addresses retain their Runtime namespace; never substitute the SSH host. */
export function connectionAddressRows(
  urls: readonly string[],
  context?: DesktopRuntimeConnectionContext,
): readonly DesktopConnectionAddress[] {
  const rows: DesktopConnectionAddress[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isWildcardHost(hostname)) continue;
    const value = url.toString();
    if (seen.has(value)) continue;
    seen.add(value);
    const loopback = isLoopbackHost(hostname) || hostname.endsWith('.localhost');
    const onThisDevice = !context || runtimeConnectionIsOnThisDevice(context);
    const usable = !loopback || onThisDevice;
    const host = context?.host_access;
    const placement = context?.placement;
    const detailKey: DesktopTranslationKey = !loopback
      ? 'environmentConnection.networkAddress'
      : onThisDevice
        ? 'environmentConnection.thisDeviceOnly'
        : placement?.kind === 'container_process'
          ? 'environmentConnection.containerOnly'
          : host?.kind === 'wsl_host'
            ? 'environmentConnection.wslOnly'
            : 'environmentConnection.hostOnly';
    rows.push({
      id: `address:${value}`, kind: 'address', value,
      access_scope: !loopback ? 'network' : onThisDevice ? 'this_device' : 'environment_only',
      label_key: !loopback ? 'environmentConnection.networkAccessAddress'
        : onThisDevice ? 'environmentConnection.deviceAddress' : 'environmentConnection.browserAccess',
      copyable: usable, browser_openable: usable, shareable: !loopback,
      detail_key: detailKey,
      ...(!loopback || onThisDevice ? {} : { detail_params: {
        host: placement?.kind === 'container_process'
          ? desktopRuntimeContainerReference(placement)
          : host?.kind === 'wsl_host' ? host.distribution_name
            : host?.kind === 'ssh_host' ? host.ssh.ssh_destination : '',
      } }),
    });
  }
  // Runtime enumeration order is not presentation identity. Keep existing URLs stationary on refresh.
  return rows.sort((left, right) => Number(!left.browser_openable) - Number(!right.browser_openable)
    || addressOrder.compare(left.value, right.value)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function runtimeAddressStatus(health: DesktopRuntimeHealth): DesktopConnectionRow {
  const valueKey: DesktopTranslationKey = health.freshness === 'checking'
    ? 'environmentConnection.checking'
    : health.freshness === 'unknown'
      ? 'environmentConnection.notChecked'
      : health.freshness === 'failed'
        ? 'environmentConnection.unconfirmed'
        : health.status === 'online'
          ? 'environmentConnection.addressUnavailable'
          : health.offline_reason_code === 'not_started' || health.offline_reason_code === 'container_not_running'
            ? 'environmentFacts.notRunning'
            : 'environmentConnection.unconfirmed';
  return { id: 'status', kind: 'status', label_key: 'environmentFacts.status', value: '', value_key: valueKey };
}

export function buildRuntimeConnectionRows(input: Readonly<{
  context: DesktopRuntimeConnectionContext;
  urls: readonly string[];
  health: DesktopRuntimeHealth;
}>): readonly DesktopConnectionRow[] {
  const addresses = connectionAddressRows(input.urls, input.context);
  const diagnostics: Record<LocalUIAddressIssueCode, { key: DesktopTranslationKey; recovery?: AddressRecoveryTarget }> = {
    interface_scan_failed: { key: 'environmentConnection.interfaceScanFailed' },
    bound_address_unavailable: { key: 'environmentConnection.boundAddressUnavailable', recovery: 'access' },
    certificate_hosts_not_covered: { key: 'environmentConnection.certificateHostsNotCovered', recovery: 'certificate' },
    certificate_refresh_failed: { key: 'environmentConnection.certificateRefreshFailed', recovery: 'certificate' },
  };
  const issues: DesktopConnectionRow[] = (input.health.local_ui_address_issues ?? []).map(issue => ({
    id: `address-issue:${issue.code}`, kind: 'status', label_key: 'environmentConnection.networkAccessAddress',
    value: '', value_key: diagnostics[issue.code].key, recovery: diagnostics[issue.code].recovery,
  }));
  return [...runtimeConnectionRows(input.context), ...issues, ...(addresses.length ? addresses : issues.length ? [] : [runtimeAddressStatus(input.health)])];
}
