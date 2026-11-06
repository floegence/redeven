import type { PluginMarketLatestRelease, ExternalPluginInspection } from './pluginTypes';

export const EXAMPLE_PLUGIN_PACKAGE = {
  channel: 'stable', publisher_id: 'github.repo.1289352675', plugin_id: 'github.repo.1289352675.metrics', version: '4.4.9',
  package_sha256: '954894fbc63c3490fe011c9a6baf8985258a3c9c98a16827ed8342aaf438ed32',
  manifest_sha256: 'ab8c23c53758bba5165fd4d50c7972e94791dd1ccff75de02c51c554767fb12b',
  entries_sha256: '8b043db413f20ae08be6252f74bbd82fc17a82592192d40c9947a5fcb9983c0f',
  release_identity_digest: 'sha256:' + 'a'.repeat(64),
  source: { provider: 'github', repository_id: 1289352675, repository_owner: 'example', repository_name: 'example-plugins', release_id: 21, tag: 'metrics-v4.4.9', target_commit: 'a'.repeat(40) },
  asset: { asset_id: 22, name: 'metrics-4.4.9.redevplugin', url: 'https://github.com/example/example-plugins/releases/download/metrics-v4.4.9/metrics-4.4.9.redevplugin', size: 42, sha256: 'b'.repeat(64) },
} as const satisfies PluginMarketLatestRelease;

export const EXAMPLE_PACKAGE_HASHES = {
  package_sha256: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`,
  manifest_sha256: `sha256:${EXAMPLE_PLUGIN_PACKAGE.manifest_sha256}`,
  entries_sha256: `sha256:${EXAMPLE_PLUGIN_PACKAGE.entries_sha256}`,
};

export function exampleInspection(overrides: Partial<ExternalPluginInspection> = {}): ExternalPluginInspection {
  return {
    inspection_id: 'inspection-1', expires_at: '2099-01-01T00:00:00Z',
    intent: { action: 'install', plugin_instance_id: 'plugini_example_metrics' },
    publisher_id: EXAMPLE_PLUGIN_PACKAGE.publisher_id, plugin_id: EXAMPLE_PLUGIN_PACKAGE.plugin_id,
    version: EXAMPLE_PLUGIN_PACKAGE.version, inspected_hashes: EXAMPLE_PACKAGE_HASHES,
    source_provenance: { kind: 'package_upload', upload_id: 'upload-1', package_sha256: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`, resolved_at: '2026-11-05T00:00:00Z' },
    execution_approval: { state: 'pending', reason_codes: [], assessed_at: '2026-11-05T00:00:00Z' },
    update_eligibility: { state: 'manual_only', reason_codes: [], assessed_at: '2026-11-05T00:00:00Z' },
    security_summary: { summary_sha256: 'sha256:' + 'b'.repeat(64), permissions: [], methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [] },
    ...overrides,
  };
}
