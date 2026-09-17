/* global document */
import assert from 'node:assert/strict';

// Create only the empty canonical conversation through the public API. Target
// selection, access, model work and private handoff use the real product UI.
export async function createComputerTask({ page, request, ownedThreads, origin, targetID = 'browser-main' }) {
  const view = await request('POST', '/_redeven_proxy/api/ai/threads', {
    client_request_id: crypto.randomUUID(), title: 'Computer qualification', permission_type: 'full_access',
  });
  const id = view.thread.thread_id;
  assert(id, 'canonical thread identity is missing');
  ownedThreads?.add(id);
  await page.locator('.flower-thread-refresh-button').click();
  await page.locator(`[data-flower-thread-id="${id}"] .flower-thread-card-select-button`).click();
  await page.waitForFunction(id => document.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-id') === id, id);
  await configureComputerTask({ page, request, threadID: id, origin, targetID });
  return id;
}

export async function configureComputerTask({ page, request, threadID, origin, targetID, app, foreground = false }) {
  const targets = await request('GET', '/_redeven_proxy/api/ai/computer/targets');
  const target = targets.find(item => item.id === targetID);
  assert(target, 'explicit qualification target is unavailable');
  await page.getByRole('button', { name: 'Browser and desktop', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Browser and desktop', exact: true });
  // Target IDs remain unambiguous when multiple tabs share the same title.
  await dialog.locator(`input[name="flower-computer-target"][value=${JSON.stringify(targetID)}]`).check();
  if (origin) {
    const current = await request('GET', `/_redeven_proxy/api/ai/computer/access?thread_id=${threadID}`);
    if (!(current.origins ?? []).includes(origin)) {
      await dialog.getByRole('textbox', { name: 'Allowed sites', exact: true }).fill(origin);
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    }
  }
  if (app) await dialog.getByRole('checkbox', { name: app, exact: true }).check();
  if (foreground) await dialog.getByRole('checkbox', { name: /^Allow temporary desktop use/ }).check();
  await dialog.getByRole('button', { name: 'Save access', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'Access saved' }).waitFor();
  const selected = await request('GET', `/_redeven_proxy/api/ai/computer/target?thread_id=${threadID}`);
  assert.equal(selected.target_id, targetID);
  await dialog.getByLabel('Close', { exact: true }).click();
}

export async function openComputerStage(page) {
  if (!await page.locator('.flower-computer-stage').count()) await page.locator('.flower-computer-entry').click();
  await page.locator('.flower-computer-stage').waitFor();
}
