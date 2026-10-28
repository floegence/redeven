import type { EnvironmentCenterHost, EnvironmentEntry, EnvironmentOperationState, OpenTarget } from '../../../desktop/src/envcenter/contracts';
import { classifyEnvironmentFailure } from '../../../desktop/src/envcenter/core';
import type { Member, Operation, Route } from './contracts.generated';

export function webCenterEntry(route: Route, member: Member | undefined, sourceError: string): EnvironmentEntry & { route: Route } {
  const matched = member?.member_id === route.member_id && member.runtime_public_id === route.runtime_id ? member : undefined;
  const connected = matched?.connected === true && !sourceError;
  return { id: route.id, label: route.label || matched?.display_name || route.runtime_id,
    gateway_id: route.source_id, gateway_env_id: route.member_id,
    gateway_member: { connected, metadata: { hostname: matched?.metadata.hostname ?? route.runtime_id } },
    runtime_operations: { open: { availability: connected ? 'available' : 'unavailable' } }, route };
}
export function webCenterOperation(value: Operation): EnvironmentOperationState {
  return { id: value.id, sequence: value.sequence,
    status: value.status === 'connecting' ? 'running' : value.status === 'ready' ? 'succeeded' : value.status === 'canceled' ? 'canceled' : 'failed',
    failure: value.error ? classifyEnvironmentFailure(value.error) : undefined };
}
export function createWebCenterHost(open: (target: OpenTarget) => Promise<boolean>): EnvironmentCenterHost {
  return { focus: async () => false, invalidTarget: () => { throw new Error('CENTER_INVALID_TARGET'); },
    open: async target => ({ kind: 'navigation', accepted: await open(target) }) };
}
