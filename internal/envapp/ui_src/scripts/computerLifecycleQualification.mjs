/* global document */
import assert from 'node:assert/strict';

// All commands use the visible Flower controls and the same production adapter
// as ordinary turns. The fixture holds navigation only to place Stop inside a
// real outstanding browser action; it never supplies model calls or responses.
export async function qualifyComputerStop({ page, request, fixtureURL, fixture, ownedThreads, waitForProgress, results = [] }) {
  const composer = page.locator('.flower-composer textarea').first();
  const stop = page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline, .flower-input-request-actions .flower-composer-stop').first();
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
    const unknown = phase === 'navigation';
    // Navigation was dispatched to the real browser before Stop. Its external
    // result cannot be confirmed; this must retain the canonical safety warning
    // and must not be treated as an ordinary, silently confirmed cancellation.
    assert.equal(status, unknown ? 'failed' : 'canceled', `Stop during ${phase} returned the wrong outcome`);
    assert.equal(detail.current.run_error_code ?? '', unknown ? 'floret_effect_outcome_unknown' : '');
    assert.equal(await page.locator('.flower-turn-stop-notice, .flower-turn-stopping').count(), 0, 'Stop left a lifecycle notice');
    const warning = page.locator('.flower-error-card');
    if (unknown) {
      await warning.waitFor({ state: 'visible' });
      assert.equal(await warning.locator('button').count(), 0, 'unknown external effect offered automatic replay');
    } else assert.equal(await warning.count(), 0, 'ordinary Stop displayed an error');
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
    if (unknown) assert.equal(fixture.navigationStarted, 1, 'the interrupted navigation was replayed');
    results.push({ phase, thread_id: threadID, outcome: unknown ? 'floret_effect_outcome_unknown' : 'canceled', cancellation_source: 'user_stop', no_stop_notice: true, safety_warning: unknown, no_automatic_replay: true, no_added_message: true, follow_up: true, decoded_frame: true });
    console.log(`Stop during ${phase} and same-thread browser follow-up passed.`);
  }
  return results;
}
