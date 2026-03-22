import type { PermissionPolicy, PermissionRow, PermissionSet } from './types';

function normalizeRuleKey(raw: string): string {
  return String(raw ?? '').trim();
}

function mapRulePermissions(localMax: PermissionSet, row: PermissionRow): PermissionSet {
  return {
    read: localMax.read ? !!row.read : false,
    write: localMax.write ? !!row.write : false,
    execute: localMax.execute ? !!row.execute : false,
  };
}

function validateRuleKey(
  scope: 'by_user' | 'by_app',
  rowIndex: number,
  key: string,
): string {
  if (key) {
    return key;
  }
  if (scope === 'by_user') {
    throw new Error(`User rule ${rowIndex + 1} is incomplete. Fill in the user id or remove the row.`);
  }
  throw new Error(`App rule ${rowIndex + 1} is incomplete. Fill in the app id or remove the row.`);
}

function rowsToPermissionMap(
  scope: 'by_user' | 'by_app',
  rows: PermissionRow[],
  localMax: PermissionSet,
): Record<string, PermissionSet> {
  const out: Record<string, PermissionSet> = {};
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const key = validateRuleKey(scope, index, normalizeRuleKey(row?.key ?? ''));
    if (out[key]) {
      throw new Error(`Duplicate ${scope} key: ${key}`);
    }
    out[key] = mapRulePermissions(localMax, row);
  }
  return out;
}

export function buildPermissionPolicyValue(
  localMax: PermissionSet,
  byUserRows: PermissionRow[],
  byAppRows: PermissionRow[],
): PermissionPolicy {
  const by_user = rowsToPermissionMap('by_user', byUserRows, localMax);
  const by_app = rowsToPermissionMap('by_app', byAppRows, localMax);

  const out: PermissionPolicy = {
    schema_version: 1,
    local_max: localMax,
  };

  if (Object.keys(by_user).length > 0) {
    (out as PermissionPolicy & { by_user: Record<string, PermissionSet> }).by_user = by_user;
  }
  if (Object.keys(by_app).length > 0) {
    (out as PermissionPolicy & { by_app: Record<string, PermissionSet> }).by_app = by_app;
  }

  return out;
}
