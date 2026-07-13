import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeProcessInventoryNeedsMaintenance,
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
} from './runtimeProcessInventory';

const inventory = {
  schema_version: 1,
  scope: {
    runtime_root: '/root/.redeven',
    state_root: '/root/.redeven',
    desktop_owner_id: 'desktop-owner',
    namespace_id: 'mnt:[1]',
  },
  inventory_digest: 'a'.repeat(64),
  instances: [{
    pid: 123,
    process_started_at_unix_ms: 456,
    state_root: '/root/.redeven',
    executable_path: '/root/.redeven/runtime/managed/bin/redeven',
    classification: 'current_owned',
    stoppable: true,
  }],
  summary: {
    current_owned: 1,
    legacy_owned: 0,
    legacy_ownerless: 0,
    foreign_owner: 0,
    ambiguous: 0,
    stoppable: 1,
    blocking: 0,
  },
};

describe('runtimeProcessInventory', () => {
  it('parses the sanitized versioned inventory', () => {
    expect(parseDesktopRuntimeProcessInventory(JSON.stringify(inventory))).toMatchObject({
      inventory_digest: 'a'.repeat(64),
      instances: [{ pid: 123, classification: 'current_owned' }],
    });
  });

  it('rejects incomplete process identities', () => {
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ pid: 123 }],
    }))).toThrow('incomplete process identity');
  });

  it('parses stop results and detects legacy maintenance', () => {
    const legacy = {
      ...inventory,
      instances: [{
        ...inventory.instances[0],
        classification: 'legacy_ownerless',
        executable_deleted: true,
      }],
      summary: {
        ...inventory.summary,
        current_owned: 0,
        legacy_ownerless: 1,
      },
    };
    expect(desktopRuntimeProcessInventoryNeedsMaintenance(parseDesktopRuntimeProcessInventory(JSON.stringify(legacy)))).toBe(true);
    expect(parseDesktopRuntimeProcessStopResult(JSON.stringify({
      schema_version: 1,
      before: legacy,
      after: { ...inventory, instances: [], summary: { ...inventory.summary, current_owned: 0, stoppable: 0 } },
      stopped: legacy.instances,
    })).stopped).toHaveLength(1);
  });
});
