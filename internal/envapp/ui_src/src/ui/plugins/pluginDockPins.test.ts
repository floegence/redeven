// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  addPluginDockPin,
  loadPluginDockPins,
  pluginDockPinsStorageKey,
  savePluginDockPins,
} from './pluginDockPins';

afterEach(() => {
  localStorage.clear();
});

describe('plugin Dock pins', () => {
  it('persists ordered pins and restores them after a renderer remount', () => {
    const key = pluginDockPinsStorageKey('env-123');
    savePluginDockPins(key, ['instance:containers', 'instance:database']);

    expect(loadPluginDockPins(key)).toEqual([
      'instance:containers',
      'instance:database',
    ]);
  });

  it('adds a pin idempotently without changing the existing order', () => {
    expect(addPluginDockPin(['instance:containers'], 'instance:database')).toEqual([
      'instance:containers',
      'instance:database',
    ]);
    expect(addPluginDockPin(['instance:containers'], 'instance:containers')).toEqual([
      'instance:containers',
    ]);
  });

  it('fails closed for malformed and future persisted state', () => {
    const key = pluginDockPinsStorageKey('env-123');
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, inventoryKeys: ['instance:containers'] }));
    expect(loadPluginDockPins(key)).toEqual([]);

    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, inventoryKeys: ['', 7, 'instance:containers', 'instance:containers'] }));
    expect(loadPluginDockPins(key)).toEqual(['instance:containers']);
  });
});
