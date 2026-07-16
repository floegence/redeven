import { describe, expect, it } from 'vitest';

import {
  buildDesktopRuntimeProcessTakeoverProposal,
  desktopRuntimeProcessInventoryNeedsMaintenance,
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
  requireDesktopRuntimeProcessReconciliation,
  RuntimeProcessCommandError,
  RuntimeProcessIdentityBlockedError,
  RuntimeProcessTakeoverRequiredError,
} from './runtimeProcessInventory';

const inventory = {
  schema_version: 2,
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
    desktop_owner_id: 'desktop-owner',
    state_root: '/root/.redeven',
    executable_path: '/root/.redeven/runtime/managed/bin/redeven',
    executable_device: 1,
    executable_inode: 2,
    identity_status: 'verified',
    owner_status: 'current',
    layout_status: 'current',
    owner_evidence: 'process_environment',
    stop_authority: 'automatic',
  }],
  summary: {
    automatic: 1,
    confirmed_takeover: 0,
    blocked: 0,
  },
};

describe('runtimeProcessInventory', () => {
  it('parses the strict orthogonal process inventory', () => {
    expect(parseDesktopRuntimeProcessInventory(JSON.stringify(inventory))).toMatchObject({
      schema_version: 2,
      inventory_digest: 'a'.repeat(64),
      instances: [{ pid: 123, owner_status: 'current', stop_authority: 'automatic' }],
    });
  });

  it('rejects obsolete schemas and fields outside the exact contract', () => {
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({ ...inventory, schema_version: 1 })))
      .toThrow('schema is unsupported');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ ...inventory.instances[0], classification: 'current_owned', stoppable: true }],
    }))).toThrow('unexpected process field');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      summary: { ...inventory.summary, blocking: 0 },
    }))).toThrow('unexpected summary field');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      summary: { automatic: 0, confirmed_takeover: 0, blocked: 0 },
    }))).toThrow('summary does not match');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ ...inventory.instances[0], stop_authority: 'confirmed_takeover' }],
      summary: { automatic: 0, confirmed_takeover: 1, blocked: 0 },
    }))).toThrow('inconsistent process authority');
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ ...inventory.instances[0], stop_authority: 'blocked' }],
      summary: { automatic: 0, confirmed_takeover: 0, blocked: 1 },
    }))).toThrow('inconsistent process authority');
  });

  it('requires an exact digest-bound confirmation for verified foreign owners', () => {
    const takeoverInventory = parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{
        ...inventory.instances[0],
        desktop_owner_id: 'another-owner',
        owner_status: 'foreign',
        stop_authority: 'confirmed_takeover',
        reason_code: 'runtime_owned_by_another_desktop',
      }],
      summary: { automatic: 0, confirmed_takeover: 1, blocked: 0 },
    }));

    expect(() => requireDesktopRuntimeProcessReconciliation(takeoverInventory)).toThrow(RuntimeProcessTakeoverRequiredError);
    expect(() => requireDesktopRuntimeProcessReconciliation(takeoverInventory, {
      mode: 'confirmed_takeover',
      expected_inventory_digest: 'b'.repeat(64),
    })).toThrow(RuntimeProcessTakeoverRequiredError);
    expect(() => requireDesktopRuntimeProcessReconciliation(takeoverInventory, {
      mode: 'confirmed_takeover',
      expected_inventory_digest: takeoverInventory.inventory_digest,
    })).not.toThrow();

    const proposal = buildDesktopRuntimeProcessTakeoverProposal(takeoverInventory, {
      operation: 'restart',
      location: 'ssh_host',
      environment_id: 'env-1',
      target_id: 'ssh:target',
      target_label: 'Build host',
    });
    expect(proposal).toMatchObject({
      operation: 'restart',
      process_count: 1,
      instances: [{ pid: 123, owner_status: 'foreign' }],
    });
    expect(JSON.stringify(proposal)).not.toContain('another-owner');
    expect(JSON.stringify(proposal)).not.toContain('executable_path');

    const mixedProposal = buildDesktopRuntimeProcessTakeoverProposal(parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...takeoverInventory,
      instances: [inventory.instances[0], {
        ...takeoverInventory.instances[0],
        pid: 124,
        process_started_at_unix_ms: 457,
        executable_inode: 3,
      }],
      summary: { automatic: 1, confirmed_takeover: 1, blocked: 0 },
    })), {
      operation: 'restart',
      location: 'ssh_host',
      environment_id: 'env-1',
      target_id: 'ssh:target',
      target_label: 'Build host',
    });
    expect(mixedProposal).toMatchObject({
      process_count: 2,
      instances: [
        { pid: 123, owner_status: 'current' },
        { pid: 124, owner_status: 'foreign' },
      ],
    });
  });

  it('never reuses a confirmed takeover after the inventory becomes automatic', () => {
    const automaticInventory = parseDesktopRuntimeProcessInventory(JSON.stringify(inventory));
    let error: unknown;
    try {
      requireDesktopRuntimeProcessReconciliation(automaticInventory, {
        mode: 'confirmed_takeover',
        expected_inventory_digest: 'b'.repeat(64),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RuntimeProcessCommandError);
    expect(error).toMatchObject({ code: 'runtime_inventory_changed' });
  });

  it('never permits confirmation to override incomplete core identity', () => {
    const blockedInventory = parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{
        ...inventory.instances[0],
        executable_inode: undefined,
        identity_status: 'incomplete',
        owner_status: 'missing',
        layout_status: 'unknown',
        owner_evidence: 'missing',
        stop_authority: 'blocked',
      }],
      summary: { automatic: 0, confirmed_takeover: 0, blocked: 1 },
    }));
    expect(() => requireDesktopRuntimeProcessReconciliation(blockedInventory, {
      mode: 'confirmed_takeover',
      expected_inventory_digest: blockedInventory.inventory_digest,
    })).toThrow(RuntimeProcessIdentityBlockedError);
  });

  it('rejects incomplete process envelopes', () => {
    expect(() => parseDesktopRuntimeProcessInventory(JSON.stringify({
      ...inventory,
      instances: [{ pid: 123 }],
    }))).toThrow('incomplete process identity');
  });

  it('parses stop results and identifies non-current ownership as maintenance', () => {
    const takeover = {
      ...inventory,
      instances: [{
        ...inventory.instances[0],
        desktop_owner_id: undefined,
        owner_status: 'missing',
        owner_evidence: 'missing',
        stop_authority: 'confirmed_takeover',
      }],
      summary: { automatic: 0, confirmed_takeover: 1, blocked: 0 },
    };
    expect(desktopRuntimeProcessInventoryNeedsMaintenance(parseDesktopRuntimeProcessInventory(JSON.stringify(takeover)))).toBe(true);
    expect(parseDesktopRuntimeProcessStopResult(JSON.stringify({
      schema_version: 2,
      before: takeover,
      after: { ...inventory, instances: [], summary: { automatic: 0, confirmed_takeover: 0, blocked: 0 } },
      stopped: takeover.instances,
    })).stopped).toHaveLength(1);
  });
});
