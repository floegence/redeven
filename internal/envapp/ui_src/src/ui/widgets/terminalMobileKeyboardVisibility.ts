export interface TerminalMobileKeyboardVisibilityOptions {
  eligible: boolean;
  requested: boolean;
  sessionDrawerOpen: boolean;
}

/**
 * The session drawer owns the mobile bottom area while it is open. Keep the
 * requested keyboard state intact so closing the drawer restores it without
 * remounting the terminal or changing focus.
 */
export function resolveTerminalMobileKeyboardVisibility(
  options: TerminalMobileKeyboardVisibilityOptions,
): boolean {
  return options.eligible && options.requested && !options.sessionDrawerOpen;
}
