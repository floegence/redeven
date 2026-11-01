/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { startRuntime, stopRuntime, readTLSServerSPKIHash, openEnvPage, selectSurface, createSession, sendTerminalCommand, waitForTrace, runtimeTrace } from './checkSemanticTerminalCarrier.mjs';
const tempDir = await mkdtemp('/tmp/redeven-terminal-workspace-');
const evidence = path.resolve('node_modules/.cache/terminal-workspace');
await mkdir(evidence, { recursive: true });
let runtime, browser, page;
const report = { status: 'running', checks: [] };
try {
  runtime = await startRuntime(tempDir);
  const spki = await readTLSServerSPKIHash(runtime.startup.local_ui_url, runtime.authorityCertificatePath);
  browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const entryURL = new URL('_redeven_proxy/env/', runtime.startup.local_ui_url).toString();
  const opened = await openEnvPage(context, entryURL);
  page = opened.page;
  const { problems } = opened;
  const panel = await selectSurface(page, 'panel');
  const created = await createSession(page, panel);
  const firstId = created.sessionID;
  const createGroup = async name => {
    await panel.getByTestId('terminal-sidebar-add-group').click();
    const dialog = page.getByRole('dialog', { name: 'New group', exact: true });
    await dialog.getByRole('textbox').first().fill(name);
    await dialog.getByTestId('terminal-group-path-input').fill(tempDir);
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    const row = panel.locator('[data-terminal-group-header]').filter({ hasText: name });
    await row.waitFor();
    await expect(row.getByRole('button', { name: 'New session in ' + name, exact: true })).toBeEnabled();
    return row;
  };
  const groupA = await createGroup('Workspace A');
  const groupB = await createGroup('Workspace B');
  const groupAId = await groupA.getAttribute('data-terminal-group-header');
  const groupBId = await groupB.getAttribute('data-terminal-group-header');
  await panel.locator('[data-terminal-session-drag-handle="' + firstId + '"]').dragTo(groupA);
  await panel.locator('[data-terminal-group-sessions="' + groupAId + '"] [data-terminal-session-id="' + firstId + '"]').waitFor();
  await groupB.dragTo(groupA, { targetPosition: { x: 80, y: 2 } });
  await expect.poll(() => panel.locator('[data-terminal-group-header]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-terminal-group-header')))).toEqual(['default', groupBId, groupAId]);
  await groupA.getByRole('button', { name: 'New session in Workspace A', exact: true }).click();
  const groupSessions = panel.locator('[data-terminal-group-sessions="' + groupAId + '"] [data-terminal-session-id]');
  await expect(groupSessions).toHaveCount(2);
  await expect(panel.locator('[data-terminal-group-sessions="' + groupAId + '"] [data-terminal-session-drag-handle][draggable="true"]')).toHaveCount(2);
  const secondId = await groupSessions.last().getAttribute('data-terminal-session-id');
  await panel.locator('[data-terminal-session-drag-handle="' + secondId + '"]').dragTo(groupSessions.first(), { targetPosition: { x: 90, y: 2 } });
  await expect(groupSessions.first()).toHaveAttribute('data-terminal-session-id', secondId);
  report.checks.push('catalog group creation, scoped sessions, cross-group moves and protected Default order');
  await panel.getByTestId('terminal-workspace-layout').click();
  await page.getByRole('menuitem', { name: 'Grid', exact: true }).click();
  await expect(panel.locator('[data-floe-split-pane]:visible')).toHaveCount(4);
  const ids = await panel.locator('[data-floe-split-pane]:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-floe-split-pane')));
  const traces = [];
  for (const [index, id] of ids.entries()) {
    const pane = panel.locator('[data-floe-split-pane="' + id + '"]');
    const session = pane.locator('[data-terminal-runtime-session]');
    await waitForTrace(session, trace => trace.sequence > 0 && !trace.semantic_error);
    await pane.locator('[data-floe-split-header]').click({ position: { x: 30, y: 15 } });
    const marker = path.join(tempDir, 'pane-' + index);
    await sendTerminalCommand(page, 'printf workspace-' + index + '; printf ok > ' + marker, session);
    await assert.doesNotReject(async () => {
      for (let retry = 0; retry < 100; retry++) {
        try { if ((await readFile(marker, 'utf8')) === 'ok') return; } catch { /* Wait for the PTY command. */ }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Pane input did not reach its own PTY');
    });
    traces.push(await runtimeTrace(session));
  }
  assert.equal(traces.length, 4);
  report.checks.push('four real PTYs independently accept input and paint output');
  await panel.evaluate(root => { window.workspaceRuntimeNodes = [...root.querySelectorAll('[data-terminal-runtime-session]')]; });
  const divider = panel.getByRole('separator', { name: 'Resize panes' }).first();
  await divider.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await divider.getAttribute('aria-valuenow'), '55');
  await page.keyboard.press('Enter');
  assert.equal(await divider.getAttribute('aria-valuenow'), '50');
  const first = panel.locator('[data-floe-split-pane="' + firstId + '"]');
  await first.getByRole('button', { name: 'Maximize pane', exact: true }).click();
  assert.equal(await panel.locator('[data-floe-split-pane]:visible').count(), 1);
  await page.getByRole('button', { name: 'Restore panes', exact: true }).click();
  assert.equal(await panel.locator('[data-floe-split-pane]:visible').count(), 4);
  assert.equal(await panel.evaluate(root => window.workspaceRuntimeNodes.every(node => [...root.querySelectorAll('[data-terminal-runtime-session]')].includes(node))), true);
  report.checks.push('resize and maximize preserve genuine runtime nodes');
  const sourcePane = panel.locator('[data-floe-split-header="' + ids[0] + '"]');
  const targetPane = panel.locator('[data-floe-split-pane="' + ids[1] + '"]');
  const targetBounds = await targetPane.boundingBox();
  await sourcePane.dragTo(targetPane, { targetPosition: { x: targetBounds.width / 2, y: targetBounds.height - 5 } });
  assert.equal(await panel.evaluate(root => window.workspaceRuntimeNodes.every(node => [...root.querySelectorAll('[data-terminal-runtime-session]')].includes(node))), true);
  assert.equal(await panel.locator('[data-floe-split-pane]:visible').count(), 4);
  report.checks.push('pane edge docking retains runtime instances');

  await page.screenshot({ path: path.join(evidence, 'desktop-real.png') });
  await first.getByRole('button', { name: 'Close pane', exact: true }).click();
  assert.equal(await panel.locator('[data-floe-split-pane]:visible').count(), 3);
  assert.equal(await panel.locator('[data-terminal-session-id="' + firstId + '"]').count(), 1);
  report.checks.push('closing a pane preserves its terminal session');
  await panel.locator('[data-terminal-session-drag-handle="' + firstId + '"]').dragTo(panel.locator('[data-floe-split-pane]:visible').first(), { targetPosition: { x: 5, y: 70 } });
  await first.waitFor({ state: 'visible' });
  assert.equal(await panel.locator('[data-floe-split-pane]:visible').count(), 4);
  assert.equal(await panel.evaluate(root => window.workspaceRuntimeNodes.every(node => [...root.querySelectorAll('[data-terminal-runtime-session]')].includes(node))), true);
  await first.getByRole('button', { name: 'Close pane', exact: true }).click();
  report.checks.push('sidebar docking restores a retained session without remounting');
  const touchEmulation = await context.newCDPSession(page);
  await touchEmulation.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.locator('[data-floe-split-pane]:visible')).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Terminal panes' }).getByRole('button').first().click();
  await page.screenshot({ path: path.join(evidence, 'mobile-real.png') });
  await touchEmulation.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize({ width: 1440, height: 940 });
  await expect(panel.locator('[data-floe-split-pane]:visible')).toHaveCount(3);
  report.checks.push('mobile focus tabs preserve desktop layout');
  report.storageBeforeReload = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.includes('terminal_workspace'))));
  await page.reload();
  const restored = await selectSurface(page, 'panel');
  await restored.locator('[data-floe-split-pane]:visible').first().waitFor();
  await expect(restored.locator('[data-floe-split-pane]:visible')).toHaveCount(3);
  report.checks.push('layout survives page reload');
  const sessionsBeforeSplit = await restored.locator('[data-terminal-session-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-terminal-session-id')));
  await restored.locator('[data-floe-split-pane]:visible').first().locator('button[aria-label="Split pane"]').click();
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(restored.locator('[data-floe-split-pane]:visible')).toHaveCount(4);
  const splitIds = await restored.locator('[data-floe-split-pane]:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-floe-split-pane')));
  const freshId = splitIds.find(id => !sessionsBeforeSplit.includes(id));
  assert.ok(freshId, 'Explicit split must create a fresh session, even when an existing session is not placed');
  await restored.locator('[data-terminal-group-sessions="' + groupAId + '"] [data-terminal-session-id="' + freshId + '"]').waitFor();
  const freshRuntime = restored.locator('[data-terminal-runtime-session="' + freshId + '"]');
  await waitForTrace(freshRuntime, trace => trace.sequence > 0 && !trace.semantic_error);
  const splitMarker = path.join(tempDir, 'fresh-split');
  await sendTerminalCommand(page, 'printf ok > ' + splitMarker, freshRuntime);
  await expect(restored.locator('[data-floe-split-pane]:visible')).toHaveCount(4);
  for (let retry = 0; retry < 100; retry++) {
    try { if ((await readFile(splitMarker, 'utf8')) === 'ok') break; } catch { /* Wait for the PTY command. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await readFile(splitMarker, 'utf8'), 'ok');
  report.checks.push('explicit split creates a fresh same-group PTY without reusing hidden sessions');
  for (const key of ['page', 'console', 'requests', 'responses']) assert.deepEqual(problems[key], [], key);
  report.status = 'passed';
  console.log(JSON.stringify(report));
} catch (error) {
  report.storageAfterReload = await page?.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.includes('terminal_workspace'))));
  report.status = 'failed';
  report.error = String(error.stack ?? error);
  await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  throw error;
}
finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); if (runtime) await stopRuntime(runtime);
  await rm(tempDir, { recursive: true, force: true });
}
