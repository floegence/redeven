export type GatewaySourceOverlayKind = 'action_popover';

export type GatewaySourceOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: GatewaySourceOverlayKind; connection_id: string }>;

export function closedGatewaySourceOverlayState(): GatewaySourceOverlayState {
  return { kind: 'none' };
}

export function openGatewaySourceOverlayState(
  kind: GatewaySourceOverlayKind,
  connectionID: string,
): GatewaySourceOverlayState {
  return {
    kind,
    connection_id: connectionID,
  };
}

export function gatewaySourceOverlayOpenFor(
  state: GatewaySourceOverlayState,
  kind: GatewaySourceOverlayKind,
  connectionID: string,
): boolean {
  return state.kind === kind && state.connection_id === connectionID;
}

export function closeGatewaySourceOverlayState(
  state: GatewaySourceOverlayState,
  kind: GatewaySourceOverlayKind,
  connectionID: string,
): GatewaySourceOverlayState {
  return gatewaySourceOverlayOpenFor(state, kind, connectionID)
    ? closedGatewaySourceOverlayState()
    : state;
}
