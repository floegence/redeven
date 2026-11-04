import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopTestSession } from './desktop_test_session.mjs';

const root = process.cwd();
const argument = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const fixtureArgument = argument('fixture'), outputArgument = argument('output');
assert.ok(fixtureArgument && outputArgument, 'Provide --fixture and --output. The backend must use an isolated consistent copy.');
const fixture = path.resolve(fixtureArgument), output = path.resolve(outputArgument);
const maximumInteractiveMs = argument('max-interactive-ms');
const historyScrollSteps = Number(argument('history-scroll-steps') ?? 0);
const stabilitySeconds = Number(argument('stability-seconds') ?? 0);
assert.ok(stabilitySeconds === 0 || Number.isInteger(stabilitySeconds) && stabilitySeconds >= 1800 && stabilitySeconds <= 3600,
  'Explicit stability qualification runs for 1800–3600 seconds.');
const visualFrames = process.argv.includes('--visual-frames');
assert.ok(!visualFrames || !process.argv.includes('--profile') && !process.argv.includes('--trace') && maximumInteractiveMs === undefined,
  'Visual frame capture runs separately from performance qualification.');
assert.ok(Number.isInteger(historyScrollSteps) && historyScrollSteps >= 0 && historyScrollSteps <= 500, 'Use 0–500 --history-scroll-steps.');
if (maximumInteractiveMs !== undefined) assert.ok(Number.isFinite(Number(maximumInteractiveMs)) && Number(maximumInteractiveMs) > 0, 'Provide a positive --max-interactive-ms.');
const info = JSON.parse(await readFile(fixture, 'utf8'));
const require = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
const desktop = createRequire(path.join(root, 'desktop/package.json'));
const { _electron: electron } = require('playwright');
const evidence = { fixture: info, measurementMode: visualFrames ? 'visual' : 'timing', requests: [], errors: [], opening: undefined, stability: [] };
await mkdir(path.dirname(output), { recursive: true });
const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 + historyScrollSteps * 1600 + stabilitySeconds * 1000 });
try {
  await session.run(async () => {
    const application = await session.launchElectron(electron, {
      executablePath: desktop('electron'),
      args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs'), '--redeven-smoke-run=thread-open'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: output + '.profile', FLOWER_PERF_URL: info.url + '/?cpu=1&thread=' },
    });
    const page = await application.firstWindow();
    if (stabilitySeconds > 0 || visualFrames) {
      const window = await application.browserWindow(page);
      await window.evaluate(native => native.setIgnoreMouseEvents(true));
    }
    const filmstrip = visualFrames ? await page.context().newCDPSession(page) : undefined;
    let filmstripStopped = false;
    const paints = [];
    const writes = new Set();
    if (filmstrip) {
      await mkdir(output + '.frames', { recursive: true });
      filmstrip.on('Page.screencastFrame', frame => {
        const index = paints.length;
        paints.push({ index, metadata: frame.metadata });
        const write = writeFile(path.join(output + '.frames', String(index).padStart(6, '0') + '.jpg'), Buffer.from(frame.data, 'base64'))
          .catch(error => { evidence.errors.push({ visualFrame: index, error: String(error) }); })
          .finally(async () => {
            await filmstrip.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
            writes.delete(write);
          });
        writes.add(write);
      });
      await filmstrip.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
    }
    const pending = [];
    const ordinals = new Map();
    const activityFields = [];
    const activityValues = [];
    const activityOwners = new Map();
    try {
    page.on('pageerror', error => evidence.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
    page.on('response', response => {
      const request = response.request(), url = new URL(response.url());
      if (url.pathname !== '/fixture') return;
      pending.push((async () => {
        const bytes = await response.body();
        const body = response.ok() && url.searchParams.get('op') === 'history' ? JSON.parse(bytes.toString()) : undefined;
        if (response.ok() && url.searchParams.get('op') === 'activity_field') activityFields.push(JSON.parse(bytes.toString()));
        if (response.ok() && url.searchParams.get('op') === 'activity_value') activityValues.push(JSON.parse(bytes.toString()));
        for (const item of body?.current?.items ?? []) {
          ordinals.set(item.id, item.ordinal);
          if (item.activity) for (const id of [item.id, item.activity.tool_id, item.activity.item_id].filter(Boolean)) activityOwners.set(id, item.id);
        }
        evidence.requests.push({ op: url.searchParams.get('op'), status: response.status(), bytes: bytes.length,
          input: request.postData(), timing: request.timing(), window: body?.window ?? body?.current?.window });
        if (!response.ok()) evidence.errors.push({ op: url.searchParams.get('op'), status: response.status(), error: bytes.toString() });
      })().catch(error => {
        const op = url.searchParams.get('op'), failure = request.failure();
        // Visibility/navigation legitimately aborts a bounded body read after
        // headers. CDP cannot retrieve that body; retain cancellation evidence.
        if (failure?.errorText === 'net::ERR_ABORTED' && op === 'history_body') {
          (evidence.cancelledReads ??= []).push({ op, timing: request.timing() });
        } else evidence.errors.push({ error: String(error), op, failure, timing: request.timing() });
      }));
    });
    const target = page.locator('[data-thread-id=' + JSON.stringify(info.thread) + '] .flower-thread-card-select-button');
    await target.scrollIntoViewIfNeeded();
    const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : undefined;
    if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
    const tracer = process.argv.includes('--trace') ? await page.context().newCDPSession(page) : undefined;
    if (tracer) await tracer.send('Tracing.start', { categories: 'devtools.timeline,blink,cc,toplevel,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
    await page.evaluate(id => {
      window.threadOpenEvidence = { frames: [], clickedAt: undefined, interactiveAt: undefined, longTasks: [] };
      new PerformanceObserver(list => window.threadOpenEvidence.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))))
        .observe({ type: 'longtask', buffered: false });
      const click = event => {
        if (event.target.closest('[data-thread-id]')?.getAttribute('data-thread-id') !== id) return;
        document.removeEventListener('click', click, true);
        const evidence = window.threadOpenEvidence;
        evidence.clickedAt = performance.now(); evidence.trusted = event.isTrusted;
        let candidate;
        let stableFrames = 0;
        const check = () => {
          const main = document.querySelector('main[data-flower-selected-thread-id]');
          const selected = main?.getAttribute('data-flower-selected-thread-id') === id;
          const editor = main?.querySelector('.flower-composer textarea');
          const loading = main?.getAttribute('data-flower-selected-thread-loading');
          const messages = selected ? main.querySelectorAll('[data-flower-message-id]').length : 0;
          const failed = Boolean(main?.querySelector('.flower-thread-load-error,.flower-thread-sync-error'));
          const viewport = main?.querySelector('.flower-chat-transcript');
          const bounds = viewport?.getBoundingClientRect();
          const visible = node => {
            const box = node.getBoundingClientRect();
            return bounds && box.width > 0 && box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom
              && node.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
          };
          const pending = main ? [...main.querySelectorAll('.flower-history-body-control,.flower-history-text-loading,[data-flower-history-gap],[data-parent-event-gap]')].filter(visible).length : 0;
          const content = main ? [...main.querySelectorAll('[data-flower-message-id],[data-parent-event]')].filter(visible) : [];
          const last = content.at(-1);
          const y = last?.getBoundingClientRect().top;
          const preparing = viewport?.getAttribute('data-flower-tail-preparing') === 'true' || Boolean(viewport?.querySelector('.flower-transcript-stack[inert]'));
          const ready = Boolean(selected && loading === 'false' && content.length && editor && !editor.disabled && !editor.readOnly && !failed && !pending && !preparing);
          if (ready && candidate?.node === last && Math.abs(candidate.y - y) <= 1) stableFrames++;
          else { candidate = ready ? { node: last, y } : undefined; stableFrames = ready ? 1 : 0; }
          evidence.frames.push({ at: performance.now(), selected, loading, messages, visible: content.length, pending, failed, preparing, stableFrames,
            lastID: last?.getAttribute('data-flower-message-id') ?? last?.getAttribute('data-parent-event'), y, visibility: document.visibilityState,
            scrollTop: viewport?.scrollTop, scrollHeight: viewport?.scrollHeight });
          if (ready && stableFrames >= 3) {
            evidence.readyAt = performance.now();
            editor.focus(); evidence.focused = document.activeElement === editor; evidence.interactiveAt = performance.now();
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      };
      document.addEventListener('click', click, true);
    }, info.thread);
    await target.click();
    await page.waitForFunction(() => window.threadOpenEvidence.interactiveAt !== undefined, undefined, { timeout: 60000 });
    evidence.opening = await page.evaluate(() => {
      const value = window.threadOpenEvidence;
      return { ...value, interactiveMs: value.interactiveAt - value.clickedAt, readyMs: value.readyAt - value.clickedAt };
    });
    if (profiler) await writeFile(output + '.cpuprofile', JSON.stringify((await profiler.send('Profiler.stop')).profile));
    if (tracer) {
      const completed = new Promise(resolve => tracer.once('Tracing.tracingComplete', resolve));
      await tracer.send('Tracing.end');
      const { stream } = await completed;
      const chunks = [];
      for (;;) {
        const chunk = await tracer.send('IO.read', { handle: stream });
        chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data);
        if (chunk.eof) break;
      }
      await tracer.send('IO.close', { handle: stream });
      await writeFile(output + '.trace.json', chunks.join(''));
    }
    // Observe immediately after the readiness mark. A delayed replacement or
    // hydration flash must not disappear into an unmeasured settling pause.
    evidence.stability = await page.evaluate(async () => {
      const viewport = document.querySelector('.flower-chat-transcript');
      const retained = [...document.querySelectorAll('[data-flower-message-id]')].at(-1);
      if (!viewport || !retained) throw new Error('Missing transcript.');
      const id = retained.getAttribute('data-flower-message-id'), y = retained.getBoundingClientRect().top;
      const frames = [];
      for (let index = 0; index < 90; index++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        frames.push({ sameNode: document.querySelector('[data-flower-message-id=' + JSON.stringify(id) + ']') === retained,
          displacement: Math.abs(retained.getBoundingClientRect().top - y),
          failed: Boolean(document.querySelector('.flower-thread-load-error,.flower-thread-sync-error')),
          loading: document.querySelector('main[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-loading') !== 'false' });
      }
      return frames;
    });
    const editor = page.locator('.flower-composer textarea');
    await editor.click();
    assert.equal(await editor.evaluate(node => node === document.activeElement), true);
    await editor.pressSequentially('Qualification draft');
    assert.equal(await editor.inputValue(), 'Qualification draft');
    await editor.fill('');
    if (process.argv.includes('--interactions')) {
      const viewport = page.locator('.flower-chat-transcript');
      const failures = '.flower-thread-load-error,.flower-thread-sync-error,.flower-history-navigation[role="alert"],.flower-history-body-control[aria-busy="false"]';
      const checkReady = async () => {
        await page.waitForFunction(() => {
          const viewport = document.querySelector('.flower-chat-transcript');
          const bounds = viewport?.getBoundingClientRect();
          return bounds && ![...viewport.querySelectorAll('.flower-history-body-control,.flower-history-text-loading,[data-flower-history-gap],[data-parent-event-gap]')].some(node => {
            const box = node.getBoundingClientRect();
            return box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom;
          });
        }, undefined, { timeout: 60000 });
        assert.equal(await page.locator(failures).count(), 0);
        assert.equal(await viewport.getByRole('button', { name: /^(Load (earlier|newer)|Earlier messages|Newer messages)$/i }).count(), 0);
      };
      evidence.interactions = [];
      await page.screenshot({ path: output + '.opened.png' });
      for (let step = 0; step < 4; step++) {
        await viewport.hover();
        await page.mouse.wheel(0, -550);
        await page.waitForTimeout(350);
        await checkReady();
        evidence.interactions.push({ action: 'scroll-earlier', step });
      }
      // Completed work is intentionally collapsed. Exercise the actual nesting
      // before requiring a tool body, rather than silently skipping this check.
      let selectedTurn;
      const visibleProcesses = await viewport.locator('.flower-turn-summary-button').evaluateAll(nodes => nodes.filter(node => {
        const bounds = node.closest('.flower-chat-transcript')?.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return bounds && box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom
          && node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
      }).map(node => node.getAttribute('aria-controls')).filter(Boolean));
      assert.ok(visibleProcesses.length, 'Historical reading must expose a visible work-process control.');
      for (const controls of visibleProcesses.reverse()) {
        const process = viewport.locator('.flower-turn-summary-button[aria-controls=' + JSON.stringify(controls) + ']');
        if (await process.getAttribute('aria-expanded') === 'false') await process.click();
        const turnID = await process.evaluate(node => node.closest('[data-flower-turn-id]')?.getAttribute('data-flower-turn-id'));
        const turn = page.locator('[data-flower-turn-id=' + JSON.stringify(turnID) + ']');
        for (const sequence of await turn.locator('.flower-tool-sequence-toggle').all()) {
          if (await sequence.getAttribute('aria-expanded') === 'false') await sequence.click();
        }
        if (await turn.locator('[data-flower-activity-item-id][data-flower-activity-status="success"] button[data-flower-disclosure-trigger]').count()) { selectedTurn = turn; break; }
      }
      assert.ok(selectedTurn, 'The opened process must contain inspectable tools.');
      const disclosures = await selectedTurn.locator('[data-flower-activity-item-id][data-flower-activity-status="success"]:has(button[data-flower-disclosure-trigger])').all();
      assert.ok(disclosures.length, 'Tool expansion is mandatory for interaction qualification.');
      let verifiedDetail = false;
      const toolIDs = await Promise.all(disclosures.slice(-12).reverse().map(row => row.getAttribute('data-flower-activity-item-id')));
      for (const disclosure of toolIDs) {
        const row = page.locator('[data-flower-activity-item-id=' + JSON.stringify(disclosure) + ']');
        const button = row.locator('button[data-flower-disclosure-trigger]').first();
        if (await button.getAttribute('aria-expanded') === 'false') await button.click();
        await row.locator('.flower-activity-inline-details').waitFor({ state: 'visible' });
        await checkReady();
        await page.waitForTimeout(350);
        await Promise.all(pending);
        const rendered = await row.locator('[data-field-path]').evaluateAll(nodes => nodes.flatMap(node => [...node.querySelectorAll('[data-field-offset]')].map(chunk => ({
          path: node.getAttribute('data-field-path'), offset: Number(chunk.getAttribute('data-field-offset')), text: chunk.textContent,
        }))));
        const matching = rendered.filter(chunk => chunk.text?.trim() && activityFields.some(field => field.path === chunk.path
          && field.offset_bytes === chunk.offset && field.text === chunk.text));
        const detailText = await row.locator('.flower-activity-inline-details').textContent();
        const messageID = activityOwners.get(disclosure);
        assert.ok(messageID, 'Moved tool rows must retain their canonical activity owner.');
        const normalize = text => text.replace(/\s+/gu, '');
        for (const value of activityValues.filter(value => value.item_id === messageID)) {
          for (const key of ['command', 'output']) {
            const text = value.value?.[key];
            if (typeof text === 'string' && text.trim().length > 0 && normalize(detailText).includes(normalize(text)))
              matching.push({ path: value.path + '/' + key, offset: 0, text });
          }
        }
        if (!matching.length) { await button.click(); continue; }
        verifiedDetail = true;
        const commandToggle = row.locator('.flower-activity-terminal-action-button[aria-expanded]');
        if (await commandToggle.count()) {
          if (await commandToggle.getAttribute('aria-expanded') === 'false') await commandToggle.click();
          assert.equal(await commandToggle.getAttribute('aria-expanded'), 'true');
          const command = row.locator('.flower-activity-terminal-command-expanded');
          await command.waitFor({ state: 'visible' });
          const fullCommand = await command.textContent();
          assert.ok(matching.some(field => field.path.endsWith('/command') && normalize(fullCommand) === normalize(field.text)), 'Expanded command must show exact authorized text.');
        }
        assert.equal(await row.locator('.flower-activity-empty-detail,.flower-history-body-control[aria-busy="false"]').count(), 0);
        const before = await row.locator('.flower-activity-inline-details').textContent();
        const memberCount = await page.locator('.flower-activity-inline-row').count();
        await button.evaluate(node => { window.qualifiedToolButton = node; });
        const box = await viewport.boundingBox();
        await page.mouse.move(box.x + 16, box.y + box.height / 2);
        for (const delta of [-500, 500, -500, 500]) { await page.mouse.wheel(0, delta); await page.waitForTimeout(250); }
        assert.equal(await button.evaluate(node => node === window.qualifiedToolButton), true);
        assert.equal(await button.getAttribute('aria-expanded'), 'true');
        if (await commandToggle.count()) assert.equal(await commandToggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('.flower-activity-inline-row').count(), memberCount);
        assert.equal(await row.locator('.flower-activity-inline-details').textContent(), before);
        await button.scrollIntoViewIfNeeded();
        await page.screenshot({ path: output + '.detail.png' });
        await button.click();
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        await button.click();
        await page.waitForTimeout(300);
        assert.equal(await row.locator('.flower-activity-inline-details').textContent(), before);
        evidence.interactions.push({ action: 'verify-tool-detail', item: disclosure, matchedFields: matching.map(({ path, offset, text }) => ({ path, offset, characters: text.length })), memberCount, retainedAcrossScroll: true });
        await button.click();
        break;
      }
      assert.ok(verifiedDetail, 'At least one expanded tool must render exact authorized field content.');
      // Restore collapsed work before testing whole-history navigation.
      const openSequences = page.locator('.flower-tool-sequence-toggle[aria-expanded="true"]');
      while (await openSequences.count()) await openSequences.last().click();
      const openProcesses = page.locator('.flower-turn-summary-button[aria-expanded="true"]');
      while (await openProcesses.count()) await openProcesses.last().click();
      for (let step = 0; step < 4; step++) {
        await viewport.hover();
        await page.mouse.wheel(0, 550);
        await page.waitForTimeout(350);
        await checkReady();
      }
      await page.screenshot({ path: output + '.returned.png' });
    }
    if (historyScrollSteps > 0) {
      assert.equal(info.boundary, 'product-http', 'Deep scrolling must cross the production HTTP boundary.');
      const viewport = page.locator('.flower-chat-transcript');
      evidence.historyScroll = [];
      const responses = evidence.requests.length;
      evidence.historyIdle = [];
      const historyCount = () => evidence.requests.filter(read => read.op === 'history').length;
      const verifyIdle = async direction => {
        // Wait for user-requested pagination, then prove that layout and
        // incomplete group counts cannot trigger additional history reads.
        await page.waitForFunction(() => !document.querySelector('.flower-history-loading-notice'), undefined, { timeout: 30000 });
        await Promise.all(pending);
        const before = historyCount();
        await page.waitForTimeout(1500);
        const after = historyCount();
        evidence.historyIdle.push({ direction, before, after });
        assert.equal(after, before, 'History requests must stop after scrolling settles.');
      };
      for (const direction of [-1, 1]) {
        const start = evidence.historyScroll.length;
        for (let step = 0; step < historyScrollSteps; step++) {
          const box = await viewport.boundingBox();
          assert.ok(box, 'The transcript must remain mounted.');
          // Use the transcript gutter so an informational tooltip cannot hold
          // Playwright's hit-test while the native wheel gesture is pending.
          await page.mouse.move(box.x + 16, box.y + box.height / 2);
          await page.mouse.wheel(0, direction * 900);
          await page.waitForTimeout(700);
          if (await viewport.locator('.flower-history-navigation[role="alert"],.flower-history-body-control[aria-busy="false"]').count()) {
            await Promise.all(pending);
            await page.screenshot({ path: output + '.failure.png' });
            evidence.errors.push({ historyAlert: await viewport.locator('.flower-history-navigation[role="alert"],.flower-history-body-control[aria-busy="false"]').allTextContents() });
          }
          assert.equal(await viewport.locator('.flower-history-navigation[role="alert"],.flower-history-body-control[aria-busy="false"]').count(), 0, 'Historical reading failed.');
          assert.equal(await page.locator('.flower-thread-load-error,.flower-thread-sync-error').count(), 0);
          const state = await viewport.evaluate(element => ({
            top: element.scrollTop, height: element.scrollHeight,
            first: element.querySelector('[data-flower-message-id]')?.getAttribute('data-flower-message-id'),
            visible: [...element.querySelectorAll('[data-flower-message-id]')].filter(node => {
              const box = node.getBoundingClientRect(), bounds = element.getBoundingClientRect();
              return box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom;
            }).map(node => node.getAttribute('data-flower-message-id')),
          }));
          evidence.historyScroll.push({ ...state, direction, ordinal: state.visible.map(id => ordinals.get(id)).find(Number.isSafeInteger),
            visibleOrdinals: state.visible.map(id => ordinals.get(id)) });
          if (step % 10 === 9) await verifyIdle(direction);
        }
        await verifyIdle(direction);
        const travel = evidence.historyScroll.slice(start).map(step => step.ordinal).filter(Number.isSafeInteger);
        assert.ok(travel.length === historyScrollSteps, 'Every reading position must retain canonical identity.');
        if (historyScrollSteps >= 20) {
          assert.ok(new Set(travel).size >= 8, 'Scrolling must advance beyond a few alternating windows.');
          assert.ok(direction < 0 ? travel.at(-1) < travel[0] : travel.at(-1) > travel[0], 'Reading must advance in the requested direction.');
        }
      }
      await Promise.all(pending);
      const reads = evidence.requests.slice(responses).filter(read => read.op === 'history');
      const selections = reads.filter(read => read.status === 200).map(read => ({
        bytes: Buffer.byteLength(read.input ?? ''), items: JSON.parse(read.input ?? '{}').item_ids?.length ?? 0,
      })).filter(read => read.items > 0);
      evidence.historySelections = selections;
      // The same complete window can be below 8 KiB with short canonical IDs.
      // Require the real 150-item reading window here; the product HTTP test
      // TestServerFlowerHistoryAcceptsCompleteReadingSelection independently
      // exercises long released-writer identities above the 8 KiB boundary.
      assert.ok(selections.some(read => read.items === 150), 'Exercise a complete 150-item reading selection.');
      assert.ok(new Set(evidence.historyScroll.map(step => step.ordinal)).size > 2, 'Historical windows must advance.');
      await page.screenshot({ path: output + '.history.png' });
    }
    if (filmstrip) {
      await filmstrip.send('Page.stopScreencast');
      await Promise.all(writes);
      await filmstrip.detach();
      filmstripStopped = true;
      evidence.visualFrames = paints;
      assert.ok(paints.length >= 30, 'Retain actual visual frames across history navigation.');
    }
    if (stabilitySeconds > 0) {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('HeapProfiler.collectGarbage');
        const before = await cdp.send('Memory.getDOMCounters');
        const heapBefore = await cdp.send('Runtime.getHeapUsage');
        evidence.longStability = await page.evaluate(async seconds => {
          const viewport = document.querySelector('.flower-chat-transcript');
          if (!viewport) throw new Error('Missing stability viewport.');
          const bounds = viewport.getBoundingClientRect();
          const anchor = [...viewport.querySelectorAll('[data-flower-message-id] p,[data-flower-message-id] tbody tr,[data-flower-message-id] pre')]
            .find(node => { const box = node.getBoundingClientRect(); return box.height > 0 && box.top >= bounds.top && box.bottom <= bounds.bottom && node.checkVisibility(); });
          if (!anchor) throw new Error('Missing visible reading anchor.');
          const started = performance.now(), top = anchor.getBoundingClientRect().top;
          let frames = 0, maximumDrift = 0;
          await new Promise((resolve, reject) => {
            const sample = () => {
              frames++;
              maximumDrift = Math.max(maximumDrift, Math.abs(anchor.getBoundingClientRect().top - top));
              if (!anchor.isConnected || !anchor.checkVisibility() || maximumDrift > 1
                || viewport.querySelector('.flower-history-text-loading') || document.querySelector('.flower-thread-load-error,.flower-thread-sync-error')) {
                reject(new Error('Reading continuity failed during stability qualification.')); return;
              }
              if (performance.now() - started >= seconds * 1000) resolve();
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          return { seconds: (performance.now() - started) / 1000, frames, maximumDrift };
        }, stabilitySeconds);
        await cdp.send('HeapProfiler.collectGarbage');
        const after = await cdp.send('Memory.getDOMCounters');
        const heapAfter = await cdp.send('Runtime.getHeapUsage');
        Object.assign(evidence.longStability, { before, after, heapBefore, heapAfter });
        assert.ok(after.documents <= before.documents && after.nodes <= before.nodes + 128 && after.jsEventListeners <= before.jsEventListeners + 16,
          'Settled reading must not accumulate documents, nodes or listeners.');
        assert.ok(heapAfter.usedSize <= heapBefore.usedSize * 1.1 + 16 * 1024 * 1024, 'Settled reading heap must remain bounded after collection.');
      } finally { await cdp.detach(); }
    }
    await Promise.all(pending);
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    assert.equal(evidence.errors.length, 0, JSON.stringify(evidence.errors));
    assert.ok(evidence.opening.trusted && evidence.opening.focused);
    assert.ok(evidence.stability.every(frame => frame.sameNode && frame.displacement <= 1 && !frame.failed && !frame.loading));
    console.log(JSON.stringify({ interactiveMs: evidence.opening.interactiveMs, readyMs: evidence.opening.readyMs,
      requests: evidence.requests.map(({ op, bytes, status, timing }) => ({ op, bytes, status, timing })), errors: evidence.errors }));
    if (maximumInteractiveMs !== undefined) {
      assert.ok(evidence.opening.interactiveMs < Number(maximumInteractiveMs), 'Click-to-interactive exceeds the requested limit.');
    }
    } catch (error) {
      evidence.failure = String(error);
      throw error;
    } finally {
      if (filmstrip && !filmstripStopped) {
        await filmstrip.send('Page.stopScreencast').catch(() => {});
        await Promise.all(writes);
        evidence.visualFrames = paints;
        await filmstrip.detach().catch(() => {});
      }
      await Promise.all(pending);
      await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    }
  });
} finally {
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
