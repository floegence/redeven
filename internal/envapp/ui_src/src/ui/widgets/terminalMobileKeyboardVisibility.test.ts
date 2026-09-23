import { describe, expect, it } from 'vitest';
import { resolveTerminalMobileKeyboardVisibility } from './terminalMobileKeyboardVisibility';

describe('resolveTerminalMobileKeyboardVisibility', () => {
  it('hides the optional keyboard while the mobile session drawer owns the bottom area', () => {
    expect(resolveTerminalMobileKeyboardVisibility({ eligible: true, requested: true, sessionDrawerOpen: true })).toBe(false);
  });

  it('restores the requested keyboard state after the drawer closes', () => {
    expect(resolveTerminalMobileKeyboardVisibility({ eligible: true, requested: true, sessionDrawerOpen: false })).toBe(true);
    expect(resolveTerminalMobileKeyboardVisibility({ eligible: true, requested: false, sessionDrawerOpen: false })).toBe(false);
  });
});
