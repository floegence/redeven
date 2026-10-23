import assert from 'node:assert/strict';
import path from 'node:path';

const percentile = (values, quantile = 0.95) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
};

export async function qualifyFlowerSidebarResize({ app, page, session, output, version }) {
  // Keep hardware mouse movement from releasing CDP's captured pointer with
  // buttons=0 while this isolated fixture receives Chromium input events.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setPosition(-10000, -10000));
  const cdp = await app.context().newCDPSession(page);
  const results = [];
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    window.flowerResizeAudit = { active: false, writes: [], intervals: [], endings: [] };
    for (const type of ['blur', 'pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      window.addEventListener(type, event => {
        if (window.flowerResizeAudit.active) window.flowerResizeAudit.endings.push({ type, pointerID: event.pointerId, buttons: event.buttons, x: event.clientX, focused: document.hasFocus(), target: event.target?.className, layout: document.querySelector('.flower-surface')?.dataset.flowerSidebarPresentation });
      }, true);
    }
    Storage.prototype.setItem = function(key, value) {
      if (window.flowerResizeAudit.active && key === 'redeven.flower.threadRailWidth') window.flowerResizeAudit.writes.push(value);
      return setItem.call(this, key, value);
    };
  });
  for (const id of ['sidebar-small', 'sidebar-large', 'sidebar-huge']) {
    await page.evaluate(id => window.flowerSidebar.select(id), id);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.waitForFunction(() => document.hasFocus());
    await page.evaluate(() => {
      const handle = document.querySelector('.flower-component-rail-resizer');
      for (let i = 0; i < 20; i++) handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      for (let i = 0; i < 3; i++) handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const handle = page.locator('.flower-component-rail-resizer');
    const bounds = await handle.evaluate(element => element.getBoundingClientRect().toJSON());
    await page.mouse.move(bounds.x, bounds.y + bounds.height / 2);
    const trace = [];
    const collect = event => trace.push(...event.value);
    cdp.on('Tracing.dataCollected', collect);
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });
    await page.evaluate(() => {
      const audit = window.flowerResizeAudit;
      Object.assign(audit, { active: true, writes: [], intervals: [], endings: [] });
      window.__flowerPerfCounts = { parses: 0, lexes: 0 };
      let previous;
      const sample = time => {
        if (!audit.active) return;
        if (previous !== undefined) audit.intervals.push(time - previous);
        previous = time; requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.mouse.down();
    await page.mouse.move(bounds.x + 100, bounds.y + bounds.height / 2, { steps: 30 });
    await page.mouse.move(bounds.x - 30, bounds.y + bounds.height / 2, { steps: 39 });
    await page.mouse.move(bounds.x + 50, bounds.y + bounds.height / 2, { steps: 24 });
    const during = await page.evaluate(() => window.flowerResizeAudit);
    assert.deepEqual(during.writes, [], `Dragging must not persist intermediate widths: ${JSON.stringify(during.endings)}`);
    await page.mouse.up();
    const sample = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const audit = window.flowerResizeAudit; audit.active = false;
      const root = document.querySelector('.flower-surface');
      return { ...audit, nodes: root.querySelectorAll('*').length, width: root.querySelector('.flower-component-thread-rail').getBoundingClientRect().width,
        inheritedWidth: root.style.getPropertyValue('--flower-thread-rail-width'), drawerWidth: root.style.getPropertyValue('--flower-thread-drawer-width'),
        shield: !!document.querySelector('.flower-thread-rail-drag-shield'), activeHandle: !!root.querySelector('[data-resizing]'), markdown: window.__flowerPerfCounts };
    });
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', collect);
    assert.deepEqual(sample.writes, ['318'], JSON.stringify(sample.endings));
    assert.equal(sample.width, 318);
    assert.equal(sample.inheritedWidth, ''); assert.equal(sample.drawerWidth, '');
    assert.equal(sample.shield, false); assert.equal(sample.activeHandle, false);
    assert.deepEqual(sample.markdown, { parses: 0, lexes: 0 });
    const styles = trace.filter(event => event.name === 'UpdateLayoutTree' && event.ph === 'X');
    const styleElementsP95 = percentile(styles.map(event => event.args?.elementCount ?? 0));
    // Structural performance budget: changing a pane width must not invalidate
    // the full transcript, regardless of machine speed or display refresh rate.
    assert.ok(styles.length > 0 && styleElementsP95 < 3000, `Unbounded style recalculation: ${id}, ${styleElementsP95} elements`);
    const report = { id, nodes: sample.nodes, width: sample.width, writes: sample.writes.length, styleElementsP95,
      styleP95Ms: percentile(styles.map(event => event.dur / 1000)), styleMaxMs: Math.max(...styles.map(event => event.dur / 1000)),
      frameP95Ms: percentile(sample.intervals), frameMaxMs: Math.max(...sample.intervals) };
    results.push(report);
    console.log(JSON.stringify(report));
    await session.writeEvidence(path.join(output, `resize-${id}-trace.json`), JSON.stringify({ traceEvents: trace }));
  }
  // Native capture must survive leaving the handle and settle every ending.
  const endings = [];
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur', 'outside']) {
    const handle = page.locator('.flower-component-rail-resizer');
    const bounds = await handle.evaluate(element => element.getBoundingClientRect().toJSON());
    await page.mouse.move(bounds.x, bounds.y + 30); await page.mouse.down();
    await page.mouse.move(bounds.x - 12, bounds.y + 50);
    if (ending === 'outside') await page.mouse.move(10, 10);
    else await handle.evaluate((element, ending) => {
      if (ending === 'blur') window.dispatchEvent(new Event('blur'));
      else if (ending === 'lostpointercapture') element.releasePointerCapture(1);
      else element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    }, ending);
    await page.mouse.up();
    assert.equal(await page.locator('.flower-thread-rail-drag-shield').count(), 0);
    assert.equal(await handle.getAttribute('data-resizing'), null);
    endings.push(ending);
  }
  await page.evaluate(() => window.flowerSidebar.select('sidebar-large'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await page.waitForFunction(() => document.hasFocus());
  const editor = page.locator('.flower-composer textarea');
  await editor.fill('Keep this draft while resizing');
  const scrolling = page.locator('.flower-chat-transcript');
  await scrolling.hover();
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.flowerResizeTail = document.querySelector('[data-flower-row-message-id="streaming-tail"]');
    window.flowerResizeScroll = document.querySelector('.flower-chat-transcript');
    window.flowerResizeStopStream = window.flowerSidebar.beginResizeStream();
  });
  const resizeBounds = await page.locator('.flower-component-rail-resizer').evaluate(element => element.getBoundingClientRect().toJSON());
  let streamed;
  try {
    await page.mouse.move(resizeBounds.x, resizeBounds.y + 40); await page.mouse.down();
    await page.mouse.move(resizeBounds.x + 70, resizeBounds.y + 40, { steps: 36 });
    await page.mouse.up();
  } finally {
    streamed = await page.evaluate(() => window.flowerResizeStopStream());
  }
  assert.ok(streamed > 0, 'Resize must overlap live delivery');
  await page.waitForFunction(count => document.querySelector('[data-flower-row-message-id="streaming-tail"]')?.textContent.includes(`resize-live-${count}`), streamed);
  const retained = await page.evaluate(() => {
    const viewport = document.querySelector('.flower-chat-transcript');
    return { tail: window.flowerResizeTail === document.querySelector('[data-flower-row-message-id="streaming-tail"]'),
      viewport: window.flowerResizeScroll === viewport, awayFromBottom: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 96,
      selected: document.querySelector('.flower-surface').dataset.flowerSelectedThreadId,
      draft: document.querySelector('.flower-composer textarea').value };
  });
  assert.deepEqual(retained, { tail: true, viewport: true, awayFromBottom: true, selected: 'sidebar-large', draft: 'Keep this draft while resizing' });
  await page.screenshot({ path: path.join(output, 'resize-fixture.png') });
  await session.writeEvidence(path.join(output, 'resize-metrics.json'), JSON.stringify({ version, results, endings, streamed, retained }, null, 2));
  await cdp.detach();
  return results;
}
