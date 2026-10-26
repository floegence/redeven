import { createDesktopTestSession } from './desktop_test_session.mjs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 1200000,
});
await session.run(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const desktop = path.join(root, 'desktop');
  const envUI = path.join(root, 'internal/envapp/ui_src');
  const desktopRequire = createRequire(path.join(desktop, 'package.json'));
  const uiRequire = createRequire(path.join(envUI, 'package.json'));
  const { chromium, _electron: electron } = uiRequire('playwright');
  const { build } = await import(pathToFileURL(desktopRequire.resolve('vite')));
  const argument = (name, fallback = '') =>
    process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const reference = argument('ref');
  const referenceFiles = reference ? new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', reference, 'internal/flower_ui/src'], { cwd: root, encoding: 'utf8' }).trim().split('\n')) : undefined;
  const host = argument('host', 'both');
  const disclosures = argument('disclosures', 'toggle');
  if (!['toggle', 'closed'].includes(disclosures)) throw new Error('Expected --disclosures=toggle|closed');
  const unopened = disclosures === 'closed';
  const seconds = Number(argument('seconds', '8'));
  if (!['browser', 'desktop', 'both'].includes(host) || !Number.isFinite(seconds) || seconds <= 0)
    throw new Error('Expected --host=browser|desktop|both and positive --seconds');
  const artifacts = path.resolve(argument('output') || (await mkdtemp(path.join(tmpdir(), 'flower-streaming-evidence-'))));
  await mkdir(artifacts, { recursive: true });
  const temporary = await mkdtemp(path.join(tmpdir(), 'flower-streaming-build-'));
  await session.directory(temporary);
  const dist = path.join(temporary, 'dist');
  const evidence = {
    reference:
      reference ||
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    workingTree: !reference,
    disclosures,
    host: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model },
    runs: [],
  };
  let server;
  await build({
    configFile: path.join(desktop, 'vite.welcome.config.mjs'),
    logLevel: 'error',
    plugins: [
      {
        name: 'flower-performance-evidence',
        enforce: 'pre',
        resolveId(source, importer) {
          if (!referenceFiles || !importer || !source.startsWith('.') || !importer.startsWith(path.join(root, 'internal/flower_ui/src/'))) return;
          const requested = path.resolve(path.dirname(importer.split('?')[0]), source);
          for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
            const candidate = requested + suffix;
            if (referenceFiles.has(path.relative(root, candidate))) return candidate;
          }
        },
        load(id) {
          if (!reference || !id.startsWith(path.join(root, 'internal/flower_ui/src/'))) return;
          const relative = path.relative(root, id.split('?')[0]);
          return execFileSync('git', ['show', `${reference}:${relative}`], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
          });
        },
        transform(code, id) {
          if (!id.endsWith('/chat/markdown/FlowerMarkdownBlock.tsx')) return;
          const marker = /const \[copiedButton, setCopiedButton\] = createSignal<HTMLButtonElement \| null>\(null\);/;
          if (!marker.test(code)) throw new Error('Markdown instrumentation boundary changed');
          return code.replace(
            marker,
            (matched) =>
              `for (const [method, count] of [['parser', 'parses'], ['lexer', 'lexes']]) { const original = marked[method].bind(marked); marked[method] = (...args) => { globalThis.__flowerPerfCounts[count] += 1; return original(...args); }; }\n${matched}`,
          );
        },
      },
    ],
    build: {
      outDir: dist,
      minify: !process.argv.includes('--profile'),
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          performance: path.join(root, 'internal/flower_ui/testing/performance/main.tsx'),
        },
        output: { entryFileNames: 'performance.js' },
      },
    },
  });
  const css = (await readdir(path.join(dist, 'assets'))).filter((file) => file.endsWith('.css'));
  await writeFile(
    path.join(dist, 'index.html'),
    `<!doctype html><html><head><meta charset="UTF-8">${css.map((file) => `<link rel="stylesheet" href="/assets/${file}">`).join('')}</head><body><div id="root"></div><script type="module" src="/performance.js"></script></body></html>`,
  );
  server = http.createServer(async (request, response) => {
    const target = path.resolve(
      dist,
      `.${new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname}`,
    );
    if (!target.startsWith(`${dist}/`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(target);
      const type = target.endsWith('.js')
        ? 'text/javascript'
        : target.endsWith('.css')
          ? 'text/css'
          : target.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type }).end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await session.port(server.address().port);
  await session.defer('server connections', () => server.closeAllConnections?.(), { phase: 'release' });
  await session.defer(
    'server',
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())),
      ),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const runtime of host === 'both' ? ['browser', 'desktop'] : [host]) {
    for (const [messages, tools] of [
      [72, 20],
      [500, 100],
    ]) {
      for (const hz of [30, 60]) {
        const name = `${runtime}-${messages}-${tools}-${hz}`;
        let application;
        let browser;
        let context;
        let page;
        let recording;
        try {
          if (runtime === 'desktop') {
            application = await session.launchElectron(electron, {
              executablePath: desktopRequire('electron'),
              args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs'), `--redeven-smoke-run=${name}`],
              env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: undefined,
                FLOWER_PERF_PROFILE: path.join(temporary, name),
                FLOWER_PERF_URL: `${url}/?messages=${messages}&tools=${tools}&disclosures=${disclosures}`,
              },
            });
            page = await application.firstWindow();
            context = application.context();
          } else {
            browser = await session.launchBrowser(chromium, {
              headless: true,
            });

            context = await browser.newContext({
              viewport: { width: 1280, height: 900 },
              recordVideo: {
                dir: path.join(artifacts, name),
                size: { width: 1280, height: 900 },
              },
            });
            page = await context.newPage();
          }
          const pageErrors = [];
          page.on('pageerror', (error) => {
            pageErrors.push(error);
          });
          if (runtime === 'browser') await page.goto(`${url}/?messages=${messages}&tools=${tools}&disclosures=${disclosures}`);
          await page.waitForSelector('[data-flower-queued-turn-dock-id="queued-first"]', { timeout: 30_000 });
          await page.waitForFunction(
            () => document.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true',
          );
          await page.waitForTimeout(300);
          const toggle = unopened ? page.locator('.flower-composer textarea')
            : page.locator('[data-flower-activity-item-id]').last().locator('[data-flower-disclosure-trigger]');
          await toggle.scrollIntoViewIfNeeded();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          // Sample allocations including objects collected during the window;
          // retained heap alone would hide the cost of short-lived append data.
          await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768,
            includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
          if (process.argv.includes('--profile')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
          const before = await cdp.send('Performance.getMetrics');
          let frameIndex = 0;
          if (runtime === 'desktop') {
            await mkdir(path.join(artifacts, name), { recursive: true });
            cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
              await cdp.send('Page.screencastFrameAck', { sessionId });
              await writeFile(path.join(artifacts, name, `${String(frameIndex++).padStart(4, '0')}.jpg`), Buffer.from(data, 'base64'));
            });
            await cdp.send('Page.startScreencast', {
              format: 'jpeg',
              quality: 65,
              maxWidth: 960,
              maxHeight: 675,
              everyNthFrame: 3,
            });
            recording = cdp;
          }
          await page.evaluate((rate) => window.flowerPerformance.start(rate), hz);
          const started = Date.now();
          while (Date.now() - started < seconds * 1000) {
            await toggle.click();
            if (unopened) {
              await page.locator('.flower-chat-transcript').hover();
              await page.mouse.wheel(0, Math.floor((Date.now() - started) / 1200) % 2 ? 360 : -360);
            }
            await page.waitForTimeout(220);
          }
          const result = await page.evaluate(() => window.flowerPerformance.stop());
          if (pageErrors.length) throw new AggregateError(pageErrors, 'Flower renderer failed during measurement');
          const after = await cdp.send('Performance.getMetrics');
          if (process.argv.includes('--profile')) await writeFile(path.join(artifacts, name + '.cpuprofile'), JSON.stringify((await cdp.send('Profiler.stop')).profile));
          const { profile: allocations } = await cdp.send('HeapProfiler.stopSampling');
          const continuity = await page.evaluate(() => window.flowerPerformance.checkContinuity());
          // Run state-mutating output probes on a fresh fixture after timing
          // and continuity checks. Reference and candidate measure identical
          // input; the probe never rewinds already-streamed canonical items.
          let outputProgress = null;
          if (!reference && !unopened) {
            await page.reload();
            await page.waitForSelector('[data-flower-queued-turn-dock-id="queued-first"]');
            await page.waitForFunction(() => document.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
            await page.waitForTimeout(300);
            outputProgress = await page.evaluate(() => window.flowerPerformance.checkOutputProgress());
          }
          const metric = (data, key) => data.metrics.find((value) => value.name === key)?.value ?? 0;
          const run = {
            runtime,
            messages,
            tools,
            hz,
            seconds,
            processID: application?.process().pid,
            url,
            stateDirectory: runtime === 'desktop' ? path.join(temporary, name) : undefined,
            ...result,
            continuity,
            outputProgress,
            rendererCpuMs: 1000 * (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')),
            scriptCpuMs: 1000 * (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')),
            sampledAllocationBytes: allocations.samples.reduce((bytes, sample) => bytes + sample.size, 0),
            retainedHeapDeltaBytes: metric(after, 'JSHeapUsedSize') - metric(before, 'JSHeapUsedSize'),
            layoutMs: 1000 * (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')),
            styleMs: 1000 * (metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')),
            layoutCount: metric(after, 'LayoutCount') - metric(before, 'LayoutCount'),
          };
          evidence.runs.push(run);
          await page.screenshot({
            path: path.join(artifacts, `${name}.png`),
          });
          console.log(
            JSON.stringify({
              runtime,
              messages,
              tools,
              hz,
              frameP95: run.frameP95,
              clickP95: run.clickP95,
              maxLongTask: run.maxLongTask,
              protectedChanges: run.protectedChanges,
              parses: run.parsers.parses,
              layoutMs: run.layoutMs,
              rendererCpuMs: run.rendererCpuMs,
              sampledAllocationBytes: run.sampledAllocationBytes,
              livePayloadBytes: run.livePayloadBytes,
              detailReads: run.detailReads,
              mountedToolDetails: run.mountedToolDetails,
              mountedThinkingBodies: run.mountedThinkingBodies,
              continuity,
            }),
          );
          await session.writeEvidence(path.join(artifacts, 'metrics.json'), JSON.stringify(evidence, null, 2));
        } finally {
          if (recording) await recording.send('Page.stopScreencast').catch(() => undefined);

          if (application) await session.closeElectron(application);
          if (browser) {
            await context?.close();
            await session.closeBrowser(browser);
          }
        }
      }
    }
  }
  evidence.acceptance = evidence.runs.every(
    (run) =>
      (reference || unopened || run.outputProgress?.valid) &&
      (!unopened || run.detailReads === 0 && run.mountedToolDetails === 0 && run.mountedThinkingBodies === 0) &&
      run.continuity.flashes === 0 &&
      run.continuity.stableMessage &&
      run.continuity.stableSelection &&
      run.continuity.draftPreserved &&
      run.continuity.loads === 3 &&
      run.continuity.baselines === 72 &&
      run.protectedChanges === 0 &&
      run.clicks.length > 0 &&
      run.clickP95 <= 100 &&
      (run.messages === 72 ? run.frameP95 <= 20 : run.maxLongTask < 100),
  );
  await session.writeEvidence(path.join(artifacts, 'metrics.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${artifacts}`);
  if (!reference && !evidence.acceptance) throw new Error('Flower streaming performance acceptance failed; inspect metrics.json');
});
