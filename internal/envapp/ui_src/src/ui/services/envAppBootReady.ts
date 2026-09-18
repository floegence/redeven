export function notifyEnvAppBootReady(win: Window): void {
  // The Cloud bootstrap keeps its loading surface until the app has painted
  // an interactive workspace or access gate. This grants no proxy authority.
  try {
    const parent = win.parent;
    if (parent === win || parent.location.origin !== win.location.origin
      || parent.location.pathname !== '/_redeven_boot/') return;
    parent.postMessage({ v: 1, type: 'redeven:env_app_ready' }, win.location.origin);
  } catch {
    // Standalone and unrelated embeddings do not own the Cloud loading surface.
  }
}
