import { describe, expect, it } from 'vitest';
import { parseStartupReport } from './startup';

describe('current public startup addresses', () => {
  const privateBridge = { local_ui_bridge_url: 'http://127.0.0.1:43123/', local_ui_bridge_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  it('keeps an explicit empty list authoritative over an old singular address', () => {
    expect(parseStartupReport(JSON.stringify({ ...privateBridge, local_ui_url: 'http://192.0.2.10:23998/', local_ui_urls: [],
      local_ui_address_issues: [{ code: 'bound_address_unavailable', hosts: ['192.0.2.10'] }],
    }))).toMatchObject({ local_ui_url: '', local_ui_urls: [], local_ui_address_issues: [{ code: 'bound_address_unavailable', hosts: ['192.0.2.10'] }] });
  });
  it('reads the singular address only when the list is absent and never substitutes the bridge', () => {
    expect(parseStartupReport(JSON.stringify(privateBridge)).local_ui_urls).toEqual([]);
    expect(parseStartupReport(JSON.stringify({ ...privateBridge, local_ui_url: 'http://192.0.2.20:23998/' })).local_ui_urls).toEqual(['http://192.0.2.20:23998/']);
  });
  it('ignores unknown diagnostics without losing runtime readiness', () => {
    const report = parseStartupReport(JSON.stringify({ ...privateBridge, local_ui_address_issues: [{ code: 'future_diagnostic' }, null, {}] }));
    expect(report.local_ui_address_issues).toEqual([]);
  });
});
