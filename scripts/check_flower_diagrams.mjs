import { createDesktopTestSession } from './desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 240000,
});
await session.run(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const requestedOutput = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
  const output = requestedOutput ? path.resolve(requestedOutput) : await mkdtemp(path.join(tmpdir(), 'flower-diagrams-'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'flower-diagram-build-'));
  await session.directory(temporary);
  const uiRequire = createRequire(path.join(root, 'internal/envapp/ui_src/package.json'));
  const desktopRequire = createRequire(path.join(root, 'desktop/package.json'));
  const { chromium, _electron: electron } = uiRequire('playwright');
  const evidence = {
    mode: 'published-artifact-acceptance',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    cpu: cpus()[0]?.model,
    runs: [],
  };
  await mkdir(output, { recursive: true });

  for (const host of ['browser', 'desktop']) {
    const requireHost = host === 'browser' ? uiRequire : desktopRequire;
    const hostRoot = path.join(root, host === 'browser' ? 'internal/envapp/ui_src' : 'desktop');
    const corePackagePath = path.join(hostRoot, 'node_modules/@floegence/floe-webapp-core/package.json');
    const corePackage = JSON.parse(await readFile(corePackagePath, 'utf8'));
    {
      assert.ok(corePackage.exports['./diagrams'], 'installed package must publish the diagrams API');
      assert.equal(
        existsSync(path.join(path.dirname(corePackagePath), 'dist-before-diagram-overlay')),
        false,
        'remove local debugging overlays before acceptance',
      );
    }
    const { build, loadConfigFromFile } = await import(pathToFileURL(requireHost.resolve('vite')));
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      path.join(hostRoot, host === 'browser' ? 'vite.config.ts' : 'vite.welcome.config.mjs'),
    );
    const dist = path.join(temporary, host);
    const entry = 'virtual:flower-diagrams';
    const config = loaded.config;
    const css = path.join(hostRoot, host === 'browser' ? 'src/index.css' : 'src/welcome/index.css');
    const fixture = path.join(root, 'internal/flower_ui/testing/diagrams/main.tsx');
    await build({
      ...config,
      root: config.root ?? hostRoot,
      configFile: false,
      logLevel: 'error',
      plugins: [
        ...config.plugins,
        {
          name: 'flower-diagrams-acceptance',
          resolveId(id) {
            if (id === entry) return `\0${entry}`;
          },
          load(id) {
            if (id === `\0${entry}`) return `import ${JSON.stringify(css)}; import ${JSON.stringify(fixture)};`;
          },
        },
      ],
      build: {
        ...config.build,
        outDir: dist,
        emptyOutDir: true,
        manifest: false,
        cssCodeSplit: false,
        rolldownOptions: undefined,
        rollupOptions: {
          input: entry,
          output: { entryFileNames: 'diagrams.js' },
        },
      },
    });
    const assets = await readdir(path.join(dist, 'assets'));
    assert.ok(assets.some(file => /flowchart|lazy/.test(file)), 'lazy Pele assets must ship');
    const pelePackage = JSON.parse(await readFile(path.join(hostRoot, 'node_modules/pele/package.json'), 'utf8'));
    assert.equal(pelePackage.version, '1.13.0');
    await writeFile(
      path.join(dist, 'index.html'),
      `<!doctype html><html class="light"><head><meta charset="UTF-8">${assets
        .filter((file) => file.endsWith('.css'))
        .map((file) => `<link rel="stylesheet" href="./assets/${file}">`)
        .join('')}</head><body><div id="root"></div><script type="module" src="./diagrams.js"></script></body></html>`,
    );
    const server = http.createServer(async (req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/_redeven_proxy\/env/, '');
      const target = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(`${dist}/`)) {
        res.writeHead(403).end();
        return;
      }
      try {
        res
          .writeHead(200, {
            'Content-Type': target.endsWith('.js')
              ? 'text/javascript'
              : target.endsWith('.css')
                ? 'text/css'
                : target.endsWith('.html')
                  ? 'text/html'
                  : 'application/octet-stream',
          })
          .end(await readFile(target));
      } catch {
        res.writeHead(404).end();
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
    let application;
    let browser;
    try {
      const url =
        host === 'browser'
          ? `http://127.0.0.1:${server.address().port}/_redeven_proxy/env/`
          : pathToFileURL(path.join(dist, 'index.html')).href;
      let page;
      if (host === 'browser') {
        browser = await session.launchBrowser(chromium, { headless: true });
        page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        await page.goto(url);
      } else {
        application = await session.launchElectron(electron, {
          executablePath: desktopRequire('electron'),
          args: [path.join(root, 'internal/flower_ui/testing/performance/desktop.cjs')],
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: undefined,
            FLOWER_PERF_PROFILE: path.join(temporary, 'electron-profile'),
            FLOWER_PERF_URL: url,
          },
        });
        page = await application.firstWindow();
      }
      const failures = [];
      page.on('pageerror', error => failures.push(error.message));
      await page.waitForFunction(() => window.flowerDiagrams);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('#current .floe-diagram').count(), 0, 'open fences remain source');
      assert.ok((await page.locator('#current code').textContent()).includes('Decision'));
      await page.evaluate(() => window.flowerDiagrams.close());
      const svgSelector = '#current .floe-diagram-svg > svg';
      await page.waitForSelector(svgSelector);
      assert.ok((await page.locator(svgSelector).textContent()).includes('Decision'));
      const original = await page.locator(svgSelector).elementHandle();
      const color = await page.locator(svgSelector).evaluate(node => getComputedStyle(node).getPropertyValue('--pele-fg'));
      await page.locator('#current').getByRole('button', {name:'Source',exact:true}).focus();
      await page.evaluate(() => {
        window.flowerDiagrams.clearTasks();
        const range = document.createRange(); range.selectNodeContents(document.querySelector('#current svg text'));
        window.getSelection().addRange(range);
      });
      const selected = await page.evaluate(() => window.getSelection().toString());
      assert.ok(selected.length > 0);
      for (let index = 0; index < 60; index++) await page.evaluate(i => window.flowerDiagrams.append(i), index);
      await page.evaluate(() => window.flowerDiagrams.finish());
      assert.equal(await original.evaluate(node => node === document.querySelector('#current .floe-diagram-svg > svg')), true);
      assert.equal(await page.evaluate(() => window.getSelection().toString()), selected);
      assert.equal(await page.locator('#draft').inputValue(), 'Retain this draft');
      assert.equal(await page.locator('#current').getByRole('button', {name:'Source',exact:true}).evaluate(node => node === document.activeElement), true);
      await page.evaluate(() => { window.getSelection().removeAllRanges(); window.flowerDiagrams.theme('dark'); });
      assert.equal(await original.evaluate(node => node === document.querySelector('#current .floe-diagram-svg > svg')), true);
      assert.notEqual(await page.locator(svgSelector).evaluate(node => getComputedStyle(node).getPropertyValue('--pele-fg')), color);
      await page.evaluate(() => window.flowerDiagrams.reset());
      assert.equal(await original.evaluate(node => node === document.querySelector('#current .floe-diagram-svg > svg')), true, 'snapshot retains unchanged diagram');
      const source = await page.evaluate(() => window.flowerDiagrams.source);
      await page.locator('#current').getByRole('button', {name:'Source', exact:true}).click();
      assert.equal(await page.locator('#current .floe-diagram-source').textContent(), source);
      await page.locator('#current').getByRole('button', {name:'Copy source', exact:true}).click();
      await page.locator('#current .floe-diagram-feedback').filter({hasText:'Copied'}).waitFor();
      await page.locator('#current').getByRole('button', {name:'Preview', exact:true}).click();
      await page.locator('#current').getByRole('button', {name:'Expand diagram'}).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.locator('.floe-diagram-svg > svg').waitFor();
      assert.equal(await dialog.evaluate(node => { let p=node; while(p && getComputedStyle(p).zIndex !== '1234') p=p.parentElement; return !!p; }), true, 'host dialog ownership survives mounting');
      await dialog.getByRole('button', {name:'Zoom in'}).click();
      assert.equal(await dialog.locator('.floe-diagram-zoomed').evaluate(node => node.style.getPropertyValue('--floe-diagram-scale')), '1.25');
      await page.keyboard.press('Escape');
      await page.locator('[data-floe-dialog-panel]').waitFor({state:'detached'});
      await page.screenshot({path:path.join(output, host + '-dark.png')});
      const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node=>node.id));
      assert.equal(new Set(ids).size, ids.length, 'diagram IDs are unique');
      await page.evaluate(() => window.flowerDiagrams.replace('flowchart LR\n invalid ---> [broken'));
      await page.locator('#current [role="alert"]').waitFor();
      assert.ok((await page.locator('#current').textContent()).includes('invalid ---> [broken'));
      await page.locator('#current').getByRole('button', {name:'Retry',exact:true}).click();
      await page.locator('#current [role="alert"]').waitFor();
      await page.evaluate(() => window.flowerDiagrams.replace(window.flowerDiagrams.source));
      await page.waitForSelector(svgSelector);
      await page.evaluate(() => window.flowerDiagrams.history());
      await page.waitForFunction(() => document.querySelectorAll('#history .floe-diagram').length === 100);
      await page.waitForTimeout(250);
      const historyRendered = await page.locator('#history .floe-diagram-svg > svg').count();
      assert.ok(historyRendered < 15, 'offscreen history must stay lazy');
      const maxLongTask = await page.evaluate(() => Math.max(0,...window.flowerDiagrams.tasks()));
      assert.ok(maxLongTask < 100, 'diagram interaction must not introduce a 100 ms main-thread task: ' + maxLongTask);
      await page.setViewportSize({width:360,height:800});
      await page.locator('#current').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({path:path.join(output, host + '-narrow.png')});
      assert.deepEqual(failures, []);
      const run = {host, coreVersion:corePackage.version, peleVersion:pelePackage.version,
        pid:application?.process().pid, port:server.address().port, url, historyRendered, maxLongTask};
      evidence.runs.push(run); console.log(JSON.stringify(run));
      await page.evaluate(() => window.flowerDiagrams.dispose());
      assert.equal(await page.locator('.floe-diagram').count(), 0);
    } finally {
      if (application) await session.closeElectron(application);
      await session.closeBrowser(browser);
    }
  }
  await session.writeEvidence(path.join(output, 'metrics.json'), JSON.stringify(evidence, null, 2));
  console.log(
    `Assertions complete: published diagrams in Env App and Electron file hosts; evidence: ${output}`,
  );
});
