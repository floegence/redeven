import { describe, expect, it } from 'vitest';

import {
  envWidgetTypeForSurface,
  isEnvViewMode,
  normalizePersistedEnvViewMode,
} from './envViewMode';

describe('envViewMode', () => {
  it('accepts only the activity/workbench view-mode contract', () => {
    expect(isEnvViewMode('activity')).toBe(true);
    expect(isEnvViewMode('workbench')).toBe(true);
    expect(isEnvViewMode('deck')).toBe(false);
    expect(isEnvViewMode('tab')).toBe(false);
    expect(isEnvViewMode('infinite_map')).toBe(false);
  });

  it('migrates old Deck persistence to Workbench', () => {
    expect(normalizePersistedEnvViewMode('activity')).toBe('activity');
    expect(normalizePersistedEnvViewMode('deck')).toBe('workbench');
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
