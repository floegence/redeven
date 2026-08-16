import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeProcessInventoryHasSingleCurrent,
  desktopRuntimeProcessInventoryNeedsMaintenance,
  desktopRuntimeProcessStopTargetCount,
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
  requireDesktopRuntimeProcessIdentity,
  RuntimeProcessIdentityBlockedError,
} from './runtimeProcessInventory';

const inventory = {
  schema_version: 3,
  scope: {
    runtime_root: '/root/.redeven',
    state_root: '/root/.redeven',
    user_identity: 'root',
    namespace_id: 'mnt:[1]',
  },
  inventory_digest: 'a'.repeat(64),
  instances: [{
    pid: 123,
    process_started_at_unix_ms: 456,
    instance_id: 'runtime-instance',
    state_root: '/root/.redeven',
    executable_path: '/root/.redeven/runtime/managed/bin/redeven',
    executable_device: 1,
    executable_inode: 2,
    namespace_id: 'mnt:[1]',
    runtime_version: 'v1.0.0',
    identity_status: 'verified',
    layout_status: 'current',
    stop_authority: 'automatic',
  }],
  summary: {
    automatic: 1,
    blocked: 0,
  },
};

describe('runtimeProcessInventory', () => {
  it('parses the strict schema 3 process inventory', () => {
    expect(parseDesktopRuntimeProcessInventory(JSON.stringify(inventory))).toMatchObject({
      schema_version: 3,
      inventory_digest: 'a'.repeat(64),
      scope: { user_identity: 'root', namespace_id: 'mnt:[1]' },
      instances: [{ pid: 123, layout_status: 'current', stop_authority: 'automatic' }],
      summary: { automatic: 1, blocked: 0 },
    });
  });

  it('rejects schema 2 and removed ownership or takeover fields', () => {
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({ ...inventory, schema_version: 2 })))
      .toThrow('schema is unsupported');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      scope: { ...inventory.scope, desktop_owner_id: 'desktop-owner' },
    }))).toThrow('unexpected scope field');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ ...inventory.instances[0], owner_status: 'current' }],
    }))).toThrow('unexpected process field');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      summary: { ...inventory.summary, confirmed_takeover: 0 },
    }))).toThrow('unexpected summary field');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ ...inventory.instances[0], stop_authority: 'confirmed_takeover' }],
      summary: { automatic: 0, blocked: 0 },
    }))).toThrow('invalid stop authority');
  });

  it('rejects inconsistent authority and summary projections', () => {
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      summary: { automatic: 0, blocked: 0 },
    }))).toThrow('summary does not match');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ ...inventory.instances[0], stop_authority: 'blocked' }],
      summary: { automatic: 0, blocked: 1 },
    }))).toThrow('inconsistent process authority');
  });

  it('accepts a verified alternate executable as an automatic stop target', () => {
    const alternate = parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{
        ...inventory.instances[0],
        executable_path: '/Applications/Redeven Preview.app/Contents/Resources/redeven',
        layout_status: 'verified_alternate',
      }],
    }));

    expect(alternate.instances[0]).toMatchObject({
      layout_status: 'verified_alternate',
      stop_authority: 'automatic',
    });
    expect(desktopRuntimeProcessStopTargetCount(alternate)).toBe(1);
    expect(desktopRuntimeProcessInventoryHasSingleCurrent(alternate)).toBe(false);
    expect(desktopRuntimeProcessInventoryNeedsMaintenance(alternate)).toBe(true);
  });

  it('fails closed when core process identity is incomplete', () => {
    const blocked = parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{
        ...inventory.instances[0],
        executable_device: undefined,
        executable_inode: undefined,
        reason_code: 'runtime_process_identity_incomplete',
        identity_status: 'incomplete',
        layout_status: 'unknown',
        stop_authority: 'blocked',
      }],
      summary: { automatic: 0, blocked: 1 },
    }));

    expect(() => requireDesktopRuntimeProcessIdentity(blocked)).toThrow(RuntimeProcessIdentityBlockedError);
    expect(desktopRuntimeProcessStopTargetCount(blocked)).toBe(0);
  });

  it('rejects incomplete process envelopes', () => {
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ pid: 123 }],
    }))).toThrow('incomplete process identity');
  });

  it('parses strict schema 3 stop results', () => {
    const after = {
      ...inventory,
      inventory_digest: 'b'.repeat(64),
      instances: [],
      summary: { automatic: 0, blocked: 0 },
    };
    expect(parseDesktopRuntimeProcessStopResult(JSON.stringify({
      schema_version: 3,
      before: inventory,
      after,
      stopped: inventory.instances,
    }))).toMatchObject({
      schema_version: 3,
      before: { inventory_digest: 'a'.repeat(64) },
      after: { inventory_digest: 'b'.repeat(64), instances: [] },
      stopped: [{ pid: 123 }],
    });
  });
});
