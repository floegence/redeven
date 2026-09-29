import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreDiscardedTab } from '../../../../browser-extension/tabLifecycle.mjs';

const event = () => {
  const listeners = new Set();
  return { listeners, addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: value => { for (const fn of listeners) fn(value); } };
};
function fixture() {
  let reloads = 0, frame = null;
  const browser = { webNavigation: { getFrame: async () => frame, onDOMContentLoaded: event(), onErrorOccurred: event() }, tabs: {
    onRemoved: event(), reload: async id => { assert.equal(id, 7); reloads++; },
    update: () => assert.fail('Restoration must not activate a tab'),
  } };
  return { browser, reloads: () => reloads, ready(documentId = 'restored') { frame = { documentId, documentLifecycle: 'active' }; browser.webNavigation.onDOMContentLoaded.emit({ tabId: 7, frameId: 0, documentId }); } };
}
test('normal pages are never reloaded; discarded pages await their own new document', async () => {
  const f = fixture(), abort = new AbortController();
  await restoreDiscardedTab(f.browser, { id: 7, discarded: false }, abort.signal);
  assert.equal(f.reloads(), 0);
  let complete = false;
  const restored = restoreDiscardedTab(f.browser, { id: 7, discarded: true }, abort.signal).then(() => { complete = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reloads(), 1);
  f.browser.webNavigation.onDOMContentLoaded.emit({ tabId: 8, frameId: 0, documentId: 'other' });
  f.browser.webNavigation.onDOMContentLoaded.emit({ tabId: 7, frameId: 1, documentId: 'iframe' });
  await Promise.resolve();
  assert.equal(complete, false, 'Other tabs and subframes cannot establish content readiness');
  f.ready(); await restored;
  assert.equal(f.reloads(), 1);
  assert.equal(f.browser.webNavigation.onDOMContentLoaded.listeners.size, 0);
});
test('canceled restoration releases listeners and never repeats the reload', async () => {
  const f = fixture(), abort = new AbortController();
  const restored = restoreDiscardedTab(f.browser, { id: 7, discarded: true }, abort.signal);
  await new Promise(resolve => setImmediate(resolve));
  abort.abort(); await assert.rejects(restored, /restoration_cancelled/);
  f.ready();
  assert.equal(f.reloads(), 1);
  assert.equal(f.browser.webNavigation.onDOMContentLoaded.listeners.size, 0);
  assert.equal(f.browser.webNavigation.onErrorOccurred.listeners.size, 0);
  assert.equal(f.browser.tabs.onRemoved.listeners.size, 0);
});

test('cancellation settles even while the native reload reply is pending', async () => {
  const f = fixture(), abort = new AbortController();
  let finishReload;
  f.browser.tabs.reload = () => new Promise(resolve => { finishReload = resolve; });
  const restored = restoreDiscardedTab(f.browser, { id: 7, discarded: true }, abort.signal);
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(restored, /restoration_cancelled/);
  assert.equal(f.browser.webNavigation.onDOMContentLoaded.listeners.size, 0);
  finishReload();
});

test('failed and removed restored documents fail without replay or activation', async () => {
  for (const failure of ['navigation', 'removed']) {
    const f = fixture();
    const restored = restoreDiscardedTab(f.browser, { id: 7, discarded: true }, new AbortController().signal);
    await new Promise(resolve => setImmediate(resolve));
    if (failure === 'navigation') f.browser.webNavigation.onErrorOccurred.emit({ tabId: 7, frameId: 0 });
    else f.browser.tabs.onRemoved.emit(7);
    await assert.rejects(restored, failure === 'navigation' ? /restored_document_failed/ : /restored_tab_closed/);
    assert.equal(f.reloads(), 1);
    assert.equal(f.browser.webNavigation.onDOMContentLoaded.listeners.size, 0);
  }
});
