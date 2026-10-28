import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// One content oracle shared by CPU and mandatory long-thread qualification.
export async function verifyFlowerRendered({ page, visible, ui, output, bodySelector = '' }) {
  const require = createRequire(path.join(ui, 'package.json'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  // Inspect after timing; compare every generated item with full parsing.
  const generatedTurn = visible.items.find(item => item.turn_id)?.turn_id;
  const turnSelector = bodySelector + '.flower-turn-row[data-flower-turn-id=' + JSON.stringify(generatedTurn) + ']';
  const summary = page.locator(turnSelector + ' .flower-turn-summary-button').first();
  await page.waitForTimeout(500);
  if (await summary.count() && await summary.getAttribute('aria-expanded') === 'false') await summary.click();
  const { createMarkdownParser } = await import(pathToFileURL(path.join(ui, 'node_modules/@floegence/floe-webapp-core/dist/markdown.js')));
  const { JSDOM } = require('jsdom');
  const markdown = createMarkdownParser({ gfm: true, breaks: false, pedantic: false });
  const rendered = [];
  for (const item of visible.items.filter(item => item.kind === 'assistant' || item.kind === 'thinking')) {
    // A turn can contain several independently folded process groups. Open
    // the control for this row rather than repeatedly opening the first one.
    const wrapper = page.locator(bodySelector + '[data-flower-row-message-id=' + JSON.stringify(item.id) + ']').first();
    // Window membership is bounded. Inspect older generated rows through
    // the product's history controls after timing, then scroll to admit
    // lazy body hydration before opening the thinking/message content.
    const navigation = page.locator(bodySelector ? '.flower-subagent-detail-window .flower-history-navigation' : '.flower-transcript-stack .flower-history-navigation');
    const latest = navigation.getByRole('button', { name: 'Back to latest', exact: true });
    if (!await wrapper.count() && await latest.count()) { await latest.click(); await page.waitForTimeout(100); }
    for (let moves = 0; !await wrapper.count() && moves < 100; moves++) {
      const older = navigation.getByRole('button', { name: 'Earlier messages', exact: true });
      if (!await older.count()) break;
      await older.click();
      await page.waitForTimeout(100);
    }
    await wrapper.waitFor({ state: 'attached', timeout: 15000 });
    await wrapper.scrollIntoViewIfNeeded();
    const viewportID = await wrapper.locator('.flower-turn-row-viewport').getAttribute('id');
    const disclosure = page.locator(bodySelector + '.flower-turn-summary-button[aria-controls~=' + JSON.stringify(viewportID) + ']').first();
    if (await disclosure.count() && await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
    // Sequence members move into their first row's disclosure. Open that
    // parent before locating a member that has intentionally unmounted.
    // Query only closed groups. Rechecking every already-open sequence for
    // each item creates quadratic protocol traffic during long-turn checks.
    const closedSequences = page.locator(turnSelector + ' .flower-tool-sequence-toggle[aria-expanded="false"]');
    while (await closedSequences.count()) await closedSequences.first().click();
    const row = page.locator(bodySelector + (item.kind === 'thinking'
      ? '[data-flower-thinking-id=' + JSON.stringify(`${item.id}:block:0`) + ']'
      : '[data-flower-message-id=' + JSON.stringify(item.id) + ']')).first();
    await wrapper.scrollIntoViewIfNeeded();
    try { await row.waitFor({ state: 'attached', timeout: 15000 }); } catch (error) {
      await writeFile(output + '.dom.html', await page.content());
      await page.screenshot({ path: output + '.png' });
      throw error;
    }
    const sequenceIDs = await row.evaluate(node => [...node.querySelectorAll('.flower-tool-sequence-viewport'), node.closest('.flower-tool-sequence-viewport')]
      .filter(Boolean).map(viewport => viewport.id));
    for (const sequenceID of sequenceIDs) {
      const sequence = page.locator(bodySelector + '.flower-tool-sequence-toggle[aria-controls~=' + JSON.stringify(sequenceID) + ']').first();
      if (await sequence.count() && await sequence.getAttribute('aria-expanded') === 'false') await sequence.click();
    }
    await row.waitFor({ timeout: 15000 });
    const toggle = row.locator('.flower-thinking-toggle');
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    const contentSelector = item.kind === 'thinking' ? '.flower-message-plain-text' : '.flower-chat-md-block';
    await row.locator(contentSelector).first().waitFor({ state: 'attached', timeout: 15000 });
    const actual = await row.locator(contentSelector).evaluateAll(nodes => nodes.map(node => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('.flower-chat-md-code-copy, .flower-chat-md-code-header, .flower-answer-actions').forEach(node => node.remove());
      return clone.textContent;
    }).join(''));
    let expected = item.text ?? '';
    if (item.kind !== 'thinking') {
      const dom = new JSDOM(String(markdown.parse(expected)));
      expected = dom.window.document.body.textContent ?? '';
      dom.window.close();
    }
    const normalize = value => item.kind === 'thinking' ? value : value.replace(/\s+/gu, ' ').trim();
    const actualCode = await row.locator(contentSelector + ' pre > code').allTextContents();
    const expectedCode = [];
    if (item.kind !== 'thinking') markdown.walkTokens(markdown.lexer(item.text ?? ''), token => { if (token.type === 'code') expectedCode.push(token.text); });
    rendered.push({ id: item.id, kind: item.kind, actual: hash(normalize(actual)), expected: hash(normalize(expected)), exact: normalize(actual) === normalize(expected) && JSON.stringify(actualCode) === JSON.stringify(expectedCode), codeBlocks: actualCode.length });
    if (rendered.length % 50 === 0) console.log('Verified generated content items: ' + rendered.length);
  }
  return rendered;
}
