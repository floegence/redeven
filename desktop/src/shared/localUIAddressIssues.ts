export type LocalUIAddressIssueCode = 'interface_scan_failed' | 'bound_address_unavailable'
  | 'certificate_hosts_not_covered' | 'certificate_refresh_failed';

export type LocalUIAddressIssue = Readonly<{ code: LocalUIAddressIssueCode; hosts?: readonly string[] }>;

/** Optional diagnostics must not turn a healthy Runtime into a failed probe. */
export function parseLocalUIAddressIssues(value: unknown): readonly LocalUIAddressIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes: readonly string[] = ['interface_scan_failed', 'bound_address_unavailable', 'certificate_hosts_not_covered', 'certificate_refresh_failed'];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || !codes.includes(item.code)) return [];
    const hosts = Array.isArray(item.hosts) ? item.hosts.filter((host: unknown): host is string => typeof host === 'string') : [];
    return [{ code: item.code as LocalUIAddressIssueCode, ...(hosts.length ? { hosts } : {}) }];
  });
}
