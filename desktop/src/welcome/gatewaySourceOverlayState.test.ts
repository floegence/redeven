import { describe, expect, it } from 'vitest';

import {
  closeGatewaySourceOverlayState,
  closedGatewaySourceOverlayState,
  gatewaySourceOverlayOpenFor,
  openGatewaySourceOverlayState,
} from './gatewaySourceOverlayState';

describe('gatewaySourceOverlayState', () => {
  it('opens and closes a Gateway action popover by gateway id', () => {
    const open = openGatewaySourceOverlayState('action_popover', 'gw_demo');

    expect(gatewaySourceOverlayOpenFor(open, 'action_popover', 'gw_demo')).toBe(true);
    expect(closeGatewaySourceOverlayState(open, 'action_popover', 'gw_demo')).toEqual(closedGatewaySourceOverlayState());
  });
});
