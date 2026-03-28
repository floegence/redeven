import { describe, expect, it } from 'vitest';

import {
  REDEVEN_DIVIDER_ROLE_CLASS,
  REDEVEN_SURFACE_ROLE_CLASS,
  redevenDividerRoleClass,
  redevenSegmentedItemClass,
  redevenSurfaceRoleClass,
} from './redevenSurfaceRoles';

describe('redeven surface roles', () => {
  it('maps semantic surface roles to shared class contracts', () => {
    expect(REDEVEN_SURFACE_ROLE_CLASS.panel).toBe('redeven-surface-panel');
    expect(REDEVEN_SURFACE_ROLE_CLASS.panelInteractive).toContain('redeven-surface-panel--interactive');
    expect(REDEVEN_SURFACE_ROLE_CLASS.overlay).toBe('redeven-surface-overlay');
    expect(REDEVEN_SURFACE_ROLE_CLASS.controlMuted).toContain('redeven-surface-control--muted');
    expect(redevenSurfaceRoleClass('segmented')).toBe('redeven-surface-segmented');
  });

  it('maps divider roles and segmented items to shared class contracts', () => {
    expect(REDEVEN_DIVIDER_ROLE_CLASS.default).toBe('redeven-divider');
    expect(redevenDividerRoleClass('strong')).toContain('redeven-divider--strong');
    expect(redevenSegmentedItemClass(false)).toBe('redeven-surface-segmented__item');
    expect(redevenSegmentedItemClass(true)).toContain('redeven-surface-segmented__item--active');
  });
});
