/* global document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const server = await createSSHSettingsPreviewServer(0, ['flower-navigation.html', 'environment-settings.html']);
let browser;
async function assertUnchangedPresentation(surface, nodesSelector = '*') {
  await surface.scrollIntoViewIfNeeded();
  await surface.evaluate(async root => {
    await Promise.all([...root.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
    await Promise.all(root.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  const presentation = () => surface.evaluate(root => [root, ...root.querySelectorAll('*')].map(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: style.color,
      background: style.backgroundColor, font: style.font, padding: style.padding, margin: style.margin, border: style.border, transform: style.transform };
  }));
  const geometry = await presentation();
  const pixels = createHash('sha256').update(await surface.screenshot({ animations: 'disabled', caret: 'hide' })).digest('hex');
  const attributes = ['id', 'aria-controls', 'aria-labelledby'];
  const records = await surface.evaluate((root, { attributes, nodesSelector }) => [root, ...root.querySelectorAll(nodesSelector)].map(node => attributes.map(name => [name, node.getAttribute(name)])), { attributes, nodesSelector });
  try {
    await surface.evaluate((root, { attributes, nodesSelector }) => [root, ...root.querySelectorAll(nodesSelector)].forEach(node => attributes.forEach(name => node.removeAttribute(name))), { attributes, nodesSelector });
    assert.deepEqual(await presentation(), geometry);
    assert.equal(createHash('sha256').update(await surface.screenshot({ animations: 'disabled', caret: 'hide' })).digest('hex'), pixels);
  } finally {
    await surface.evaluate((root, { records, nodesSelector }) => [root, ...root.querySelectorAll(nodesSelector)].forEach((node, index) => records[index].forEach(([name, value]) => { if (value !== null) node.setAttribute(name, value); })), { records, nodesSelector });
  }
}
try {
  const { linkedEnvironmentFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/linkedEnvironmentFixture.ts', import.meta.url)));
  const { runtimeConnectionFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/runtimeConnectionFixture.ts', import.meta.url)));
  const snapshots = [linkedEnvironmentFixture().snapshot, runtimeConnectionFixture().snapshot];
  const axe = await readFile(new URL('../../internal/envapp/ui_src/node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  browser = await chromium.launch({ headless: true });
  for (const snapshot of snapshots) {
    for (const locale of ['en-US', 'zh-CN']) {
      for (const width of [390, 1200]) {
        const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
        await page.addInitScript(({ snapshot, locale }) => {
          window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
          const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
          window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
        }, { snapshot, locale });
        await page.goto(new URL('flower-navigation.html', server.resolvedUrls.local[0]).href);
        const cards = page.locator('[data-environment-group]');
        const card = cards.filter({ has: page.getByRole('tablist') }).first();
        const tabs = card.getByRole('tab');
        await tabs.first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.addScriptTag({ content: axe });
        const violations = await page.evaluate(async () => (await window.axe.run('[data-environment-group]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) })));
        assert.deepEqual(violations, [], `${locale}/${width}: Welcome card axe audit`);
        const relations = await tabs.evaluateAll(elements => elements.map(tab => {
          const panel = document.getElementById(tab.getAttribute('aria-controls'));
          return { id: tab.id, valid: panel?.getAttribute('aria-labelledby') === tab.id };
        }));
        assert(relations.length >= 2);
        assert(relations.every(({ id, valid }) => id && valid));
        assert.equal(new Set(relations.map(({ id }) => id)).size, relations.length);
        const cardRelations = await cards.evaluateAll(roots => roots.flatMap(root => {
          const tabs = [...root.querySelectorAll('[role="tab"]')];
          const panels = [...root.querySelectorAll('[role="tabpanel"]')];
          return panels.map(panel => ({ id: panel.id, single: tabs.length === 0,
            labelledBy: panel.getAttribute('aria-labelledby'),
            valid: tabs.length === 0 ? !panel.hasAttribute('aria-labelledby') : tabs.some(tab => tab.id === panel.getAttribute('aria-labelledby') && tab.getAttribute('aria-controls') === panel.id) }));
        }));
        assert(cardRelations.every(({ id, valid }) => id && valid), 'every owner panel uses its own tab or standalone accessible label');
        assert.equal(new Set(cardRelations.map(({ id }) => id)).size, cardRelations.length, 'panel IDs are unique across cards');
        const tabIDs = await page.getByRole('tab').evaluateAll(elements => elements.map(tab => tab.id));
        assert.equal(new Set(tabIDs).size, tabIDs.length, 'tab IDs are unique across cards');
        await page.evaluate(() => window.navigationFixture.publish({ environments: window.navigationSnapshot.environments.map(entry => ({ ...entry })) }));
        assert.deepEqual(await page.getByRole('tab').evaluateAll(elements => elements.map(tab => tab.id)), tabIDs, 'refresh preserves tab identities');
        await assertUnchangedPresentation(card, '[role="tab"], [role="tabpanel"]');
        const selectedPanel = async index => {
          const target = await tabs.nth(index).getAttribute('aria-controls');
          assert(target);
          const panel = page.locator(`[id="${target}"]`);
          await panel.waitFor({ state: 'visible' });
          assert.equal(await panel.getAttribute('inert'), null);
          assert.equal(await tabs.nth(index).getAttribute('aria-selected'), 'true');
          return panel;
        };
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        await selectedPanel(1);
        assert.equal(await tabs.nth(1).evaluate(tab => document.activeElement === tab), true);
        const firstPanelID = await tabs.first().getAttribute('aria-controls');
        assert.equal(await page.locator(`[id="${firstPanelID}"]`).getAttribute('inert'), '');
        await page.keyboard.press('Home');
        await selectedPanel(0);
        await tabs.nth(1).click();
        await selectedPanel(1);
        await page.keyboard.press('End');
        await selectedPanel(relations.length - 1);
        await page.keyboard.press('Home');
        await selectedPanel(0);
        await page.close();
      }
    }
  }
  const { createDesktopI18n } = await server.ssrLoadModule(fileURLToPath(new URL('../src/shared/i18n/index.ts', import.meta.url)));
  const settingsSnapshot = runtimeConnectionFixture({ kind: 'ssh_environment' }).snapshot;
  const target = settingsSnapshot.environments.find(entry => entry.kind === 'ssh_environment' && entry.can_edit);
  assert(target);
  for (const locale of ['en-US', 'zh-CN']) {
    for (const width of [390, 1200]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.addInitScript(({ snapshot, locale }) => {
        window.settingsFixtureSnapshot = snapshot;
        const language = { preference: locale, resolved_locale: locale, source: 'explicit', system_candidates: [] };
        window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
      }, { snapshot: settingsSnapshot, locale });
      await page.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
      const i18n = createDesktopI18n(locale);
      const ownerLabel = i18n.t('environmentCenter.relationshipOwnerLabel', { label: target.label, owner: i18n.t('environmentCenter.runtimeOwner') });
      const trigger = page.getByRole('button', { name: i18n.t('environmentCenter.settingsForLabel', { label: ownerLabel }), exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-floe-dialog-panel]')).opacity === '1');
      const tabs = dialog.getByRole('tab');
      assert.equal(await tabs.count(), 2);
      const relations = await tabs.evaluateAll(elements => elements.map(tab => ({ id: tab.id,
        valid: document.getElementById(tab.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') === tab.id })));
      assert(relations.every(({ id, valid }) => id && valid));
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => (await window.axe.run('.redeven-environment-settings-dialog', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) })));
      assert.deepEqual(violations, [], `${locale}/${width}: Welcome settings axe audit`);
      await assertUnchangedPresentation(dialog, '[role="tab"], [role="tabpanel"]');
      await tabs.first().focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
      assert.equal(await tabs.nth(1).evaluate(tab => document.activeElement === tab), true);
      const panelID = await tabs.nth(1).getAttribute('aria-controls');
      await page.locator(`[id="${panelID}"]`).waitFor({ state: 'visible' });
      const hiddenID = await tabs.first().getAttribute('aria-controls');
      assert.equal(await page.locator(`[id="${hiddenID}"]`).getAttribute('aria-hidden'), 'true');
      await page.keyboard.press('Home');
      await tabs.nth(1).click();
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, await trigger.getAttribute('aria-label'));
      assert.equal(await trigger.evaluate(button => document.activeElement === button), true, 'settings close restores its owner control');
      await page.close();
    }
  }
  console.log('Welcome cards/settings axe, tab relations, keyboard, focus, pointer, inert panels and unchanged pixels/styles passed in two locales and widths.');
} finally {
  await browser?.close();
  await server.close();
}
