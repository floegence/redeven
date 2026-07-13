import { describe, expect, it } from 'vitest';

import { canLaunchProcess } from './permission';

describe('canLaunchProcess', () => {
  it('requires write and execute together', () => {
    expect(canLaunchProcess(undefined)).toBe(false);
    expect(canLaunchProcess({ can_write: false, can_execute: true })).toBe(false);
    expect(canLaunchProcess({ can_write: true, can_execute: false })).toBe(false);
    expect(canLaunchProcess({ can_write: true, can_execute: true })).toBe(true);
  });
});
