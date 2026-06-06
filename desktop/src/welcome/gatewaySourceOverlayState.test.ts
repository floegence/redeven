import { describe, expect, it } from 'vitest';

import {
  closeGatewaySourceOverlayState,
  closedGatewaySourceOverlayState,
  gatewaySourceIDsWithActiveOverlay,
  gatewaySourceOverlayOpenFor,
  openGatewaySourceOverlayState,
  reconcileGatewaySourceOverlayState,
} from './gatewaySourceOverlayState';

describe('gatewaySourceOverlayState', () => {
  it('opens and closes a Gateway action popover by gateway id', () => {
    const open = openGatewaySourceOverlayState('action_popover', 'gw_demo');

    expect(gatewaySourceOverlayOpenFor(open, 'action_popover', 'gw_demo')).toBe(true);
    expect(closeGatewaySourceOverlayState(open, 'action_popover', 'gw_demo')).toEqual(closedGatewaySourceOverlayState());
  });

  it('keeps a user-open Gateway overlay across refresh while the Gateway source still exists', () => {
    const state = openGatewaySourceOverlayState('action_popover', 'gw_demo');

    expect(reconcileGatewaySourceOverlayState(state, [
      { gateway_id: 'gw_demo' },
      { gateway_id: 'gw_other' },
    ])).toEqual(state);
  });

  it('closes a user-open Gateway overlay only when its Gateway source is gone', () => {
    const state = openGatewaySourceOverlayState('action_popover', 'gw_demo');

    expect(reconcileGatewaySourceOverlayState(state, [
      { gateway_id: 'gw_other' },
    ])).toEqual(closedGatewaySourceOverlayState());
  });

  it('keeps the active Gateway card rendered when refresh filters temporarily hide it', () => {
    const state = openGatewaySourceOverlayState('action_popover', 'gw_hidden');

    expect(gatewaySourceIDsWithActiveOverlay(
      ['gw_visible'],
      ['gw_hidden', 'gw_visible'],
      state,
    )).toEqual(['gw_hidden', 'gw_visible']);
  });

  it('does not retain a hidden Gateway card without an active overlay', () => {
    expect(gatewaySourceIDsWithActiveOverlay(
      ['gw_visible'],
      ['gw_hidden', 'gw_visible'],
      closedGatewaySourceOverlayState(),
    )).toEqual(['gw_visible']);
  });
});
