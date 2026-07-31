import type { FlowerAttachmentStagingScope } from '../../flower_ui/src/contracts/flowerSurfaceContracts';

const STAGING_CAPABILITY_HEADER = 'Upload-Staging-Capability';
const STAGING_SCOPE_HEADER = 'Upload-Staging-Scope-ID';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function boundedSecret(value: unknown): string {
  const secret = trim(value);
  return secret && secret.length <= 1024 && !/[\r\n\0]/u.test(secret) ? secret : '';
}

export function normalizeFlowerAttachmentStagingScope(
  raw: unknown,
  capabilityHeader: unknown,
  expectedTargetID: string,
): FlowerAttachmentStagingScope {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const stagingScopeID = trim(record.staging_scope_id);
  const targetID = trim(record.target_id);
  const capability = boundedSecret(capabilityHeader);
  const expiresAt = Number(record.expires_at_unix_ms);
  if (!stagingScopeID || stagingScopeID.length > 200 || /[\r\n\0]/u.test(stagingScopeID)
    || !targetID || targetID !== trim(expectedTargetID)
    || !capability
    || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new Error('Flower attachment staging scope response is invalid.');
  }
  return {
    staging_scope_id: stagingScopeID,
    target_id: targetID,
    capability,
    expires_at_unix_ms: expiresAt,
  };
}

export function flowerAttachmentStagingHeaders(
  scope: FlowerAttachmentStagingScope,
): Readonly<Record<typeof STAGING_CAPABILITY_HEADER | typeof STAGING_SCOPE_HEADER, string>> {
  const scopeID = trim(scope.staging_scope_id);
  const capability = boundedSecret(scope.capability);
  if (!scopeID || scopeID.length > 200 || /[\r\n\0]/u.test(scopeID) || !capability) {
    throw new Error('Flower attachment staging scope is invalid.');
  }
  return {
    [STAGING_SCOPE_HEADER]: scopeID,
    [STAGING_CAPABILITY_HEADER]: capability,
  };
}

export function flowerStagingCapabilityHeaderName(): string {
  return STAGING_CAPABILITY_HEADER;
}
