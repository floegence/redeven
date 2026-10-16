import { describe, expect, it } from 'vitest';
import { closeEnvironmentLibraryOverlayState, closedEnvironmentLibraryOverlayState, environmentEndpointOverlaySelectedIDFor,
  environmentLibraryOverlayOpenFor, openEnvironmentLibraryOverlayState, selectEnvironmentEndpointOverlayState } from './environmentLibraryOverlayState';

describe('explicit environment overlay events', () => {
  it('opens and closes only the exact owner and surface', () => {
    const open = openEnvironmentLibraryOverlayState('runtime_menu', 'env_demo');
    expect(environmentLibraryOverlayOpenFor(open, 'runtime_menu', 'env_demo')).toBe(true);
    expect(closeEnvironmentLibraryOverlayState(open, 'runtime_menu', 'other')).toBe(open);
    expect(closeEnvironmentLibraryOverlayState(open, 'endpoints', 'env_demo')).toBe(open);
    expect(closeEnvironmentLibraryOverlayState(open, 'runtime_menu', 'env_demo')).toEqual(closedEnvironmentLibraryOverlayState());
  });
  it('keeps endpoint selection owned by the opened environment', () => {
    const state = selectEnvironmentEndpointOverlayState('env_demo', 'endpoint_one');
    expect(environmentEndpointOverlaySelectedIDFor(state, 'env_demo')).toBe('endpoint_one');
    expect(environmentEndpointOverlaySelectedIDFor(state, 'other')).toBeUndefined();
  });
});
