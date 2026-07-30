import { developmentReleaseNotes, releaseNotesForIdentity, samePackageIdentity } from './pluginReleaseNotes';
import type {
  ExternalPluginInspection,
  PluginInventoryItem,
  PluginPackageIdentity,
  PluginUpdateCandidate,
  PluginUpdateIntent,
} from './pluginTypes';

export function createPluginUpdateIntent(item: PluginInventoryItem): PluginUpdateIntent {
  if (!item.pluginInstanceID || item.managementRevision === undefined) {
    throw new Error('Installed plugin identity is required to review an update');
  }
  return Object.freeze({
    inventoryKey: item.inventoryKey,
    pluginID: item.pluginID,
    pluginInstanceID: item.pluginInstanceID,
    expectedManagementRevision: item.managementRevision,
  });
}

export function createDevelopmentUpdateCandidate(item: PluginInventoryItem): PluginUpdateCandidate {
  const delivery = item.officialCatalog?.distribution.developmentDelivery;
  if (!delivery) throw new Error('Development delivery is unavailable');
  const target = packageIdentity(delivery.package_hash, delivery.manifest_hash, delivery.entries_hash);
  const notes = developmentReleaseNotes(delivery);
  if (!notes) throw new Error('Development release notes do not match the reviewed delivery');
  return Object.freeze({
    intent: createPluginUpdateIntent(item),
    displayName: item.displayName,
    publisher: item.publisher,
    installedVersion: item.version ?? '',
    targetVersion: delivery.version,
    kind: classifyUpdate(item.version, delivery.version, item.installedPackage, target, true),
    target,
    releaseNotes: notes,
    reviewEvidence: Object.freeze({
      kind: 'development_delivery' as const,
      packageInspection: 'unavailable' as const,
      capabilityVersion: delivery.capability_version,
    }),
  });
}

export function createExternalUpdateCandidate(
  item: PluginInventoryItem,
  inspection: ExternalPluginInspection,
): PluginUpdateCandidate {
  const target = packageIdentity(
    inspection.inspected_hashes.package_sha256,
    inspection.inspected_hashes.manifest_sha256,
    inspection.inspected_hashes.entries_sha256,
  );
  return Object.freeze({
    intent: createPluginUpdateIntent(item),
    displayName: item.displayName,
    publisher: item.publisher,
    installedVersion: item.version ?? '',
    targetVersion: inspection.version,
    kind: classifyUpdate(item.version, inspection.version, item.installedPackage, target, false),
    target,
    releaseNotes: releaseNotesForIdentity(item.officialCatalog?.releaseNotes, target),
    reviewEvidence: Object.freeze({ kind: 'external_inspection' as const, inspection }),
  });
}

export function candidateMatchesInventory(candidate: PluginUpdateCandidate, item: PluginInventoryItem | undefined): boolean {
  return Boolean(item
    && item.inventoryKey === candidate.intent.inventoryKey
    && item.pluginInstanceID === candidate.intent.pluginInstanceID
    && item.managementRevision === candidate.intent.expectedManagementRevision);
}

export function candidateTargetIsCurrent(candidate: PluginUpdateCandidate, item: PluginInventoryItem | undefined): boolean {
  if (!candidateMatchesInventory(candidate, item)) return false;
  if (candidate.reviewEvidence.kind === 'external_inspection') {
    return Date.parse(candidate.reviewEvidence.inspection.expires_at) > Date.now();
  }
  const delivery = item?.officialCatalog?.distribution.developmentDelivery;
  if (!delivery) return false;
  return delivery.release_notes_id === candidate.releaseNotes?.releaseID
    && delivery.release_notes_summary_sha256 === candidate.releaseNotes?.binding?.summaryHash
    && samePackageIdentity(candidate.target, {
      packageHash: delivery.package_hash,
      manifestHash: delivery.manifest_hash,
      entriesHash: delivery.entries_hash,
    });
}

function classifyUpdate(
  installedVersion: string | undefined,
  targetVersion: string,
  installed: PluginPackageIdentity | undefined,
  target: PluginPackageIdentity,
  development: boolean,
): PluginUpdateCandidate['kind'] {
  if (installed && samePackageIdentity(installed, target)) return 'noop';
  const comparison = compareSemVer(installedVersion, targetVersion);
  if (comparison > 0) return 'blocked';
  if (comparison < 0) return 'version_update';
  return development ? 'development_build' : 'replace';
}

function compareSemVer(left: string | undefined, right: string): number {
  const a = parseSemVer(left);
  const b = parseSemVer(right);
  if (!a || !b) return left === right ? 0 : -1;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

function parseSemVer(value: string | undefined): readonly number[] | undefined {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function packageIdentity(packageHash: string, manifestHash: string, entriesHash: string): PluginPackageIdentity {
  return Object.freeze({ packageHash, manifestHash, entriesHash });
}
