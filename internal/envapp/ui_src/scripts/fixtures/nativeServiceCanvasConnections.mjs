/* global document, window, getComputedStyle, KeyboardEvent, MouseEvent */
// Run in actual WKWebView, preserving the native exact-selection bridge.
export default async function qualifyConnections() {
  const ids = () => [...document.querySelectorAll('.floe-graph__edge')]
    .map(edge => edge.parentElement.getAttribute('data-graph-object')).sort();
  const overview = ['@overview/a/b', '@overview/b/a', '@overview/b/store', '@overview/outside/a'];
  const detailed = ['@detail/a1/a2', '@detail/a1/b1', '@detail/b1/a1', '@detail/outside/a1'];
  const until = async read => {
    for (let i = 0; i < 600; i++) {
      if (read()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`Native connection state timed out: ${read.toString()} ${JSON.stringify(ids())}`);
  };
  const equal = expected => JSON.stringify(ids()) === JSON.stringify(expected);
  const geometry = () => JSON.stringify({
    nodes: [...document.querySelectorAll('.floe-graph__node,.floe-graph__group')].map(node => [node.dataset.graphObject, node.style.cssText]),
    viewport: getComputedStyle(document.querySelector('.floe-infinite-canvas__viewport')).transform,
    minimap: document.querySelector('.floe-graph__minimap').outerHTML,
  });
  await until(() => equal(overview));
  const before = geometry();
  const node = document.querySelector('[data-graph-object="a1"]');
  node.focus(); await until(() => equal(detailed));
  if (geometry() !== before) throw Error('Native hover changed geometry');
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => equal(overview));
  document.querySelector('[data-graph-object="@overview/a/b"] .floe-graph__edge-target')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await until(() => document.querySelectorAll('[data-summary-key]').length === 1);
  document.querySelector('[data-summary-key]').click();
  await until(() => document.querySelectorAll('[data-exact-relation-id]').length === 2);
  document.querySelector('[data-exact-relation-id="a2-b2"]').click();
  await until(() => !document.querySelector('.tessiven-popup'));
  for (let i = 0; i < 3; i++) {
    window.serviceCanvas.command({ canvas_id: 'qualification', version_id: 1, action: 'collapse' });
    await until(() => document.querySelectorAll('.tessiven-node').length === 1 && equal(overview));
    window.serviceCanvas.command({ canvas_id: 'qualification', version_id: 1, action: 'expand' });
    await until(() => document.querySelectorAll('.tessiven-node').length === 5 && equal(overview));
  }
  window.serviceCanvas.command({ canvas_id: 'qualification', version_id: 1, action: 'fit' });
  document.querySelector('[data-graph-object="@overview/a/b"] .floe-graph__edge-target')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await until(() => document.querySelector('[data-summary-key]'));
  if (document.querySelector('[role="alert"]')) throw Error('Native canvas alert');
  return { overview: overview.length, focused: detailed.length, compactCycles: 3, stableGeometry: true, exactSelection: 'a2-b2' };
}
