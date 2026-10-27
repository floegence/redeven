/* global document */
import assert from 'node:assert/strict';

export function collectComputerActivities(detail) {
  return (detail.current?.items ?? []).filter(item => /^(computer|browser)\./u.test(item.activity?.tool_name ?? '')).map(item => ({
    tool: item.activity.tool_name, toolID: item.activity.tool_id, status: item.activity.status,
    targetRefs: item.activity_summary?.values?.['/target_refs'] ?? [],
  }));
}

// Create only the empty canonical conversation through the public API. Target
// selection, access, model work and private handoff use the real product UI.
// New browser tasks exercise autonomous first use without a settings detour.
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
  if (targetID !== 'browser-main') await configureComputerTask({ page, request, threadID: id, origin, targetID });
  else assert.equal((await request('GET', `/_redeven_proxy/api/ai/computer/target?thread_id=${id}`)).target_id, '');
  return id;
}

export async function configureComputerTask({ page, request, threadID, origin, targetID, app, foreground = false }) {
  const targets = await request('GET', '/_redeven_proxy/api/ai/computer/targets');
  const target = targets.find(item => item.id === targetID);
  assert(target, 'explicit qualification target is unavailable');
  await page.getByRole('button', { name: 'Browser and desktop', exact: true }).click();
  const dialog = page.locator('[role="dialog"].flower-computer-dialog');
  // Target IDs remain unambiguous when multiple tabs share the same title.
  await dialog.getByRole('button', { name: 'Choose page or app manually', exact: true }).click();
  const inventory = await request('GET', `/_redeven_proxy/api/ai/computer/candidates?thread_id=${encodeURIComponent(threadID)}`);
  const candidates = inventory.candidates.filter(item => item.target_id === targetID);
  assert.equal(candidates.length, 1, 'fixture target requires one exact candidate');
  await dialog.locator(`input[type=radio][value=${JSON.stringify(candidates[0].candidate_ref)}]`).check();
  await dialog.getByRole('button', {name:'Use selection', exact:true}).click();
  await dialog.locator('[data-flower-computer-panel=overview]').waitFor();
  const thread = await request('GET', `/_redeven_proxy/api/ai/threads/${threadID}`);
  const fullAccess = thread.thread.permission_type === 'full_access';
  if (!fullAccess) await dialog.locator('.flower-computer-footer').getByRole('button').first().click();
  if (!fullAccess && origin) {
    const current = await request('GET', `/_redeven_proxy/api/ai/computer/access?thread_id=${threadID}`);
    if (!(current.origins ?? []).includes(origin)) {
      await dialog.getByRole('textbox', { name: 'Allowed sites', exact: true }).fill(origin);
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    }
  }
  if (!fullAccess && app) await dialog.getByRole('checkbox', { name: app, exact: true }).check();
  if (!fullAccess && foreground) await dialog.getByRole('checkbox', { name: /^Allow temporary desktop use/ }).check();
  if (!fullAccess) {
    await dialog.getByRole('button', { name: 'Save access', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Access saved' }).waitFor();
  }
  const selected = await request('GET', `/_redeven_proxy/api/ai/computer/target?thread_id=${threadID}`);
  assert.equal(selected.target_id, targetID);
  await dialog.getByLabel('Close', { exact: true }).click();
}

export async function openComputerStage(page, { live = false } = {}) {
  if (live) await page.locator('.flower-computer-entry[data-session-state=running]').waitFor();
  if (!await page.locator('.flower-computer-stage').count()) await page.locator('.flower-computer-entry').click();
  await page.locator('.flower-computer-stage').waitFor();
}
