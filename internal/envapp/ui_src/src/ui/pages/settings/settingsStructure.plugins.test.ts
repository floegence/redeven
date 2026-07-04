// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { SETTINGS_NAV_ITEMS, settingsGroupForSection } from './settingsStructure';

describe('settings plugin center placement', () => {
  it('places Plugin Center in AI & Extensions exactly once', () => {
    const pluginItems = SETTINGS_NAV_ITEMS.filter((item) => item.id === 'plugins');
    expect(pluginItems).toHaveLength(1);
    expect(pluginItems[0].label).toBe('Plugin Center');
    expect(settingsGroupForSection('plugins').id).toBe('ai_extensions');
  });
});
