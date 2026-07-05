// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { SETTINGS_GROUPS, SETTINGS_NAV_ITEMS } from './settingsStructure';

describe('settings plugin center placement', () => {
  it('keeps Plugin Center out of Runtime Settings navigation', () => {
    expect(SETTINGS_NAV_ITEMS.some((item) => String(item.id) === 'plugins')).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((item) => item.label === 'Plugin Center')).toBe(false);
    expect(SETTINGS_GROUPS.some((group) => (group.sections as readonly string[]).includes('plugins'))).toBe(false);
  });
});
