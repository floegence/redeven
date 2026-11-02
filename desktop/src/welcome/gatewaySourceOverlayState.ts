export type GatewaySourceOverlayKind = 'action_popover';

export type GatewaySourceOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: GatewaySourceOverlayKind; connection_id: string }>;

export function closedGatewaySourceOverlayState(): GatewaySourceOverlayState {
  return { kind: 'none' };
}

export function openGatewaySourceOverlayState(
  kind: GatewaySourceOverlayKind,
  gatewayID: string,
): GatewaySourceOverlayState {
  return {
    kind,
    connection_id: gatewayID,
  };
}

export function gatewaySourceOverlayOpenFor(
  state: GatewaySourceOverlayState,
  kind: GatewaySourceOverlayKind,
  gatewayID: string,
): boolean {
  return state.kind === kind && state.connection_id === gatewayID;
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
