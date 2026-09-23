/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const p95 = values => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * .95))];

// Measures actual projected input and presentation over the fixture's shaped
// encrypted socket. Run without other qualification workloads for comparable data.
export async function runBrowserProjectionPerformance({ popup, sourcePages, evidence }) {
  assert.equal(process.env.REDEVEN_BROWSER_NETWORK, '80ms-10mbps');
  assert.ok(evidence, 'Performance qualification must retain measurements');
  const report = { mode: 'Product browser measurement', qualificationManifest: process.env.REDEVEN_BROWSER_RUN_MANIFEST ?? null, network: { rtt_ms: 80, bits_per_second_each_direction: 10000000 }, started: new Date().toISOString(), baseline: [], loaded: [], tabFeedback: [], cachedDisplay: [] };
  const until = async (predicate, argument) => {
    const handle = await popup.waitForFunction(predicate, argument);
    await handle.dispose();
  };
  const select = async index => {
    await popup.getByRole('tab').nth(index).click();
    await until(url => document.querySelector('[role=combobox]')?.value === url && !document.querySelector('[role=combobox]')?.readOnly && !document.querySelector('.floe-viewport')?.parentElement.classList.contains('switching'), sourcePages[index].url());
  };
  const sample = async result => {
    const source = sourcePages[0];
    for (let index = 0; index < 45; index++) {
      const next = await source.evaluate(() => window.count + 1);
      const counter = popup.frameLocator('.floe-viewport iframe').locator('#counter');
      const box = await counter.boundingBox(); assert.ok(box);
      await popup.evaluate(expected => {
        const result = window.fixtureInputTiming = { expected, start: 0, elapsed: 0 };
        document.addEventListener('pointerdown', () => {
          result.start = performance.now();
          const observe = () => {
            const counter = document.querySelector('.floe-viewport iframe')?.contentDocument?.querySelector('#counter');
            if (counter?.textContent === `Count ${expected}`) result.elapsed = performance.now() - result.start;
            else requestAnimationFrame(observe);
          };
          requestAnimationFrame(observe);
        }, { capture: true, once: true });
      }, next);
      await popup.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await until(() => window.fixtureInputTiming.elapsed > 0);
      const elapsed = await popup.evaluate(() => window.fixtureInputTiming.elapsed);
      assert.equal(await source.evaluate(() => window.count), next, 'Input executes exactly once');
      if (index >= 5) result.push(elapsed);
    }
  };
  try {
    for (const source of sourcePages) await source.evaluate(() => {
      window.fixtureMediaNodes = [...document.querySelectorAll('video,canvas')];
      for (const node of window.fixtureMediaNodes) node.remove();
    });
    await select(0);
    await until(() => !document.querySelector('.floe-viewport iframe')?.contentDocument?.querySelector('video,canvas'));
    await sample(report.baseline);
    await sourcePages[0].evaluate(async () => {
      for (const node of window.fixtureMediaNodes) document.body.append(node);
      const scene = document.querySelector('#scene'), video = document.querySelector('#clip');
      scene.width = 640; scene.height = 360;
      scene.style.width = '320px'; scene.style.height = '180px';
      const context = scene.getContext('2d'), pixels = context.createImageData(scene.width, scene.height);
      let seed = 0x13579;
      window.fixtureNoise = setInterval(() => {
        for (let index = 0; index < pixels.data.length; index += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          pixels.data[index] = seed & 255; pixels.data[index + 1] = seed >>> 8 & 255; pixels.data[index + 2] = seed >>> 16 & 255; pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
      }, 33);
      video.width = 640; video.height = 360;
      video.style.width = '320px'; video.style.height = '180px';
      await video.play();
    });
    await until(() => {
      const video = document.querySelector('.floe-viewport iframe')?.contentDocument?.querySelector('#clip');
      return video?.videoWidth === 640 && video.readyState >= 2;
    });
    report.loadedMedia = await popup.evaluate(() => {
      const replay = document.querySelector('.floe-viewport iframe')?.contentDocument, video = replay?.querySelector('#clip');
      return { videoWidth: video.videoWidth, canvasWidth: replay?.querySelector('#scene')?.naturalWidth, decodedVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames };
    });
    await sample(report.loaded);
    report.loadedMedia.finalDecodedVideoFrames = await popup.evaluate(() => document.querySelector('.floe-viewport iframe')?.contentDocument?.querySelector('#clip')?.getVideoPlaybackQuality().totalVideoFrames);
    assert.ok(report.loadedMedia.finalDecodedVideoFrames > report.loadedMedia.decodedVideoFrames, 'Video keeps decoding during loaded input measurements');
    await sourcePages[0].evaluate(() => clearInterval(window.fixtureNoise));
    await select(1); await select(0);
    for (let index = 0; index < 30; index++) {
      const selected = (index + 1) % 2;
      const expected = await sourcePages[selected].evaluate(() => window.count);
      await popup.evaluate(({ selected, expected }) => {
        const result = window.fixtureTabTiming = { feedback: 0, display: 0 };
        document.addEventListener('pointerdown', () => {
          const start = performance.now();
          const observe = () => {
            if (!result.feedback && document.querySelectorAll('[role=tab]')[selected]?.getAttribute('aria-selected') === 'true') result.feedback = performance.now() - start;
            const viewport = document.querySelector('.floe-viewport'), frame = viewport?.querySelector('iframe');
            if (result.feedback && frame?.contentDocument?.querySelector('#counter')?.textContent === `Count ${expected}`) result.display = performance.now() - start;
            else requestAnimationFrame(observe);
          };
          requestAnimationFrame(observe);
        }, { capture: true, once: true });
      }, { selected, expected });
      await popup.getByRole('tab').nth(selected).click();
      await until(() => window.fixtureTabTiming.display > 0);
      const timing = await popup.evaluate(() => window.fixtureTabTiming);
      report.tabFeedback.push(timing.feedback); report.cachedDisplay.push(timing.display);
      await until(() => !document.querySelector('[role=combobox]')?.readOnly && !document.querySelector('.floe-viewport')?.parentElement.classList.contains('switching'));
    }
    report.p95 = { baseline: p95(report.baseline), loaded: p95(report.loaded), tabFeedback: p95(report.tabFeedback), cachedDisplay: p95(report.cachedDisplay) };
    assert.ok(report.p95.baseline <= 250, `Input p95 ${report.p95.baseline.toFixed(1)} ms exceeds 250 ms`);
    assert.ok(report.p95.loaded - report.p95.baseline <= 100, `Media adds ${(report.p95.loaded - report.p95.baseline).toFixed(1)} ms to input p95`);
    assert.ok(report.p95.tabFeedback <= 50, `Tab feedback p95 ${report.p95.tabFeedback.toFixed(1)} ms exceeds 50 ms`);
    assert.ok(report.p95.cachedDisplay <= 100, `Cached display p95 ${report.p95.cachedDisplay.toFixed(1)} ms exceeds 100 ms`);
    report.result = 'passed';
  } catch (error) { report.result = 'failed'; report.error = error.message; throw error; }
  finally {
    for (const source of sourcePages) await source.evaluate(() => clearInterval(window.fixtureNoise)).catch(() => {});
    await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
  }
}
