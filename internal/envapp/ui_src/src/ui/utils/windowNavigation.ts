export function reloadCurrentPage(win: Window): void {
  try {
    win.location.reload();
    return;
  } catch {
    // Ignore and fall back to assigning the current URL.
  }

  try {
    win.location.assign(win.location.href);
  } catch {
    // Ignore best-effort reload failures.
  }
}
