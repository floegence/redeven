/** Runtime Cloud wire contract: authorization and route are independent facts. */
export type CloudRouteSelection = Readonly<{kind: 'direct' | 'gateway'; member_id?: string}>;
export type RuntimeCloudStatus = Readonly<{
  association_revision: number; enabled: boolean;
  approval_state: 'approved' | 'pending' | 'revoked' | 'identity_required' | 'action_required';
  reason_code?: string; connection_state: string; route: CloudRouteSelection;
  route_revision: number; next_attempt_at_unix_ms?: number;
}>;
export type CloudRouteOperation = Readonly<{
  operation_id: string; expected_route_revision: number; association_revision: number;
  selection: CloudRouteSelection; state: 'awaiting_confirmation' | 'committed' | 'cancelled';
  expires_at_unix_ms: number; committed_route_revision?: number; reason_code?: string;
}>;
export type RuntimeCloudOperation =
  | Readonly<{operation: 'preflight'; operation_id: string; expected_route_revision: number; selection: CloudRouteSelection}>
  | Readonly<{operation: 'commit' | 'query' | 'cancel'; operation_id: string}>
  | Readonly<{operation: 'retry'; expected_association_revision: number}>;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export function normalizeCloudRouteSelection(value: unknown): CloudRouteSelection | null {
  const v = record(value);
  if (!v || Object.keys(v).some(key => !['kind','member_id'].includes(key))) return null;
  if (v.kind === 'direct' && v.member_id === undefined) return {kind: 'direct'};
  if (v.kind === 'gateway' && typeof v.member_id === 'string' && v.member_id.length > 0 && v.member_id.length <= 128) return {kind: 'gateway', member_id: v.member_id};
  return null;
}
export function normalizeRuntimeCloudStatus(value: unknown): RuntimeCloudStatus | undefined {
  const v = record(value), route = normalizeCloudRouteSelection(v?.route);
  if (!v || !route || !positive(v.association_revision) || !positive(v.route_revision) || typeof v.enabled !== 'boolean'
    || !['approved','pending','revoked','identity_required','action_required'].includes(String(v.approval_state))
    || typeof v.connection_state !== 'string' || v.connection_state.length > 64
    || v.reason_code !== undefined && (typeof v.reason_code !== 'string' || v.reason_code.length > 128)
    || v.next_attempt_at_unix_ms !== undefined && !positive(v.next_attempt_at_unix_ms)) return undefined;
  return {...v, route} as RuntimeCloudStatus;
}
export function normalizeCloudRouteOperation(value: unknown): CloudRouteOperation | null {
  const v = record(value), selection = normalizeCloudRouteSelection(v?.selection);
  if (!v || !selection || !/^[A-Za-z0-9_-]{43}$/u.test(String(v.operation_id)) || !positive(v.association_revision)
    || !positive(v.expected_route_revision) || !positive(v.expires_at_unix_ms)
    || !['awaiting_confirmation','committed','cancelled'].includes(String(v.state))
    || v.state === 'committed' && (!positive(v.committed_route_revision) || v.committed_route_revision !== Number(v.expected_route_revision)+1)) return null;
  return {...v, selection} as CloudRouteOperation;
}
export function normalizeRuntimeCloudOperation(value: unknown): RuntimeCloudOperation | null {
  const v = record(value);
  if (!v) return null;
  if (v.operation === 'retry' && positive(v.expected_association_revision) && Object.keys(v).every(key => ['operation','expected_association_revision'].includes(key))) return v as RuntimeCloudOperation;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(String(v.operation_id))) return null;
  if (['commit','query','cancel'].includes(String(v.operation)) && Object.keys(v).every(key => ['operation','operation_id'].includes(key))) return v as RuntimeCloudOperation;
  const selection = normalizeCloudRouteSelection(v.selection);
  if (v.operation === 'preflight' && positive(v.expected_route_revision) && selection && Object.keys(v).every(key => ['operation','operation_id','expected_route_revision','selection'].includes(key))) return {...v, selection} as RuntimeCloudOperation;
  return null;
}
