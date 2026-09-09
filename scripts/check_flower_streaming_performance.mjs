import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'desktop');
const envUI = path.join(root, 'internal/envapp/ui_src');
const desktopRequire = createRequire(path.join(desktop, 'package.json'));
const uiRequire = createRequire(path.join(envUI, 'package.json'));
const { chromium, _electron: electron } = uiRequire('playwright');
const { build } = await import(pathToFileURL(desktopRequire.resolve('vite')));
const argument = (name, fallback = '') => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const reference = argument('ref');
const host = argument('host', 'both');
const seconds = Number(argument('seconds', '8'));
if (!['browser', 'desktop', 'both'].includes(host) || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Expected --host=browser|desktop|both and positive --seconds');
const artifacts = path.resolve(argument('output') || await mkdtemp(path.join(tmpdir(), 'flower-streaming-evidence-')));
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'flower-streaming-build-'));
const dist = path.join(temporary, 'dist');
const evidence = { reference: reference || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTree: !reference, host: { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model }, runs: [] };
let server;
try {
  await build({
    configFile: path.join(desktop, 'vite.welcome.config.mjs'),
    logLevel: 'error',
    plugins: [{
      name: 'flower-performance-evidence', enforce: 'pre',
      load(id) {
        if (!reference || !id.startsWith(path.join(root, 'internal/flower_ui/src/'))) return;
        const relative = path.relative(root, id.split('?')[0]);
        return execFileSync('git', ['show', `${reference}:${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      },
      transform(code, id) {
        if (!id.endsWith('/chat/markdown/FlowerMarkdownBlock.tsx')) return;
        const marker = /marked\.use\(\{\s*renderer:\s*createFlowerMarkdownRenderer\(\)\s*\}\);/;
        if (!marker.test(code)) throw new Error('Markdown instrumentation boundary changed');
        return code.replace(marker, (matched) => `${matched}\nfor (const [method, count] of [['parser', 'parses'], ['lexer', 'lexes']]) { const original = marked[method].bind(marked); marked[method] = (...args) => { globalThis.__flowerPerfCounts[count] += 1; return original(...args); }; }`);
      },
    }],
    build: { outDir: dist, emptyOutDir: true, cssCodeSplit: false, rollupOptions: { input: { performance: path.join(root, 'internal/flower_ui/testing/performance/main.tsx') }, output: { entryFileNames: 'performance.js' } } },
  });
  const css = (await readdir(path.join(dist, 'assets'))).filter((file) => file.endsWith('.css'));
  await writeFile(path.join(dist, 'index.html'), `<!doctype html><html><head><meta charset="UTF-8">${css.map((file) => `<link rel="stylesheet" href="/assets/${file}">`).join('')}</head><body><div id="root"></div><script type="module" src="/performance.js"></script></body></html>`);
  server = http.createServer(async (request, response) => {
    const target = path.resolve(dist, `.${new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname}`);
    if (!target.startsWith(`${dist}/`)) { response.writeHead(403).end(); return; }
    try { const content = await readFile(target); const type = target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream'; response.writeHead(200, { 'Content-Type': type }).end(content); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const runtime of (host === 'both' ? ['browser', 'desktop'] : [host])) {
    for (const [messages, tools] of [[72, 20], [500, 100]]) {
      for (const hz of [30, 60]) {
        const name = `${runtime}-${messages}-${tools}-${hz}`;
        let application; let browser; let context; let page; let recording;
        try {
          if (runtime === 'desktop') {
            application = await electron.launch({ executablePath: desktopRequire('electron'), args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs'), `--redeven-smoke-run=${name}`], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: path.join(temporary, name), FLOWER_PERF_URL: `${url}/?messages=${messages}&tools=${tools}` } });
            page = await application.firstWindow();
            context = application.context();
          } else {
            browser = await chromium.launch({ headless: true });
            context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: path.join(artifacts, name), size: { width: 1280, height: 900 } } });
            page = await context.newPage();
          }
          const pageErrors = [];
          page.on('pageerror', (error) => { pageErrors.push(error); });
          if (runtime === 'browser') await page.goto(`${url}/?messages=${messages}&tools=${tools}`);
          await page.waitForSelector('[data-flower-queued-turn-dock-id="queued-first"]', { timeout: 30_000 });
          await page.waitForFunction(() => document.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
          await page.waitForTimeout(300);
          const row = page.locator('[data-flower-activity-item-id]').last();
          const toggle = row.locator('[data-flower-disclosure-trigger]');
          await toggle.scrollIntoViewIfNeeded();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const before = await cdp.send('Performance.getMetrics');
          let frameIndex = 0;
          if (runtime === 'desktop') {
            await mkdir(path.join(artifacts, name), { recursive: true });
            cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
              await cdp.send('Page.screencastFrameAck', { sessionId });
              await writeFile(path.join(artifacts, name, `${String(frameIndex++).padStart(4, '0')}.jpg`), Buffer.from(data, 'base64'));
            });
            await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 960, maxHeight: 675, everyNthFrame: 3 });
            recording = cdp;
          }
          await page.evaluate((rate) => window.flowerPerformance.start(rate), hz);
          const started = Date.now();
          while (Date.now() - started < seconds * 1000) {
            await toggle.click();
            await page.waitForTimeout(220);
          }
          const result = await page.evaluate(() => window.flowerPerformance.stop());
          if (pageErrors.length) throw new AggregateError(pageErrors, 'Flower renderer failed during measurement');
          const after = await cdp.send('Performance.getMetrics');
          const metric = (data, key) => data.metrics.find((value) => value.name === key)?.value ?? 0;
          const run = { runtime, messages, tools, hz, seconds, processID: application?.process().pid, url, stateDirectory: runtime === 'desktop' ? path.join(temporary, name) : undefined, ...result, layoutMs: 1000 * (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')), styleMs: 1000 * (metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')), layoutCount: metric(after, 'LayoutCount') - metric(before, 'LayoutCount') };
          evidence.runs.push(run);
          await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
          console.log(JSON.stringify({ runtime, messages, tools, hz, frameP95: run.frameP95, clickP95: run.clickP95, maxLongTask: run.maxLongTask, protectedChanges: run.protectedChanges, parses: run.parsers.parses, layoutMs: run.layoutMs }));
          await writeFile(path.join(artifacts, 'metrics.json'), JSON.stringify(evidence, null, 2));
        } finally {
          if (recording) await recording.send('Page.stopScreencast').catch(() => undefined);
          await application?.close();
          if (browser) { await context?.close(); await browser.close(); }
        }
      }
    }
  }
  evidence.acceptance = evidence.runs.every((run) => run.protectedChanges === 0 && run.clicks.length > 0 && run.clickP95 <= 100 && (run.messages === 72 ? run.frameP95 <= 20 : run.maxLongTask < 100));
  await writeFile(path.join(artifacts, 'metrics.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${artifacts}`);
  if (!reference && !evidence.acceptance) throw new Error('Flower streaming performance acceptance failed; inspect metrics.json');
} finally { server?.close(); await rm(temporary, { recursive: true, force: true }); }
