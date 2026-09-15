/* global document */
import assert from 'node:assert/strict';

// All commands use the visible Flower controls and the same production adapter
// as ordinary turns. The fixture holds navigation only to place Stop inside a
// real outstanding browser action; it never supplies model calls or responses.
export async function qualifyComputerStop({ page, request, fixtureURL, fixture, ownedThreads, waitForProgress }) {
  const results = [];
  const composer = page.locator('.flower-composer textarea').first();
  const stop = page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').first();
  const submit = async (text) => {
    await composer.fill(text);
    await composer.press('Enter');
    await stop.waitFor({ state: 'visible' });
  };
  const messages = () => page.locator('[data-flower-message-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-flower-message-id')));
  for (const phase of ['takeover', 'navigation']) {
    await page.locator('.flower-new-chat-button').click();
    const endpoint = phase === 'takeover' ? '/signin' : '/slow-navigation';
    await submit(`Open ${fixtureURL}${endpoint} in the managed browser so I can view the page. Use browser and computer tools only.`);
    const threadID = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id');
    ownedThreads.add(threadID);
    if (phase === 'takeover') await page.locator('[data-computer-control-action="take"]').waitFor({ timeout: 180000 });
    else await waitForProgress(() => fixture.navigationStarted, 'outstanding browser navigation');
    const before = await messages();
    await stop.click();
    await page.waitForFunction(() => ['canceled', 'failed'].includes(document.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-status')), null, { timeout: 30000 });
    const status = await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status');
    const detail = await request('GET', `/_redeven_proxy/api/ai/threads/${threadID}`);
    assert.equal(status, 'canceled', `Stop during ${phase} did not confirm cancellation`);
    assert.equal(await page.locator('.flower-turn-stop-notice, .flower-error-card, .flower-turn-stopping').count(), 0, 'ordinary Stop left a notice or error card');
    assert(await composer.isEditable(), 'Stop did not restore the composer');
    const after = await messages();
    assert(after.every((id) => before.includes(id)), 'Stop appended a conversation message');
    const facts = [];
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (value.source === 'user_stop') facts.push(value);
      for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
    };
    visit(detail);
    assert(facts.length > 0, 'Stop lost its canonical cancellation fact');
    fixture.releaseNavigation();
    await submit(`Open ${fixtureURL}/recovered?phase=${phase} in the managed browser. Take a screenshot and tell me the heading. Do not use terminal or HTTP fetch.`);
    await waitForProgress(async () => await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status') === 'success', 'same-thread browser follow-up');
    assert(fixture.recovered.has(phase), 'follow-up never reached the browser fixture');
    await page.waitForFunction(() => {
      const img = document.querySelector('.flower-computer-stage-frame');
      return img?.naturalWidth >= 640 && img.complete;
    });
    assert.equal(await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id'), threadID);
    results.push({ phase, thread_id: threadID, canceled: true, cancellation_source: 'user_stop', no_stop_notice: true, no_added_message: true, follow_up: true, decoded_frame: true });
    console.log(`Stop during ${phase} and same-thread browser follow-up passed.`);
  }
  return results;
}
