/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import {
  startRuntime,
  stopRuntime,
  readTLSServerSPKIHash,
  openEnvPage,
  selectSurface,
  createSession,
  sendTerminalCommand,
} from './checkSemanticTerminalCarrier.mjs';

// The product shell, Local UI transport and native terminal are real. The
// admission-only plugin runtime fixture does not execute plugin Workers.
const temporary = await mkdtemp('/tmp/redeven-plugin-continuity-');
const evidence = path.resolve(
  process.env.REDEVEN_PLUGIN_CONTINUITY_REPORT_DIR ?? 'node_modules/.cache/plugin-creation-continuity',
);
await mkdir(evidence, { recursive: true });
const report = {
  scope: 'Built product shell and real native terminal; admission-only plugin runtime',
  passed: false,
  assertions: [],
};
let runtime, browser, page;
const waitForMarker = async (file) => {
  await expect.poll(async () => readFile(file, 'utf8').catch(() => '')).toBe('same-shell');
};
try {
  const filePath = path.join(temporary, 'home', 'plugin-continuity.txt');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'Retain this file browser while creating a plugin.\n');
  runtime = await startRuntime(temporary);
  const spki = await readTLSServerSPKIHash(runtime.startup.local_ui_url, runtime.authorityCertificatePath);
  browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  ({ page } = await openEnvPage(context, new URL('_redeven_proxy/env/', runtime.startup.local_ui_url).href));
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const activity = page.getByRole('tab', { name: 'Activity', exact: true });
  if ((await activity.getAttribute('aria-selected')) !== 'true') await activity.click();
  const activityBar = page.locator('nav[data-floe-shell-slot="activity-bar"]');
  await activityBar.getByRole('button', { name: 'File Browser', exact: true }).click();
  const fileRow = page.locator('[data-file-browser-item-id]:visible').filter({ hasText: 'plugin-continuity.txt' }).first();
  await fileRow.waitFor();
  await fileRow.evaluate((element) => {
    window.__pluginContinuityFile = element;
  });
  const fileFilter = page.getByRole('textbox', { name: 'Filter files', exact: true });
  await fileFilter.fill('plugin-continuity');
  const panel = await selectSurface(page, 'panel');
  const session = await createSession(page, panel);
  await session.runtime.evaluate((element) => {
    window.__pluginContinuityTerminal = element;
  });
  await sendTerminalCommand(page, 'PLUGIN_CONTINUITY=same-shell', panel);
  await page
    .locator('nav[data-floe-shell-slot="activity-bar"]')
    .getByRole('button', { name: 'Plugins', exact: true })
    .click();
  await page.locator('[data-plugin-center-market-action]').click();
  await page.locator('[data-plugin-center-create-plugin]').click();
  const workspace = page.locator('[data-plugin-creation-workspace]');
  await workspace.waitFor();
  const assertContentPlacement = async () => {
    const creation = page.locator('[data-redeven-plugin-creation-page]');
    const header = page.locator('[data-floe-shell-slot="top-bar"]:visible');
    await expect(header).toBeVisible();
    await expect(activityBar).toBeVisible();
    const bounds = await creation.boundingBox();
    const headerBounds = await header.boundingBox();
    const railBounds = await activityBar.boundingBox();
    assert.ok(bounds && headerBounds && railBounds);
    assert.ok(bounds.y >= headerBounds.y + headerBounds.height);
    assert.ok(bounds.x >= railBounds.x + railBounds.width);
  };
  await assertContentPlacement();
  assert.equal(
    await page.evaluate(() => window.__pluginContinuityTerminal?.isConnected),
    true,
  );
  const composer = workspace.locator('textarea').first();
  await composer.fill('Keep this plugin draft while I check the terminal.');
  await expect(workspace).toHaveAttribute('data-project-id', /^draft_/);
  const draftID = await workspace.getAttribute('data-project-id');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'workspace-light.png') });
  await page.getByRole('button', { name: 'Back to creation history', exact: true }).click();
  await page.locator('[data-plugin-draft-library]').waitFor();
  await assertContentPlacement();
  await expect(page.locator('[data-plugin-history-entry="' + draftID + '"]')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'history-light.png') });
  await page.getByRole('button', { name: 'Back to Plugin Center', exact: true }).click();
  await page.locator('[data-plugin-center-view]').waitFor();
  report.assertions.push('Detail returns to creation history, then Plugin Center; header and Activity rail remain available');
  const restored = await selectSurface(page, 'panel');
  const retained = restored.locator('[data-terminal-runtime-session="' + session.sessionID + '"]').first();
  await retained.waitFor();
  assert.equal(await retained.evaluate((element) => element === window.__pluginContinuityTerminal), true);
  const marker = path.join(temporary, 'same-shell.txt');
  await sendTerminalCommand(page, 'printf %s "$PLUGIN_CONTINUITY" > ' + "'" + marker + "'", restored);
  await waitForMarker(marker);
  report.assertions.push('Plugin creation preserves the original terminal DOM, session and shell environment');
  await activityBar.getByRole('button', { name: 'File Browser', exact: true }).click();
  await fileRow.waitFor();
  assert.equal(await fileRow.evaluate((element) => element === window.__pluginContinuityFile), true);
  await expect(fileFilter).toHaveValue('plugin-continuity');
  report.assertions.push('Plugin creation preserves the original file row and unsent file filter');
  await page
    .locator('nav[data-floe-shell-slot="activity-bar"]')
    .getByRole('button', { name: 'Plugins', exact: true })
    .click();
  await page.locator('[data-plugin-center-market-action]').click();
  await page.locator('[data-plugin-center-drafts]').click();
  await page.locator('[data-plugin-history-entry="' + draftID + '"]').click();
  await expect(workspace).toHaveAttribute('data-project-id', draftID);
  await expect(workspace.locator('textarea').first()).toHaveValue('Keep this plugin draft while I check the terminal.');
  await activityBar.getByRole('button', { name: 'File Browser', exact: true }).click();
  await workspace.waitFor({ state: 'detached' });
  await expect(fileFilter).toHaveValue('plugin-continuity');
  await activityBar.getByRole('button', { name: 'Plugins', exact: true }).click();
  await page.locator('[data-plugin-center-market-action]').click();
  await page.locator('[data-plugin-center-drafts]').click();
  await page.locator('[data-plugin-history-entry="' + draftID + '"]').click();
  await expect(workspace.locator('textarea').first()).toHaveValue('Keep this plugin draft while I check the terminal.');
  report.assertions.push('Activity rail navigation saves the draft and preserves it when reopened');
  await page.reload();
  await expect(workspace).toHaveAttribute('data-project-id', draftID);
  await expect(workspace.locator('textarea').first()).toHaveValue('Keep this plugin draft while I check the terminal.');
  report.assertions.push('The real product draft library and page reload restore the same unsent composer');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click();
  await workspace.waitFor({ state: 'detached' });
  assert.deepEqual(pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (page) {
    report.visibleText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await stopRuntime(runtime);
  report.runtimeStopped = !runtime || runtime.state.exited;
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
}
