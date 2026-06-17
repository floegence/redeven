import { describe, expect, it } from 'vitest';

import {
  envWidgetTypeForSurface,
  isEnvViewMode,
  normalizePersistedEnvViewMode,
} from './envViewMode';

describe('envViewMode', () => {
  it('accepts only the final activity/deck/workbench contract', () => {
    expect(isEnvViewMode('activity')).toBe(true);
    expect(isEnvViewMode('deck')).toBe(true);
    expect(isEnvViewMode('workbench')).toBe(true);
    expect(isEnvViewMode('tab')).toBe(false);
    expect(isEnvViewMode('infinite_map')).toBe(false);
  });

  it('accepts only final persisted modes', () => {
    expect(normalizePersistedEnvViewMode('activity')).toBe('activity');
    expect(normalizePersistedEnvViewMode('deck')).toBe('deck');
    expect(normalizePersistedEnvViewMode('workbench')).toBe('workbench');
    expect(normalizePersistedEnvViewMode('tab')).toBeNull();
    expect(normalizePersistedEnvViewMode('infinite_map')).toBeNull();
    expect(normalizePersistedEnvViewMode('unknown')).toBeNull();
  });

  it('maps surface ids to the shared widget catalog', () => {
    expect(envWidgetTypeForSurface('terminal')).toBe('redeven.terminal');
    expect(envWidgetTypeForSurface('codex')).toBe('redeven.codex');
  });
});
