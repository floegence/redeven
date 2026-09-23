/* global window, document */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const execute = promisify(execFile);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Opt-in local product qualification, driven by the existing authenticated
// projection fixture. No production diagnostics or retained website content.
export async function runBrowserProjectionSoak({ popup, sourcePages, sourceOrigin, runtimePID, seconds, evidence }) {
  assert.ok(Number.isInteger(seconds) && seconds >= 60 && seconds <= 3600);
  assert.ok(evidence, 'A soak run must retain its measurements');
  assert.equal(typeof globalThis.gc, 'function', 'Measure retained fixture heap with Node --expose-gc');
  // Playwright 1.63 intentionally retains 10,000 old protocol objects per kind.
  // Its own test hook bounds only this driver's historical handles; production
  // helpers, browser heaps and the existing acceptance budgets are unchanged.
  const { server } = createRequire(import.meta.resolve('playwright'))('playwright-core/lib/coreBundle');
  server.setMaxDispatchersForTest(256);
  const sourceMetrics = await sourcePages[0].context().newCDPSession(sourcePages[0]);
  const viewerMetrics = await popup.context().newCDPSession(popup);
  await sourceMetrics.send('Performance.enable'); await viewerMetrics.send('Performance.enable');
  const started = Date.now(), samples = [], latencies = [];
  let iterations = 0, navigations = 0, nextSample = started;
  const until = async (predicate, argument) => {
    const handle = await popup.waitForFunction(predicate, argument);
    await handle.dispose();
  };
  const heap = async session => (await session.send('Performance.getMetrics')).metrics.find(value => value.name === 'JSHeapUsedSize').value;
  const memory = async () => {
    const fixtureAllocatedHeap = process.memoryUsage().heapUsed;
    // Browser automation retains transient protocol objects until a major GC.
    // Compare retained memory without loosening the existing growth budget.
    await globalThis.gc({ type: 'major', execution: 'async' });
    const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=']);
    const processes = stdout.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number));
    const owned = new Set([process.pid, runtimePID]);
    for (;;) {
      const prior = owned.size;
      for (const [pid, parent] of processes) if (owned.has(parent)) owned.add(pid);
      if (prior === owned.size) break;
    }
    const fixtureProtocolObjects = {};
    for (const object of popup._connection._objects.values()) fixtureProtocolObjects[object._type] = (fixtureProtocolObjects[object._type] ?? 0) + 1;
    return { rss: processes.filter(([pid]) => owned.has(pid)).reduce((total, [, , rss]) => total + rss * 1024, 0), processes: processes.filter(([pid]) => owned.has(pid)).length,
      sourceHeap: await heap(sourceMetrics), viewerHeap: await heap(viewerMetrics), fixtureAllocatedHeap, fixtureHeap: process.memoryUsage().heapUsed, fixtureProtocolObjects };
  };
  const report = { mode: 'Product browser measurement', qualificationManifest: process.env.REDEVEN_BROWSER_RUN_MANIFEST ?? null, seconds, network: 'loopback, unthrottled', started: new Date(started).toISOString(), runtimePID, fixturePID: process.pid, samples, iterations, navigations, inputP95: 0 };
  const save = async () => {
    report.iterations = iterations; report.navigations = navigations;
    report.inputP95 = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * .95)] ?? 0;
    await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
  };
  try {
    while (Date.now() - started < seconds * 1000) {
      const index = iterations % sourcePages.length, source = sourcePages[index];
      await popup.getByRole('tab').nth(index).click();
      await until(url => {
        const address = document.querySelector('[role=combobox]');
        return address && !address.readOnly && address.value === url && !document.querySelector('.floe-viewport')?.parentElement?.classList.contains('switching');
      }, source.url());
      const replay = popup.frameLocator('.floe-viewport iframe');
      const counter = replay.locator('#counter');
      await counter.waitFor({ state: 'visible' });
      const count = await source.evaluate(() => window.count), next = count + 1;
      await counter.getByText(`Count ${count}`, { exact: true }).waitFor();
      const point = await counter.boundingBox(); assert.ok(point);
      const before = performance.now();
      await popup.mouse.click(point.x + point.width / 2, point.y + point.height / 2);
      await counter.getByText(`Count ${next}`, { exact: true }).waitFor();
      latencies.push(performance.now() - before);
      assert.equal(await source.evaluate(() => window.count), next, 'Each input executes once on the selected native source');
      if (iterations % 5 === 0) {
        const url = `${sourceOrigin}/${index ? 'popup-' : ''}soak-${iterations}`;
        const address = popup.getByRole('combobox', { name: 'Website address' });
        await address.fill(url); await address.press('Enter');
        await source.waitForURL(url);
        await counter.getByText('Count 0', { exact: true }).waitFor();
        navigations++;
      }
      await until(() => {
        const video = document.querySelector('.floe-viewport iframe')?.contentDocument?.querySelector('#clip');
        return video && video.videoWidth > 0 && video.readyState >= 2;
      });
      iterations++;
      if (Date.now() >= nextSample) {
        const sample = { elapsed: (Date.now() - started) / 1000, ...await memory() }; samples.push(sample);
        await save(); console.error('Browser soak sample', JSON.stringify({ ...sample, iterations, navigations }));
        nextSample = Date.now() + 60000;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    samples.push({ elapsed: (Date.now() - started) / 1000, ...await memory() });
    if (seconds >= 1800) {
      const baseline = samples.filter(value => value.elapsed >= 300 && value.elapsed < 600);
      const final = samples.filter(value => value.elapsed > seconds - 300);
      assert.ok(baseline.length >= 4 && final.length >= 4);
      for (const key of ['sourceHeap', 'viewerHeap', 'fixtureHeap', 'rss']) {
        const first = median(baseline.map(value => value[key])), last = median(final.map(value => value[key]));
        assert.ok(last - first <= Math.max(key === 'rss' ? 128 * 1024 * 1024 : 32 * 1024 * 1024, first * .2), `${key} grows beyond the steady-state budget: ${first} -> ${last}`);
      }
      assert.ok(median(final.map(value => value.processes)) <= median(baseline.map(value => value.processes)) + 2, 'Navigation must not leak native helper/browser processes');
    }
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed'; report.error = error.message;
    throw error;
  }
  finally { server.setMaxDispatchersForTest(undefined); await save(); await sourceMetrics.detach(); await viewerMetrics.detach(); }
}
