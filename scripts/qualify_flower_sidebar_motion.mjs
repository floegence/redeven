import assert from 'node:assert/strict';
import path from 'node:path';

/** Exercise minified production CSS in the real Desktop renderer. */
export async function qualifyFlowerSidebarMotion({ page, session, output, version }) {
  const compactPresentation = [];
  for (const width of [220, 272, 312, 313, 380, 272]) {
    await page.evaluate(width => { document.querySelector('.flower-surface').style.gridTemplateColumns = `${width}px 0 minmax(0, 1fr)`; }, width);
    for (const name of ['Time', 'Directory']) {
      await page.getByRole('radio', { name, exact: true }).click();
      await page.evaluate(async () => {
        document.getAnimations().forEach(animation => animation.finish());
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const options = await page.evaluate(() => {
        const rail = document.querySelector('.flower-thread-view-switch');
        return [...rail.querySelectorAll('button[role="radio"]')].map(button => {
          const ink = [...rail.querySelectorAll('[data-segmented-label]')].find(node => node.textContent === button.getAttribute('aria-label'));
          const nativeLabel = button.querySelector('.floe-segmented-control__label');
          const paintedLabel = ink.querySelector('.floe-segmented-control__label');
          const nativeIcon = button.querySelector('svg').getBoundingClientRect();
          const paintedIcon = ink.querySelector('svg').getBoundingClientRect();
          return { name: button.getAttribute('aria-label'), title: button.title,
            nativeHidden: getComputedStyle(nativeLabel).display === 'none',
            paintedHidden: paintedLabel !== null && getComputedStyle(paintedLabel).display === 'none',
            iconDelta: Math.max(Math.abs(nativeIcon.x - paintedIcon.x), Math.abs(nativeIcon.y - paintedIcon.y)) };
        });
      });
      for (const option of options) {
        assert.equal(option.nativeHidden, width <= 312, `native label at ${width}px`);
        assert.equal(option.paintedHidden, width <= 312, `painted label at ${width}px`);
        assert.ok(option.iconDelta <= 1, `native/painted icons align at ${width}px`);
        assert.equal(option.title, option.name);
      }
      compactPresentation.push({ width, selected: name, options });
    }
  }
  await page.evaluate(() => { document.querySelector('.flower-surface').style.gridTemplateColumns = '272px 0 minmax(0, 1fr)'; });
  await page.getByRole('radio', { name: 'Directory', exact: true }).click();
  await page.waitForTimeout(350);
  const before = await page.evaluate(() => window.flowerSidebar.pinState().listStarted);
  const results = [];
  const sample = async (selector, metric, action) => {
    await page.evaluate(({ selector, metric }) => {
      const target = document.querySelector(selector);
      window.flowerMotionSamples = new Promise(resolve => {
        document.addEventListener('click', () => {
          const start = performance.now();
          const values = [];
          const frame = () => {
            values.push({ time: performance.now() - start, value: target.getBoundingClientRect()[metric] });
            if (performance.now() - start < 380) requestAnimationFrame(frame);
            else resolve(values);
          };
          frame();
        }, { once: true });
      });
    }, { selector, metric });
    await action();
    const values = await page.evaluate(() => window.flowerMotionSamples);
    const initial = values[0].value, final = values.at(-1).value;
    const travel = values.filter(value => Math.abs(value.value - initial) > 1 && Math.abs(value.value - final) > 1);
    assert.ok(travel.length >= 5, 'At least five painted travel frames: ' + selector + ' ' + JSON.stringify(values));
    assert.ok(travel.at(-1).time - travel[0].time >= 100, 'Sustained visible travel: ' + selector);
    const direction = Math.sign(final - initial);
    for (let index = 1; index < values.length; index++) {
      assert.ok((values[index].value - values[index - 1].value) * direction >= -0.5, 'Monotonic travel: ' + selector);
    }
    results.push({ selector, metric, initial, final, travelFrames: travel.length, values });
  };
  for (let cycle = 0; cycle < 2; cycle++) {
    await sample('.floe-segmented-control__pill', 'left', () => page.getByRole('radio', { name: 'Time', exact: true }).click());
    await sample('.floe-segmented-control__pill', 'left', () => page.getByRole('radio', { name: 'Directory', exact: true }).click());
    await sample('.flower-directory-end', 'top', () => page.locator('.flower-directory-toggle').first().click());
    await sample('.flower-directory-end', 'top', () => page.locator('.flower-directory-toggle').first().click());
  }
  assert.equal(await page.locator('.flower-directory-drag-handle').count(), 0);
  assert.equal(await page.evaluate(() => window.flowerSidebar.pinState().listStarted), before, 'Motion does not fetch summaries');
  await page.locator('.flower-thread-list').screenshot({ path: path.join(output, 'motion-sidebar.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.flower-directory-toggle').first().click();
  await page.getByRole('radio', { name: 'Time', exact: true }).click();
  const reducedAnimations = await page.evaluate(() => document.querySelector('.flower-thread-list').getAnimations({ subtree: true }).filter(animation => animation.id).map(animation => animation.id));
  assert.deepEqual(reducedAnimations, []);
  await session.writeEvidence(path.join(output, 'motion.json'), JSON.stringify({ version, results, compactPresentation, reducedAnimations }, null, 2));
  console.log(JSON.stringify({ output, cases: results.length, travelFrames: results.map(result => result.travelFrames) }));
}
