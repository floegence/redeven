// Restore only the explicitly selected discarded tab. A debugger attachment can
// turn discarded=false without loading its document, so capture the native fact
// before attachment and wait for the new top-level document's own lifecycle.
export async function restoreDiscardedTab(browser, tab, signal) {
  if (!tab.discarded) return;
  signal.throwIfAborted();
  const prior = await browser.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  let finish;
  const loaded = new Promise((resolve, reject) => {
    const cleanup = () => {
      browser.webNavigation.onDOMContentLoaded.removeListener(ready);
      browser.webNavigation.onErrorOccurred.removeListener(failed);
      browser.tabs.onRemoved.removeListener(removed);
      lifetime.removeEventListener('abort', cancelled);
    };
    finish = error => { cleanup(); if (error) reject(error); else resolve(); };
    const ready = event => {
      if (event.tabId !== tab.id || event.frameId !== 0 || !event.documentId || event.documentId === prior?.documentId) return;
      void browser.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).then(frame => {
        if (frame?.documentId === event.documentId && frame.documentLifecycle === 'active' && !frame.errorOccurred) finish();
        else finish(new Error('restored_document_changed'));
      }, () => finish(new Error('restored_document_unavailable')));
    };
    const failed = event => { if (event.tabId === tab.id && event.frameId === 0) finish(new Error('restored_document_failed')); };
    const removed = id => { if (id === tab.id) finish(new Error('restored_tab_closed')); };
    const cancelled = () => finish(new Error('restoration_cancelled'));
    browser.webNavigation.onDOMContentLoaded.addListener(ready);
    browser.webNavigation.onErrorOccurred.addListener(failed);
    browser.tabs.onRemoved.addListener(removed);
    lifetime.addEventListener('abort', cancelled, { once: true });
    if (lifetime.aborted) cancelled();
  });
  // Observe rejection before issuing the one native side effect. A canceled or
  // unknown reload is never repeated, and never activates the physical tab.
  void loaded.catch(() => {});
  try {
    lifetime.throwIfAborted();
    await Promise.all([browser.tabs.reload(tab.id), loaded]);
  } catch (error) {
    finish(error);
    throw error;
  }
}
