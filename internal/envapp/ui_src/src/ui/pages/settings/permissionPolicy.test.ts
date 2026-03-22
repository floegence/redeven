import { describe, expect, it } from 'vitest';

import { buildPermissionPolicyValue } from './permissionPolicy';

describe('buildPermissionPolicyValue', () => {
  it('throws when a user rule key is still empty', () => {
    expect(() =>
      buildPermissionPolicyValue(
        { read: true, write: true, execute: true },
        [{ key: '', read: true, write: false, execute: false }],
        [],
      ),
    ).toThrow('User rule 1 is incomplete.');
  });

  it('throws when an app rule key is still empty', () => {
    expect(() =>
      buildPermissionPolicyValue(
        { read: true, write: true, execute: true },
        [],
        [{ key: '   ', read: true, write: false, execute: false }],
      ),
    ).toThrow('App rule 1 is incomplete.');
  });

  it('clamps row permissions to local_max while preserving valid keys', () => {
    expect(
      buildPermissionPolicyValue(
        { read: true, write: false, execute: true },
        [{ key: 'user_123', read: true, write: true, execute: true }],
        [{ key: 'app.demo', read: false, write: true, execute: true }],
      ),
    ).toEqual({
      schema_version: 1,
      local_max: { read: true, write: false, execute: true },
      by_user: {
        user_123: { read: true, write: false, execute: true },
      },
      by_app: {
        'app.demo': { read: false, write: false, execute: true },
      },
    });
  });
});
