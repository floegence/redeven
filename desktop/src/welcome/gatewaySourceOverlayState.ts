export type GatewaySourceOverlayKind = 'action_popover' | 'more_actions_menu';

export type GatewaySourceOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: GatewaySourceOverlayKind; gateway_id: string }>;

export type GatewaySourceOverlayEntry = Readonly<{
  gateway_id: string;
}>;

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

export function gatewaySourceOverlayGatewayID(state: GatewaySourceOverlayState): string | null {
  return state.kind === 'none' ? null : state.gateway_id;
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

export function reconcileGatewaySourceOverlayState(
  state: GatewaySourceOverlayState,
  gatewaySources: readonly GatewaySourceOverlayEntry[],
): GatewaySourceOverlayState {
  if (state.kind === 'none') {
    return state;
  }

  return gatewaySources.some((gateway) => gateway.gateway_id === state.gateway_id)
    ? state
    : closedGatewaySourceOverlayState();
}

export function gatewaySourceIDsWithActiveOverlay(
  visibleGatewayIDs: readonly string[],
  allGatewayIDs: readonly string[],
  state: GatewaySourceOverlayState,
): readonly string[] {
  const activeGatewayID = gatewaySourceOverlayGatewayID(state);
  if (
    activeGatewayID === null
    || visibleGatewayIDs.includes(activeGatewayID)
    || !allGatewayIDs.includes(activeGatewayID)
  ) {
    return visibleGatewayIDs;
  }

  const visible = new Set(visibleGatewayIDs);
  return allGatewayIDs.filter((gatewayID) => gatewayID === activeGatewayID || visible.has(gatewayID));
}
