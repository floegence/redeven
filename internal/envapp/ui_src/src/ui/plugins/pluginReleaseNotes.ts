import catalog from './officialPluginReleaseNotes.json';
import type { PluginDevelopmentDelivery, PluginPackageIdentity, PluginReleaseNotes } from './pluginTypes';
import type { PluginReleaseRef } from '@floegence/redevplugin-ui';

type ReleaseNotesRecord = (typeof catalog.releases)[number];

export function developmentReleaseNotes(delivery: PluginDevelopmentDelivery): PluginReleaseNotes | undefined {
  const record = catalog.releases.find((entry) => entry.release_id === delivery.release_notes_id
    && entry.plugin_id === delivery.plugin_id
    && entry.target_version === delivery.version);
  if (!record || record.summary_sha256 !== delivery.release_notes_summary_sha256) return undefined;
  return projectNotes(record, {
    packageHash: delivery.package_hash,
    manifestHash: delivery.manifest_hash,
    entriesHash: delivery.entries_hash,
  });
}

export function officialReleaseNotes(pluginID: string, releaseRef: PluginReleaseRef): PluginReleaseNotes | undefined {
  const record = catalog.releases.find((entry) => entry.plugin_id === pluginID
    && entry.target_version === releaseRef.version);
  if (!record) return undefined;
  return projectNotes(record, {
    packageHash: releaseRef.expected_hashes.package_sha256,
    manifestHash: releaseRef.expected_hashes.manifest_sha256,
    entriesHash: releaseRef.expected_hashes.entries_sha256,
  });
}

export function releaseNotesForIdentity(
  notes: PluginReleaseNotes | undefined,
  target: PluginPackageIdentity,
): PluginReleaseNotes | undefined {
  if (!notes?.binding) return undefined;
  return samePackageIdentity(notes.binding, target) ? notes : undefined;
}

function projectNotes(record: ReleaseNotesRecord, binding: PluginPackageIdentity): PluginReleaseNotes {
  return Object.freeze({
    releaseID: record.release_id,
    targetVersion: record.target_version,
    summaryKey: record.summary_key,
    featureKeys: Object.freeze([...record.feature_keys]),
    improvementKeys: Object.freeze([...record.improvement_keys]),
    fixKeys: Object.freeze([...record.fix_keys]),
    noticeKeys: Object.freeze([...record.notice_keys]),
    binding: Object.freeze({ ...binding, summaryHash: record.summary_sha256 }),
  });
}

export function samePackageIdentity(a: PluginPackageIdentity, b: PluginPackageIdentity): boolean {
  return a.packageHash === b.packageHash
    && a.manifestHash === b.manifestHash
    && a.entriesHash === b.entriesHash;
}
