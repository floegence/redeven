import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { BrowserComputerPage } from './computerBrowserPage.mjs';

async function fixture(run) {
  const browser = await chromium.launch({headless:true});
  try {
    const tab = await browser.newPage();
    const page = new BrowserComputerPage(await tab.context().newCDPSession(tab));
    await page.initialize();
    try { await run(tab, page); } finally { page.close(); }
  } finally { await browser.close(); }
}

test('bounded fields disclose loss across snapshots, node reads and query pages', () => fixture(async (tab, page) => {
  for (const character of ['x', '中', '🙂']) for (const length of [1999, 2000, 2100]) {
    const full = character.repeat(length);
    await tab.setContent('<input><button>Other</button>');
    await tab.locator('input').evaluate((node, text) => {
      node.setAttribute('aria-label', text); node.setAttribute('aria-description', text); node.value = text;
    }, full);
    const snapshot = await page.observe();
    assert.equal(snapshot.truncated, false);
    const node = snapshot.nodes.find(node => node.role === 'textbox');
    for (const field of ['name', 'description', 'value']) {
      assert.equal(node[field], character.repeat(Math.min(length, 2000)));
      assert.equal(node[field + '_truncated'] === true, length > 2000, field);
    }
    const entry = await page.resolve({ref:node.ref});
    const single = await page.observe({root_ref:entry.ref, limit:1});
    assert.equal(single.nodes[0].name_truncated === true, length > 2000);
    const query = await page.query({role:'textbox'}, {limit:1});
    assert.equal(query.items[0].name_truncated === true, length > 2000);
    if (length > 2000) await assert.rejects(page.attribute(entry, 'aria-label'), error =>
      error.message === 'TARGET_CAPABILITY_UNAVAILABLE' && error.diagnostic.expected === 'attribute_max_2000');
    else assert.equal((await page.attribute(entry, 'aria-label')).value, full);
  }
}));

test('reference validation detects changes beyond the display prefix', () => fixture(async (tab, page) => {
  for (const observeBeforeResolve of [false, true]) {
    await tab.setContent('<button></button>');
    const prefix = '🙂'.repeat(2000);
    await tab.locator('button').evaluate((node, value) => {node.textContent=value;}, prefix+'A');
    const node = (await page.observe()).nodes.find(node => node.role === 'button');
    assert.ok(await page.resolve({ref:node.ref}));
    await tab.locator('button').evaluate((node, value) => {node.textContent=value;}, prefix+'B');
    // A fresh observation must not rebind a previously issued token, even if
    // no stale lookup has yet removed the old entry.
    if (observeBeforeResolve) await page.observe();
    await assert.rejects(page.resolve({ref:node.ref}), /STALE_REFERENCE/);
    assert.ok(await page.resolve({role:'button', name:prefix+'B', exact:true}));
    await assert.rejects(page.resolve({role:'button', name:prefix, exact:true}), /ELEMENT_NOT_FOUND/);
  }
}));

test('collection cursor validates full names including an unreturned tail', () => fixture(async (tab, page) => {
  await tab.setContent('<button>First</button><button id=tail></button>');
  const prefix = 'x'.repeat(2000);
  await tab.locator('#tail').evaluate((node, value) => {node.textContent=value;}, prefix+'A');
  const first = await page.query({role:'button'}, {limit:1});
  assert.ok(first.next_cursor);
  assert.equal((await page.query({role:'button'}, {limit:1,cursor:first.next_cursor})).items.length, 1);
  await tab.locator('#tail').evaluate((node, value) => {node.textContent=value;}, prefix+'B');
  await assert.rejects(page.query({role:'button'}, {limit:1,cursor:first.next_cursor}), /STALE_REFERENCE/);
}));
