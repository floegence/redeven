import { describe, expect, it } from 'vitest';

import {
  MANAGED_SERVICE_PROGRESS_ORB_PRESET,
  managedServiceShapingOrbShouldAnimate,
} from './ManagedServiceShapingOrb';

describe('managed service progress orb', () => {
  it('uses the thinking-orbs Shaping preset', () => {
    expect(MANAGED_SERVICE_PROGRESS_ORB_PRESET).toBe('shaping');
  });

  it('animates only while running, visible and motion is allowed', () => {
    expect(managedServiceShapingOrbShouldAnimate({ running: true, reducedMotion: false, visible: true, documentHidden: false })).toBe(true);
    expect(managedServiceShapingOrbShouldAnimate({ running: false, reducedMotion: false, visible: true, documentHidden: false })).toBe(false);
    expect(managedServiceShapingOrbShouldAnimate({ running: true, reducedMotion: true, visible: true, documentHidden: false })).toBe(false);
    expect(managedServiceShapingOrbShouldAnimate({ running: true, reducedMotion: false, visible: false, documentHidden: false })).toBe(false);
    expect(managedServiceShapingOrbShouldAnimate({ running: true, reducedMotion: false, visible: true, documentHidden: true })).toBe(false);
  });
});
