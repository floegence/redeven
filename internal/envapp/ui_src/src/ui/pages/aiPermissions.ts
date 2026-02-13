import type { EnvironmentDetail } from '../services/controlplaneApi';

export function hasRWXPermissions(env: EnvironmentDetail | null | undefined): boolean {
  const p = env?.permissions;
  return Boolean(p?.can_read && p?.can_write && p?.can_execute);
}

