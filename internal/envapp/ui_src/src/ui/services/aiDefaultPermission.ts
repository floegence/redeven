import { fetchLocalApiJSON } from './localApi';
import type { AIPermissionType, AgentSettingsResponse, SettingsUpdateResponse } from '../pages/settings/types';

const PERMISSION_TYPES: readonly AIPermissionType[] = ['readonly', 'approval_required', 'full_access'];

function isPermissionType(value: unknown): value is AIPermissionType {
  return typeof value === 'string' && PERMISSION_TYPES.includes(value as AIPermissionType);
}

function isSettingsResponse(value: unknown): value is AgentSettingsResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.config_path === 'string'
    && !!candidate.connection && typeof candidate.connection === 'object'
    && !!candidate.runtime && typeof candidate.runtime === 'object';
}

export async function updateDefaultAIPermission(permissionType: AIPermissionType): Promise<SettingsUpdateResponse> {
  if (!isPermissionType(permissionType)) throw new Error('Invalid AI permission type.');
  const response = await fetchLocalApiJSON<unknown>('/_redeven_proxy/api/ai/default_permission', {
    method: 'PUT',
    body: JSON.stringify({ permission_type: permissionType }),
  });
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Default AI permission update returned an invalid response.');
  }
  const settings = (response as Record<string, unknown>).settings;
  if (!isSettingsResponse(settings)) throw new Error('Default AI permission update did not return settings.');
  const returnedPermission = settings.ai && typeof settings.ai === 'object'
    ? (settings.ai as Record<string, unknown>).permission_type
    : undefined;
  if (!isPermissionType(returnedPermission)) {
    throw new Error('Default AI permission update did not return a confirmed permission.');
  }
  return response as SettingsUpdateResponse;
}
