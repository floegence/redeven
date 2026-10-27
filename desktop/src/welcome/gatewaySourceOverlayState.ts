export type GatewaySourceOverlayKind = 'action_popover';

export type GatewaySourceOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: GatewaySourceOverlayKind; gateway_id: string }>;

export function closedGatewaySourceOverlayState(): GatewaySourceOverlayState {
  return { kind: 'none' };
}

export function openGatewaySourceOverlayState(
  kind: GatewaySourceOverlayKind,
  gatewayID: string,
): GatewaySourceOverlayState {
  return {
    kind,
    gateway_id: gatewayID,
  };
}

export function gatewaySourceOverlayOpenFor(
  state: GatewaySourceOverlayState,
  kind: GatewaySourceOverlayKind,
  gatewayID: string,
): boolean {
  return state.kind === kind && state.gateway_id === gatewayID;
}

export function closeGatewaySourceOverlayState(
  state: GatewaySourceOverlayState,
  kind: GatewaySourceOverlayKind,
  gatewayID: string,
): GatewaySourceOverlayState {
  return gatewaySourceOverlayOpenFor(state, kind, gatewayID)
    ? closedGatewaySourceOverlayState()
    : state;
}
