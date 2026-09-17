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

export function reopenEnvironmentPage(win: Window): void {
  // Cloud's bootstrap owns the proxy connection. Reloading only its child
  // would request the app through the same expired connection again.
  try {
    const parent = win.parent;
    if (parent !== win && parent.location.origin === win.location.origin
      && parent.location.pathname === '/_redeven_boot/') {
      reloadCurrentPage(parent);
      return;
    }
  } catch {
    // An unrelated or cross-origin embedding page is not ours to navigate.
  }
  reloadCurrentPage(win);
}
