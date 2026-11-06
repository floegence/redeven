/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

/** Runs against real product tab controls in Chromium or Electron. */
export async function inspectPreviewContinuity(page, host, panelSelector, tabNames, options = {}) {
  const interactive = options.interactive !== false;
  const tab = index => host.getByRole('tab').filter({ has: host.getByText(tabNames[index], { exact: true }) });
  await host.locator('[data-floe-floating-window-surface], [role="dialog"]').evaluateAll(async elements => {
    await Promise.all(elements.flatMap(element => element.getAnimations({ subtree: false }).map(animation => animation.finished)));
  });
  const motion = host.locator('.floe-floating-window-motion');
  if (await motion.count()) await motion.evaluateAll(async elements => { await Promise.all(elements.flatMap(element => element.getAnimations().map(animation => animation.finished))); });
  const panels = host.locator(panelSelector);
  const frames = host.locator(panelSelector + ' iframe');
  const handles = await frames.elementHandles();
  assert.equal(handles.length, 2);
  const documents = await Promise.all(handles.map(handle => handle.contentFrame()));
  await host.waitForFunction(selector => { const elements = [...document.querySelectorAll(selector + ' [data-floe-html-state]')]; return elements.length === 2 && elements.every(element => element.dataset.floeHtmlState === 'ready'); }, panelSelector);
  for (let index = 0; index < 2; index++) {
    await tab(index).click();
    if (interactive) await documents[index].getByRole('textbox', { name: 'Frame draft', exact: true }).fill('Retained ' + index);
    await tab(index).focus();
    await documents[index].evaluate(() => window.scrollTo({ top: 420, behavior: 'instant' }));
  }
  const geometry = await panels.evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, height: element.clientHeight })));
  assert.ok(geometry[0].width > 250 && geometry[0].height > 200);
  assert.deepEqual(geometry[0], geometry[1]);
  const originalWidth = await documents[0].evaluate(() => window.innerWidth);
  const viewport = page.viewportSize();
  if (viewport) {
    await page.setViewportSize({ width: viewport.width + 48, height: viewport.height });
    await tab(0).click();
    assert.ok(await documents[0].evaluate(() => window.innerWidth) >= originalWidth);
    assert.equal(await documents[0].evaluate(() => window.scrollY), 420);
    await page.setViewportSize(viewport);
    await tab(1).click();
  }
  const box = await frames.nth(1).boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'Sample the actual document viewport');
  const captureWidth = await page.evaluate(() => window.innerWidth);
  const session = await page.context().newCDPSession(page);
  const images = [];
  session.on('Page.screencastFrame', event => { images.push(event.data); void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }); });
  let worstSwitchMs = 0;
  try {
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    for (let step = 0; step < 16; step++) {
      const index = step % 2;
      const started = Date.now();
      await tab(index).click();
      await host.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      worstSwitchMs = Math.max(worstSwitchMs, Date.now() - started);
      assert.equal(await documents[index].evaluate(() => window.scrollY), 420);
      if (interactive) {
        assert.equal(await documents[index].getByRole('textbox', { name: 'Frame draft', exact: true }).inputValue(), 'Retained ' + index);
        assert.equal(await documents[index].evaluate(() => window.previewBoots), 1);
      }
    }
    await session.send('Page.stopScreencast');
  } finally { await session.detach(); }
  let whiteSamples = 0;
  const brightnessLimit = options.brightnessLimit ?? 80;
  for (const data of images) {
    const png = PNG.sync.read(Buffer.from(data, 'base64'));
    const scale = png.width / captureWidth;
    for (const [x, y] of [[0.25,0.5],[0.5,0.75],[0.75,0.75]]) {
      const pixelX = Math.floor((box.x + box.width * x) * scale);
      const pixelY = Math.floor((box.y + box.height * y) * scale);
      assert.ok(pixelX >= 0 && pixelX < png.width && pixelY >= 0 && pixelY < png.height, 'Every sample lies inside the captured frame');
      const offset = (pixelY * png.width + pixelX) * 4;
      if ([...png.data.subarray(offset, offset + 3)].every(value => value > brightnessLimit)) whiteSamples++;
    }
  }
  assert.ok(images.length >= 8, 'Capture actual composited switching frames');
  assert.equal(whiteSamples, 0, 'Dark documents must not expose a light intermediate reading surface');
  const inactive = await panels.nth(0).evaluate(element => ({ inert: element.inert, ariaHidden: element.getAttribute('aria-hidden'), visibility: getComputedStyle(element).visibility, display: getComputedStyle(element).display }));
  assert.deepEqual(inactive, { inert: true, ariaHidden: 'true', visibility: 'hidden', display: 'block' });
  return { switches: 16, sampledFrames: images.length, whiteSamples, worstSwitchMs, retainedScroll: 420 };
}
