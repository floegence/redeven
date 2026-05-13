import { describe, expect, it } from 'vitest';

import { normalizeDesktopRuntimeMaintenanceRequirement } from './desktopRuntimeHealth';

describe('desktopRuntimeHealth', () => {
  it('normalizes SSH runtime maintenance requirements', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: ' desktop_model_source_requires_runtime_update ',
      required_for: ' desktop_model_source ',
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: ' 1 terminal ',
      current_runtime_version: ' v0.5.9 ',
      target_runtime_version: ' v0.6.7 ',
      message: ' Update required. ',
    })).toEqual({
      kind: 'desktop_model_source_requires_runtime_update',
      required_for: 'desktop_model_source',
      can_desktop_restart: true,
      has_active_work: true,
      active_work_label: '1 terminal',
      current_runtime_version: 'v0.5.9',
      target_runtime_version: 'v0.6.7',
      message: 'Update required.',
    });
  });

  it('rejects unknown maintenance kinds', () => {
    expect(normalizeDesktopRuntimeMaintenanceRequirement({
      kind: 'unknown',
      message: 'nope',
    })).toBeUndefined();
  });
});
