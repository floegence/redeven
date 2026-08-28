// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  hasPluginPlacementPin,
  loadPluginPlacementPins,
  pluginDockPinsStorageKey,
  savePluginPlacementPins,
  setPluginPlacementPin,
} from './pluginDockPins';

afterEach(() => {
  window.localStorage.clear();
});

describe('plugin placement pins', () => {
  it('persists independent ordered Activity and Workbench pins', () => {
    const key = pluginDockPinsStorageKey('env-123');
    savePluginPlacementPins(key, {
      activityInventoryKeys: ['instance:database', 'instance:metrics'],
      workbenchInventoryKeys: ['instance:metrics', 'instance:database'],
    });

    expect(loadPluginPlacementPins(key)).toEqual({
      activityInventoryKeys: ['instance:database', 'instance:metrics'],
      workbenchInventoryKeys: ['instance:metrics', 'instance:database'],
    });
  });

  it('migrates the v1 Dock order into the Workbench list exactly once', () => {
    const key = pluginDockPinsStorageKey('env-123');
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      inventoryKeys: ['instance:metrics', '', 7, 'instance:database', 'instance:metrics'],
    }));

    expect(loadPluginPlacementPins(key)).toEqual({
      activityInventoryKeys: [],
      workbenchInventoryKeys: ['instance:metrics', 'instance:database'],
    });
    expect(JSON.parse(window.localStorage.getItem(key) ?? '{}')).toEqual({
      schemaVersion: 2,
      activityInventoryKeys: [],
      workbenchInventoryKeys: ['instance:metrics', 'instance:database'],
    });
  });

  it('adds and removes each placement idempotently without disturbing the other list', () => {
    const initial = {
      activityInventoryKeys: ['instance:metrics'],
      workbenchInventoryKeys: ['instance:database'],
    };
    const activityAdded = setPluginPlacementPin(initial, 'activity', 'instance:database', true);
    expect(activityAdded).toEqual({
      activityInventoryKeys: ['instance:metrics', 'instance:database'],
      workbenchInventoryKeys: ['instance:database'],
    });
    expect(setPluginPlacementPin(activityAdded, 'activity', 'instance:database', true)).toEqual(activityAdded);
    expect(setPluginPlacementPin(activityAdded, 'workbench', 'instance:database', false)).toEqual({
      activityInventoryKeys: ['instance:metrics', 'instance:database'],
      workbenchInventoryKeys: [],
    });
    expect(hasPluginPlacementPin(activityAdded, 'activity', 'instance:database')).toBe(true);
    expect(hasPluginPlacementPin(activityAdded, 'workbench', 'instance:metrics')).toBe(false);
  });

  it('fails closed for malformed and future persisted state without rewriting it', () => {
    const key = pluginDockPinsStorageKey('env-123');
    const future = JSON.stringify({
      schemaVersion: 3,
      activityInventoryKeys: ['instance:metrics'],
      workbenchInventoryKeys: ['instance:database'],
    });
    window.localStorage.setItem(key, future);
    expect(loadPluginPlacementPins(key)).toEqual({
      activityInventoryKeys: [],
      workbenchInventoryKeys: [],
    });
    expect(window.localStorage.getItem(key)).toBe(future);

    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      activityInventoryKeys: ['', 7, 'instance:metrics', 'instance:metrics'],
      workbenchInventoryKeys: 'not-an-array',
    }));
    expect(loadPluginPlacementPins(key)).toEqual({
      activityInventoryKeys: ['instance:metrics'],
      workbenchInventoryKeys: [],
    });
  });
});
