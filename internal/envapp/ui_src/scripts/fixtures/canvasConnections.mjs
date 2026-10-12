/* global document, innerHeight, getComputedStyle */
import assert from 'node:assert/strict';
import path from 'node:path';

/** Qualify the real Env App and its owned standalone Electron surface. */
export default async function qualifyConnections(page, { report, output, setTheme, setSize }) {
  const overview = ['@overview/a/b', '@overview/b/a', '@overview/b/store', '@overview/outside/a'];
  const focused = ['@detail/a1/a2', '@detail/a1/b1', '@detail/b1/a1', '@detail/outside/a1'];
  const ids = () => page.locator('.floe-graph__edge').evaluateAll(edges => edges
    .map(edge => edge.parentElement.getAttribute('data-graph-object')).sort());
  const wait = expected => page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.floe-graph__edge')]
    .map(edge => edge.parentElement.getAttribute('data-graph-object')).sort()) === JSON.stringify(expected), expected);
  const geometry = () => page.evaluate(() => ({
    nodes: [...document.querySelectorAll('.floe-graph__node,.floe-graph__group')].map(node => [node.dataset.graphObject, node.style.cssText]),
    viewport: getComputedStyle(document.querySelector('.floe-infinite-canvas__viewport')).transform,
    minimap: document.querySelector('.floe-graph__minimap').outerHTML,
  }));
  await wait(overview);
  const hide = page.getByRole('button', { name: 'Hide replies', exact: true });
  await hide.waitFor(); await hide.click();
  assert.equal(await page.locator('[data-floe-shell-slot], [data-workbench-dock-action]').count(), 0);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover();
  const before = await geometry();
  await page.getByRole('group', { name: 'Application', exact: true }).hover({ position: { x: 20, y: 20 } });
  await wait(['@overview/a/b', '@overview/b/a', '@overview/outside/a']);
  const start = Date.now();
  await page.getByRole('group', { name: 'a1', exact: true }).hover({ position: { x: 80, y: 20 } });
  await wait(focused);
  report.performance.push({ gesture: 'cold-hover', elapsedMs: Date.now() - start });
  assert.deepEqual(await geometry(), before, 'Hover preserves nodes, viewport and minimap');
  // Move to a real painted path, then click: never use a synthetic click for
  // the node -> edge -> popup continuity contract.
  const point = await page.locator('[data-graph-object="@detail/a1/b1"] .floe-graph__edge-target').evaluate(path => {
    const matrix = path.getScreenCTM(), length = path.getTotalLength();
    for (let ratio = .15; ratio < .9; ratio += .05) {
      const local = path.getPointAtLength(length * ratio), screen = local.matrixTransform(matrix);
      if (document.elementFromPoint(screen.x, screen.y)?.closest('[data-graph-object="@detail/a1/b1"]')) return { x: screen.x, y: screen.y };
    }
    throw Error('No interactive focused connection segment');
  });
  await page.mouse.move(point.x, point.y); await page.mouse.click(point.x, point.y);
  await page.locator('.tessiven-popup').waitFor();
  assert.deepEqual(await ids(), focused, 'Entering connection and popup retains focus');
  assert((await page.locator('.tessiven-popup').innerText()).includes('instance-a1'));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover(); await wait(overview);
  report.scenarios.push('overview-group-node-and-continuous-path-details');
  await page.locator('[data-graph-object="@overview/a/b"] .floe-graph__edge-target').dispatchEvent('click');
  await page.locator('[data-summary-key]').waitFor();
  await page.locator('[data-summary-key]').click();
  await page.locator('[data-exact-relation-id="a2-b2"]').waitFor();
  assert.equal(await page.locator('[data-exact-relation-id]').count(), 2);
  await page.locator('[data-exact-relation-id="a2-b2"]').click();
  assert((await page.locator('.tessiven-relation-exact').innerText()).includes('instance-a2'));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  report.scenarios.push('overview-classification-and-original-details');
  for (let i = 0; i < 3; i++) {
    for (const name of ['Collapse all', 'Expand all']) {
      await page.getByRole('button', { name: 'View', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await page.waitForFunction(expanded => document.querySelectorAll('.tessiven-node').length === (expanded ? 5 : 1)
        && !document.querySelector('[aria-label="Arranging canvas"]'), name === 'Expand all');
      await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover(); await wait(overview);
    }
  }
  report.scenarios.push('three-compact-expansion-cycles');
  for (const [mode, preset, forced] of [['light','porcelain-light',false], ['dark','porcelain-dark',false], ['light','hc-light',false], ['dark','porcelain-dark',true]]) {
    await page.emulateMedia({ forcedColors: forced ? 'active' : 'none', colorScheme: mode });
    await setTheme(mode, preset);
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await page.getByRole('group', { name: 'a1', exact: true }).hover({ position: { x: 80, y: 20 } });
    await wait(focused);
    await page.screenshot({ path: path.join(output, `connections-${forced ? 'forced-dark' : preset}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ forcedColors: 'none' });
  await setSize(800, 420);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).hover(); await wait(overview);
  await page.locator('[data-graph-object="@overview/a/b"] .floe-graph__edge-target').dispatchEvent('click');
  await page.waitForFunction(() => {
    const box = document.querySelector('.tessiven-popup')?.getBoundingClientRect();
    return box && box.top >= 0 && box.bottom <= innerHeight;
  });
  await page.screenshot({ path: path.join(output, 'connections-short-window.png'), animations: 'disabled' });
  await page.reload(); await wait(overview);
  assert.equal(await page.locator('.tessiven-error').count(), 0);
  report.scenarios.push('themes-short-window-and-reload');
}
