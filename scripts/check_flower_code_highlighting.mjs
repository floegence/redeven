import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedOutput = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
const output = requestedOutput ? path.resolve(requestedOutput) : await mkdtemp(path.join(tmpdir(), 'flower-code-highlighting-'));
const temporary = await mkdtemp(path.join(tmpdir(), 'flower-highlight-build-'));
const uiRequire = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
const desktopRequire = createRequire(path.join(root, 'desktop/package.json'));
const { chromium, _electron: electron } = uiRequire('playwright');
const debugging = process.argv.includes('--debug');
const evidence = { mode: debugging ? 'local-overlay-debugging' : 'published-artifact-acceptance', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0, cpu: cpus()[0]?.model, runs: [] };
await mkdir(output, { recursive: true });
try {
  for (const host of ['browser', 'desktop']) {
    const requireHost = host === 'browser' ? uiRequire : desktopRequire;
    const hostRoot = path.join(root, host === 'browser' ? 'internal/envapp/ui_src' : 'desktop');
    const corePackagePath = path.join(hostRoot, 'node_modules/@floegence/floe-webapp-core/package.json');
    const corePackage = JSON.parse(await readFile(corePackagePath, 'utf8'));
    if (!debugging) {
      assert.ok(corePackage.exports['./code-highlight'], 'installed package must publish the code-highlight API');
      assert.equal(existsSync(path.join(path.dirname(corePackagePath), 'dist-before-highlight-overlay')), false, 'remove local debugging overlays before acceptance');
    }
    const { build, loadConfigFromFile } = await import(pathToFileURL(requireHost.resolve('vite')));
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(hostRoot, host === 'browser' ? 'vite.config.ts' : 'vite.welcome.config.mjs'));
    const dist = path.join(temporary, host);
    const entry = 'virtual:flower-highlight';
    const config = loaded.config;
    const css = path.join(hostRoot, host === 'browser' ? 'src/index.css' : 'src/welcome/index.css');
    const fixture = path.join(root, 'internal/flower_ui/testing/code-highlighting/main.tsx');
    await build({ ...config, root: config.root ?? hostRoot, configFile: false, logLevel: 'error', plugins: [...config.plugins, {
      name: 'flower-highlight-acceptance',
      resolveId(id) { if (id === entry) return `\0${entry}`; },
      load(id) { if (id === `\0${entry}`) return `import ${JSON.stringify(css)}; import ${JSON.stringify(fixture)};`; },
    }], build: { ...config.build, outDir: dist, emptyOutDir: true, manifest: false, cssCodeSplit: false, rolldownOptions: undefined, rollupOptions: { input: entry, output: { entryFileNames: 'highlight.js' } } } });
    const assets = await readdir(path.join(dist, 'assets'));
    assert.ok(assets.some((file) => file.startsWith('highlight.worker-')), 'worker asset must ship in the consumer');
    await writeFile(path.join(dist, 'index.html'), `<!doctype html><html class="light"><head><meta charset="UTF-8">${assets.filter((file) => file.endsWith('.css')).map((file) => `<link rel="stylesheet" href="./assets/${file}">`).join('')}</head><body><div id="root"></div><script type="module" src="./highlight.js"></script></body></html>`);
    const server = http.createServer(async (req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/_redeven_proxy\/env/, '');
      const target = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(`${dist}/`)) { res.writeHead(403).end(); return; }
      try { res.writeHead(200, { 'Content-Type': target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream' }).end(await readFile(target)); }
      catch { res.writeHead(404).end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let application; let browser;
    try {
      const url = host === 'browser' ? `http://127.0.0.1:${server.address().port}/_redeven_proxy/env/` : pathToFileURL(path.join(dist, 'index.html')).href;
      let page;
      if (host === 'browser') { browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1200, height: 900 } }); await page.goto(url); }
      else { application = await electron.launch({ executablePath: desktopRequire('electron'), args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, FLOWER_PERF_PROFILE: path.join(temporary, 'electron-profile'), FLOWER_PERF_URL: url } }); page = await application.firstWindow(); }
      await page.waitForFunction(() => window.flowerHighlight);
      await page.evaluate(() => document.fonts.ready);
      const geometry = () => page.locator('#current pre').evaluate((node) => { const box = node.getBoundingClientRect(); return [box.x, box.y, box.width, box.height, node.scrollWidth, node.scrollLeft]; });
      const before = await geometry();
      await page.evaluate(() => { window.flowerHighlight.clearTasks(); window.getSelection().removeAllRanges(); });
      await page.waitForSelector('#current code[data-floe-code-highlighted]');
      assert.deepEqual(await geometry(), before);
      const coldTasks = await page.evaluate(() => window.flowerHighlight.tasks());
      assert.ok(Math.max(0, ...coldTasks) < 100, 'cold highlighting must not block the UI');
      const metrics = await page.evaluate(async () => {
        const code = document.querySelector('#current code');
        const button = document.querySelector('#current button'); button.focus();
        const token = code.firstElementChild;
        const range = document.createRange(); range.selectNodeContents(code); window.getSelection().addRange(range);
        let changes = 0; const observer = new MutationObserver((records) => changes += records.length); observer.observe(code.parentElement.parentElement, { childList: true, characterData: true, subtree: true });
        const count = window.flowerHighlight.requests(); const frames = []; let previous = performance.now();
        window.flowerHighlight.clearTasks();
        for (let index = 0; index < 120; index++) { window.flowerHighlight.append(index); await new Promise((resolve) => requestAnimationFrame((time) => { frames.push(time - previous); previous = time; resolve(); })); }
        observer.disconnect(); frames.sort((a, b) => a - b);
        return { changes, addedRequests: window.flowerHighlight.requests() - count, retained: code.firstElementChild === token && document.activeElement === button, selection: window.getSelection().toString(), source: window.flowerHighlight.source, frameP95: frames[Math.floor(frames.length * .95)], maxLongTask: Math.max(0, ...window.flowerHighlight.tasks()) };
      });
      assert.equal(metrics.changes, 0); assert.equal(metrics.addedRequests, 0); assert.equal(metrics.retained, true); assert.equal(metrics.selection, metrics.source);
      assert.ok(metrics.frameP95 < 35, `frame P95 ${metrics.frameP95} ms`); assert.ok(metrics.maxLongTask < 100);
      const lightColors = await page.locator('#current code span').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
      await page.evaluate(() => { window.getSelection().removeAllRanges(); window.flowerHighlight.theme('dark'); });
      assert.equal(await page.locator('#current code').evaluate((node) => getComputedStyle(node).colorScheme), 'dark');
      assert.notDeepEqual(await page.locator('#current code span').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color)), lightColors);
      assert.deepEqual(await geometry(), before);
      await page.screenshot({ path: path.join(output, `${host}-dark.png`) });
      await page.evaluate(() => { window.flowerHighlight.history(); });
      await page.waitForFunction(() => document.querySelectorAll('#history code').length === 200);
      await page.waitForTimeout(250);
      const historyWork = await page.evaluate(() => ({ requests: window.flowerHighlight.requests(), visible: [...document.querySelectorAll('#history code')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > 0 && rect.top < window.innerHeight; }).length }));
      assert.ok(historyWork.requests <= historyWork.visible + 2 && historyWork.requests < 200, `offscreen history must not be tokenized: ${JSON.stringify(historyWork)}`);
      await page.evaluate(() => { window.flowerHighlight.clearTasks(); window.flowerHighlight.large(); });
      await page.locator('#history code').scrollIntoViewIfNeeded();
      await page.waitForSelector('#history code[data-floe-code-highlighted]');
      const large = await page.locator('#history code').evaluate((node) => ({ text: node.textContent, tokens: node.children.length, maxLongTask: Math.max(0, ...window.flowerHighlight.tasks()) }));
      assert.equal(large.text, 'const value = true;\n'.repeat(300).trimEnd()); assert.ok(large.tokens > 1000); assert.ok(large.maxLongTask < 100, `large-code task ${large.maxLongTask} ms`);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.locator('#current code').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: path.join(output, `${host}-narrow.png`) });
      const run = { host, coreVersion: corePackage.version, pid: application?.process().pid, port: server.address().port, profile: host === 'desktop' ? path.join(temporary, 'electron-profile') : null, url, ...metrics, historyWork, coldMaxLongTask: Math.max(0, ...coldTasks), largeMaxLongTask: large.maxLongTask, largeTokens: large.tokens };
      evidence.runs.push(run); console.log(JSON.stringify(run));
      await page.evaluate(() => window.flowerHighlight.dispose());
    } finally { await application?.close(); await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
  }
  await writeFile(path.join(output, 'metrics.json'), JSON.stringify(evidence, null, 2));
  console.log(`PASS: ${debugging ? 'debug overlay' : 'published'} workers in Env App and Electron file hosts; evidence: ${output}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
