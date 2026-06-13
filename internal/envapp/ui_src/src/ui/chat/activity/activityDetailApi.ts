import { fetchGatewayJSON } from '../../services/gatewayApi';
import type { ActivityDetailRef, ActivityItem } from '../types';
import { normalizeActivityDetail } from './activityDetailPresentation';
import type { ActivityDetailPresentation } from './activityDetailTypes';

export async function fetchActivityDetail(item: ActivityItem, ref: ActivityDetailRef): Promise<ActivityDetailPresentation> {
  let payload: unknown = {};
  if (ref.fetch_mode === 'endpoint' && ref.endpoint) {
    payload = await fetchGatewayJSON<unknown>(ref.endpoint, { method: 'GET' });
  } else if (ref.fetch_mode === 'inline') {
    payload = ref.payload ?? {};
  }
  return normalizeActivityDetail(item, ref, payload);
}

export function activityDetailCacheKey(item: ActivityItem, ref: ActivityDetailRef): string {
  return String(ref.ref_id || ref.endpoint || item.tool_id || item.item_id).trim();
}
