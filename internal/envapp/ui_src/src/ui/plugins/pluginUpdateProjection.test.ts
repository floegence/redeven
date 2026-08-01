import { describe, expect, it, vi } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED, officialPluginCatalogFixture as officialPluginCatalog } from './officialPluginCatalog.test-fixture';
import {
  candidateTargetIsCurrent,
  createDevelopmentUpdateCandidate,
  createExternalUpdateCandidate,
} from './pluginUpdateProjection';
import type { ExternalPluginInspection, PluginDevelopmentDelivery, PluginInventoryItem } from './pluginTypes';

const delivery: PluginDevelopmentDelivery = {
  plugin_instance_id: 'plugini_redeven_official_containers',
  publisher_id: 'com.redeven.official',
  plugin_id: 'com.redeven.official.containers',
  version: '4.0.0',
  package_url: '/development/containers.redevplugin',
  package_sha256: 'a'.repeat(64),
  package_hash: 'sha256:target-package',
  manifest_hash: 'sha256:target-manifest',
  entries_hash: 'sha256:target-entries',
  capability_version: '3.0.0',
  release_notes_id: 'containers-4.0.0',
  release_notes_summary_sha256: '0bdb5e7ab960173b2855cf31fef9f3d635f90325b90215fa10e6bb639459504e',
  source_repository: 'https://github.com/floegence/redeven-official-plugins.git',
  source_commit: 'b9eb04f6cc08eab35e0d0a8a5ac671ec5077aaed',
  development_only: true,
};

function developmentItem(overrides: Partial<PluginInventoryItem> = {}): PluginInventoryItem {
  return {
    inventoryKey: 'instance:plugini_redeven_official_containers',
    pluginID: delivery.plugin_id,
    pluginInstanceID: delivery.plugin_instance_id,
    displayName: 'Containers',
    description: 'Containers',
    iconFallback: 'containers',
    category: 'infrastructure',
    searchKeywords: [],
    publisher: 'Redeven',
    version: '4.0.0',
    managementRevision: 8,
    installedPackage: { packageHash: 'sha256:old', manifestHash: 'sha256:old', entriesHash: 'sha256:old' },
    lifecycleState: 'update_available',
    trustBadge: 'unsigned',
    pinned: false,
    officialCatalog: officialPluginCatalog(delivery)[0],
    ...overrides,
  };
}

function inspection(version: string, packageHash = 'sha256:new'): ExternalPluginInspection {
  return {
    inspection_id: 'inspection_update_projection',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    intent: { action: 'update', plugin_instance_id: delivery.plugin_instance_id, expected_management_revision: 8 },
    publisher_id: delivery.publisher_id,
    plugin_id: delivery.plugin_id,
    version,
    inspected_hashes: { package_sha256: packageHash, manifest_sha256: 'sha256:new-manifest', entries_sha256: 'sha256:new-entries' },
    signature_assessment: { state: 'verified', reason_codes: [], assessed_hashes: { package_sha256: packageHash, manifest_sha256: 'sha256:new-manifest', entries_sha256: 'sha256:new-entries' }, assessed_at: new Date().toISOString() },
    source_provenance: { kind: 'package_url', source_origin: 'https://example.com', source_path: '/plugin', redirect_chain: [], package_sha256: packageHash, resolved_at: new Date().toISOString() },
    execution_approval: { state: 'policy_approved', reason_codes: [], assessed_at: new Date().toISOString() },
    update_eligibility: { state: 'automatic_eligible', reason_codes: [], assessed_at: new Date().toISOString() },
    security_summary: { summary_sha256: 'sha256:summary', permissions: [], methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [] },
    confirmation_digest: 'sha256:confirmation',
  };
}

describe('plugin update projection', () => {
  it('classifies a same-version changed development package as a new build', () => {
    const candidate = createDevelopmentUpdateCandidate(developmentItem());
    expect(candidate.kind).toBe('development_build');
    expect(candidate.releaseNotes?.releaseID).toBe('containers-4.0.0');
    expect(candidate.reviewEvidence).toMatchObject({ kind: 'development_delivery', packageInspection: 'unavailable' });
    expect(candidateTargetIsCurrent(candidate, developmentItem())).toBe(true);
  });

  it('classifies upgrades, replacements, exact packages, and downgrades without view-specific rules', () => {
    const base = developmentItem({ officialCatalog: OFFICIAL_PLUGIN_CATALOG_SEED[0] });
    expect(createExternalUpdateCandidate({ ...base, version: '1.0.0' }, inspection('2.0.0')).kind).toBe('version_update');
    expect(createExternalUpdateCandidate(base, inspection('4.0.0')).kind).toBe('replace');
    expect(createExternalUpdateCandidate({ ...base, installedPackage: { packageHash: 'sha256:new', manifestHash: 'sha256:new-manifest', entriesHash: 'sha256:new-entries' } }, inspection('4.0.0')).kind).toBe('noop');
    expect(createExternalUpdateCandidate({ ...base, version: '5.0.0' }, inspection('4.0.0')).kind).toBe('blocked');
  });

  it('invalidates changed revisions, delivery hashes, notes, and expired inspections', () => {
    const candidate = createDevelopmentUpdateCandidate(developmentItem());
    expect(candidateTargetIsCurrent(candidate, developmentItem({ managementRevision: 9 }))).toBe(false);
    const changedCatalog = officialPluginCatalog({ ...delivery, package_hash: 'sha256:changed' })[0];
    expect(candidateTargetIsCurrent(candidate, developmentItem({ officialCatalog: changedCatalog }))).toBe(false);
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const external = createExternalUpdateCandidate(developmentItem(), { ...inspection('4.0.0'), expires_at: '2026-01-01T00:00:00Z' });
    expect(candidateTargetIsCurrent(external, developmentItem())).toBe(false);
    vi.useRealTimers();
  });
});
