import assert from 'node:assert/strict';
import { englishMessages } from '@floegence/floebrowser/viewer';

// Exercise actual trusted keys and browser chrome while a website's main
// thread is busy. No fabricated carrier messages or transport reconnection.
export async function checkBrowserInputCongestion({ viewer, document, source }) {
  const tabs = await document.getByRole('tab').count();
  const expectedInput = await source.locator('#focus-note').inputValue() + 'x'.repeat(32);
  const started = source.waitForEvent('console', message => message.text() === 'fixture-input-stalled');
  const blocked = source.evaluate(() => {
    console.info('fixture-input-stalled');
    const end = performance.now() + 4000;
    while (performance.now() < end) { /* Controlled, bounded source workload. */ }
  });
  await started;
  try {
    // 32 key pairs fill the 64-command input budget. A new-tab intent is a
    // separate chrome command; rejecting it must leave this view usable.
    await viewer.keyboard.type('x'.repeat(32));
    await document.getByRole('button', { name: 'New tab', exact: true }).click();
    await document.getByText(englishMessages['action.busy'], { exact: true }).waitFor({ timeout: 2000 });
    assert.equal(await document.getByRole('tab').count(), tabs, 'A rejected new-tab intent has no effect');
  } finally { await blocked; }
  await source.waitForFunction(expected => document.querySelector('#focus-note').value === expected, expectedInput);
  await document.locator('[data-floe-ui=status].live').waitFor();
  assert.equal(await document.getByRole('tab').count(), tabs, 'Rejected input is never replayed after the queue drains');
  // The same view accepts a new explicit user action without a Retry click.
  await document.getByRole('button', { name: 'New tab', exact: true }).click();
  await document.getByRole('tab', { name: 'about:blank', exact: true, selected: true }).waitFor();
  assert.equal(await document.getByRole('tab').count(), tabs + 1);
  await document.getByRole('button', { name: 'Close about:blank', exact: true }).click();
  await document.frameLocator('.floe-projection:not([aria-hidden]) iframe').locator('#counter').waitFor();
}
