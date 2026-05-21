import { fetchGatewayJSON } from '../../services/gatewayApi';
import type { ActivityDetailRef, ActivityItem } from '../types';
import { normalizeActivityDetail } from './activityDetailPresentation';
import type { ActivityDetailPresentation } from './activityDetailTypes';

export async function fetchActivityDetail(item: ActivityItem, ref: ActivityDetailRef): Promise<ActivityDetailPresentation> {
  let payload: unknown = {};
  if (ref.fetchMode === 'endpoint' && ref.endpoint) {
    payload = await fetchGatewayJSON<unknown>(ref.endpoint, { method: 'GET' });
  } else if (ref.fetchMode === 'inline') {
    payload = ref.payload ?? {};
  }
  return normalizeActivityDetail(item, ref, payload);
}

export function activityDetailCacheKey(item: ActivityItem, ref: ActivityDetailRef): string {
  return String(ref.refId || ref.endpoint || item.toolId || item.itemId).trim();
}
