/* global document */
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureFlowerSurface } from '../../../../scripts/smoke_flower_deepseek.mjs';

// Inspect only public current views and authenticated media endpoints. Never
// read the Floret database or construct model responses to recover a thread.
export async function qualifyComputerRecovery({ page, request, fixtureURL, fixture, ownedThreads, waitForProgress, restart, output, results }) {
  const selected = () => page.locator('.flower-surface').getAttribute('data-flower-selected-thread-id');
  const submit = async (text) => {
    const composer = page.locator('.flower-composer textarea').first();
    await composer.fill(text); await composer.press('Enter');
    await page.locator('[data-flower-primary-action="stop"], .flower-composer-stop-inline').first().waitFor();
    ownedThreads.add(await selected());
    await waitForProgress(async () => await page.locator('.flower-surface').getAttribute('data-flower-selected-thread-status') === 'success', 'recovery fixture turn');
    return selected();
  };
  const media = (threadID, ref) => page.evaluate(async ({ threadID, ref }) => {
    const response = await fetch(`/_redeven_proxy/api/ai/threads/${threadID}/computer-media/${ref.slice('computer://'.length)}`);
    const status = response.status;
    if (!response.ok) return { status };
    const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return { status, sha256: Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join(''), mime: response.headers.get('content-type'), cache: response.headers.get('cache-control') };
  }, { threadID, ref });
  const frame = async () => {
    await page.waitForFunction(() => document.querySelector('.flower-computer-stage-frame')?.naturalWidth >= 640);
    return page.evaluate(async () => {
      const img = document.querySelector('.flower-computer-stage-frame');
      const stage = img.closest('[role="dialog"]');
      const hash = await crypto.subtle.digest('SHA-256', await (await fetch(img.src)).arrayBuffer());
      return { width: img.naturalWidth, height: img.naturalHeight, blob: img.src.startsWith('blob:'), text: stage.innerText.trim(), target: stage.dataset.computerTarget,
        sha256: Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('') };
    });
  };
  const refs = (detail) => (detail.current.items ?? []).flatMap((item) => item.activity?.presentation?.target_refs ?? []).filter((ref) => ref.kind === 'computer_frame').map((ref) => ref.resource_ref);
  const select = async (threadID) => {
    await page.locator(`[data-flower-thread-id="${threadID}"] .flower-thread-card-select-button`).click();
    await page.waitForFunction((id) => document.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-id') === id, threadID);
  };

  await page.locator('.flower-new-chat-button').click();
  const parent = await submit(`Open ${fixtureURL}/recovered?phase=parent in the managed browser, take a screenshot and report the heading. Use only browser and computer tools.`);
  assert(fixture.recovered.has('parent'));
  const parentView = await request('GET', `/_redeven_proxy/api/ai/threads/${parent}`);
  const ref = refs(parentView).at(-1);
  assert(ref?.startsWith('computer://browser-main/'), 'parent has no public keyframe provenance');
  const original = await media(parent, ref);
  assert.deepEqual(original, { status: 200, sha256: ref.split('/').at(-1), mime: 'image/png', cache: 'no-store' });

  await page.locator('.flower-new-chat-button').click();
  const unrelated = await submit('Reply Ready without using any tools.');
  assert.equal(refs(await request('GET', `/_redeven_proxy/api/ai/threads/${unrelated}`)).length, 0);
  assert.equal((await media(unrelated, ref)).status, 404, 'unrelated thread read the parent frame');
  assert.equal(await page.locator('.flower-computer-stage').count(), 0, 'thread switch retained another thread\'s Stage');
  results.push({ scenario: 'cross-thread-media', parent, unrelated, rejected_status: 404, no_stale_stage: true });

  await select(parent);
  const restored = await frame();
  assert.equal(restored.sha256, original.sha256, 'thread switch decoded another frame');
  assert(restored.blob && restored.text === '' && restored.target === 'browser-main');
  await page.locator(`[data-flower-thread-id="${parent}"] .flower-thread-card-menu-button`).click();
  await page.getByRole('menuitem', { name: 'Fork', exact: true }).click();
  await page.waitForFunction((id) => {
    const selected = document.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-id');
    return selected && selected !== id;
  }, parent);
  const fork = await selected(); ownedThreads.add(fork);
  assert(refs(await request('GET', `/_redeven_proxy/api/ai/threads/${fork}`)).includes(ref), 'fork lost canonical keyframe history');
  assert.deepEqual(await media(fork, ref), original, 'fork could not resolve inherited media');
  assert.equal((await frame()).sha256, original.sha256, 'fork did not decode its inherited frame');
  await submit(`Open ${fixtureURL}/recovered?phase=fork in the managed browser, take a screenshot and report the heading. Use only browser and computer tools.`);
  assert(fixture.recovered.has('fork'));
  await page.screenshot({ path: path.join(output, 'recovery-fork.png') });
  results.push({ scenario: 'fork', parent, fork, inherited_ref: ref, decoded_frame: true, follow_up: true });

  await select(parent);
  await restart();
  await page.reload();
  await ensureFlowerSurface(page);
  await page.locator(`[data-flower-thread-id="${parent}"]`).waitFor();
  await select(parent);
  assert.deepEqual(await media(parent, ref), original, 'Runtime restart changed the keyframe');
  assert.equal((await frame()).sha256, original.sha256, 'Runtime restart did not restore decoded Stage pixels');
  assert.equal((await media(unrelated, ref)).status, 404, 'Runtime restart lost media authorization');
  await submit(`Open ${fixtureURL}/recovered?phase=restart in the managed browser, take a screenshot and report the heading. Use only browser and computer tools.`);
  assert(fixture.recovered.has('restart'));
  const pixels = await frame();
  assert(pixels.blob && pixels.text === '' && pixels.target === 'browser-main');
  await page.screenshot({ path: path.join(output, 'recovery-restart.png') });
  results.push({ scenario: 'runtime-restart', thread_id: parent, recovered_ref: ref, decoded_frame: pixels, follow_up: true, cross_thread_rejected: true });
  console.log('Cross-thread media, visible fork, Runtime restart and browser follow-up passed.');
}
