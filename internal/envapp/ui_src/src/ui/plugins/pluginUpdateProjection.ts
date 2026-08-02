import { releaseNotesForIdentity, samePackageIdentity } from './pluginReleaseNotes';
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
    kind: classifyUpdate(item.version, inspection.version, item.installedPackage, target),
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
  return false;
}

function classifyUpdate(
  installedVersion: string | undefined,
  targetVersion: string,
  installed: PluginPackageIdentity | undefined,
  target: PluginPackageIdentity,
): PluginUpdateCandidate['kind'] {
  if (installed && samePackageIdentity(installed, target)) return 'noop';
  const comparison = compareSemVer(installedVersion, targetVersion);
  if (comparison > 0) return 'blocked';
  if (comparison < 0) return 'version_update';
  return 'replace';
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
