import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import welcomeConfig from '../vite.welcome.config.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const state = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-office-preview-')));
  const output = path.join(root, 'desktop/dist/office-preview-acceptance');
  await mkdir(output, { recursive: true });
  const fixtureRoot = path.join(root, 'desktop/scripts/fixtures');
  const dist = path.join(state, 'renderer');
  await build({ ...welcomeConfig, configFile: false, root: fixtureRoot, base: './', logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: path.join(fixtureRoot, 'office-preview.html') } } });
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, "const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const win=new BrowserWindow({width:1240,height:900,useContentSize:true,webPreferences:{contextIsolation:true,sandbox:true}});win.loadURL('about:blank');});");
  const app = await session.launchElectron(_electron, { executablePath: electron, args: [entry, '--user-data-dir=' + path.join(state, 'profile')], cwd: state, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const report = { status: 'running', commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), errors: [], network: [], failedRequests: [], checks: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) report.network.push(request.url()); });
  page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const open = async (name, mime, bytes, attachment = false) => {
    await page.evaluate(() => window.officePreview.close());
    await page.waitForFunction(() => !document.querySelector('[data-floe-floating-window]'));
    await page.evaluate(input => window.officePreview.open(input), { name, mime, bytes: [...bytes], attachment });
  };
  const gridReady = async () => {
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.flower-delimited-canvas canvas');
      const host = document.querySelector('.flower-delimited-canvas');
      const zoom = document.querySelector('[aria-label="Zoom in"]');
      return canvas && host && zoom && !zoom.disabled && canvas.clientWidth >= host.clientWidth - 25 && canvas.clientHeight >= host.clientHeight - 25;
    });
    assert.equal(await page.locator('[role=alert]').count(), 0);
  };
  const find = async value => {
    if (await page.getByRole('searchbox').count() === 0) await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByRole('searchbox').fill(value);
    await page.getByRole('searchbox').press('Enter');
    await page.waitForFunction(() => document.querySelector('output')?.textContent === '1');
  };
  try {
    await page.goto(pathToFileURL(path.join(dist, 'office-preview.html')).href);
    await page.waitForFunction(() => window.officePreview);
    assert.ok(page.url().startsWith('file:'));
    const csv = new TextEncoder().encode('name,id,expression\nChinese,00123,"=SUM(1,2)"\nBeta,12345678901234567890,text');
    for (const attachment of [false, true]) {
      await open('literal.csv', 'text/csv', csv, attachment); await gridReady();
      for (const value of ['00123', '12345678901234567890', '=SUM(1,2)']) await find(value);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Actual size', exact: true }).textContent(), '110%');
      await page.getByRole('button', { name: 'Source', exact: true }).click();
      assert.match(await page.locator('pre').textContent(), /00123/);
      await page.getByRole('button', { name: 'Table', exact: true }).click(); await gridReady();
      await page.evaluate(() => {
        window.previewCopiedText = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.previewCopiedText = value; } } });
      });
      await page.locator('.flower-delimited-canvas [data-xlsx-viewport-input]').click({ position: { x: 136, y: 68 } });
      await page.waitForFunction(() => document.querySelector('.flower-delimited-value')?.textContent === '12345678901234567890');
      await page.keyboard.press('ControlOrMeta+c');
      await page.waitForFunction(() => window.previewCopiedText === '12345678901234567890');
      await page.screenshot({ path: path.join(output, attachment ? 'attachment-csv.png' : 'task-csv.png') });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.flower-delimited-preview'));
    }
    report.checks.push('file:// CSV task/attachment, literal strings, selection/keyboard copy dispatch, search, zoom, source, reopen, Escape');
    await open('encoded.csv', 'text/csv', [0xc4, 0xe3, 0xba, 0xc3, 44, 48, 48, 49]);
    await page.getByRole('combobox', { name: 'Encoding' }).selectOption('gb18030'); await gridReady(); await find('你好');
    await page.setViewportSize({ width: 390, height: 760 }); await gridReady();
    assert.ok(await page.locator('.flower-delimited-toolbar').evaluate(element => element.scrollWidth <= element.clientWidth));
    await page.setViewportSize({ width: 1240, height: 900 }); await gridReady();
    report.checks.push('GB18030 and responsive mount');
    const fixtures = path.join(root, 'internal/envapp/ui_src/src/ui/widgets/__fixtures__');
    const workbook = await readFile(path.join(fixtures, 'preview-workbook.xlsx'));
    for (const attachment of [false, true]) {
      await open('identity.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', workbook, attachment); await gridReady();
      assert.equal(await page.locator('table').count(), 0);
      const sheets = page.getByRole('combobox', { name: 'Worksheet', exact: true });
      assert.deepEqual(await sheets.locator('option').allTextContents(), ['Identity', 'Notes']);
      assert.equal(await page.getByRole('searchbox').count(), 0);
      assert.ok(await page.locator('.flower-spreadsheet-toolbar').evaluate(element => element.getBoundingClientRect().height <= 40));
      for (const value of ['00123', '12345678901234567890', 'Beyond legacy limits']) await find(value);
      await page.getByRole('searchbox').press('Escape');
      await page.getByRole('searchbox').waitFor({ state: 'detached' });
      await gridReady();
      await sheets.selectOption('2'); await gridReady(); await find('Commented cell');
      await page.getByRole('searchbox').press('Escape');
      await page.getByRole('searchbox').waitFor({ state: 'detached' });
      await sheets.selectOption('0'); await gridReady();
      await page.setViewportSize({ width: 390, height: 760 }); await gridReady();
      assert.ok(await page.locator('.flower-spreadsheet-toolbar').evaluate(element => element.scrollWidth <= element.clientWidth));
      await page.screenshot({ path: path.join(output, attachment ? 'attachment-xlsx-narrow.png' : 'task-xlsx-narrow.png') });
      await page.setViewportSize({ width: 1240, height: 900 }); await gridReady();
      await page.screenshot({ path: path.join(output, attachment ? 'attachment-xlsx.png' : 'task-xlsx.png') });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.flower-delimited-preview'));
    }
    report.checks.push('OOXML XLSX task/attachment, visible worksheets, nested comments, styles and values beyond legacy limits');
    if (process.env.REDEVEN_ACCEPTANCE_XLSX) {
      const original = await readFile(process.env.REDEVEN_ACCEPTANCE_XLSX);
      await open(path.basename(process.env.REDEVEN_ACCEPTANCE_XLSX), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', original); await gridReady();
      const sheets = page.getByRole('combobox', { name: 'Worksheet', exact: true });
      const indices = await sheets.locator('option').evaluateAll(options => options.map(option => option.value));
      for (const index of indices) { await sheets.selectOption(index); await gridReady(); await page.screenshot({ path: path.join(output, 'original-sheet-' + index + '.png') }); }
      await page.screenshot({ path: path.join(output, 'original-xlsx.png') });
      report.originalWorkbook = { sha256: createHash('sha256').update(original).digest('hex'), visibleSheets: indices.length };
      report.checks.push('Original workbook: ' + indices.length + ' visible worksheets rendered');
    }
    await open('pages.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await readFile(path.join(fixtures, 'preview-pages.docx')));
    await page.locator('section.flower-docx').first().waitFor();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'task-docx.png') });
    report.checks.push('DOCX pages and zoom');
    await open('slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', await readFile(path.join(fixtures, 'preview-pages.pptx')));
    const next = page.getByRole('button', { name: 'Next slide', exact: true }); await next.waitFor();
    let pages = 1;
    while (await next.isEnabled()) { await next.click(); pages++; await page.waitForTimeout(100); }
    assert.ok(pages > 1); assert.equal(await page.locator('[role=alert]').count(), 0);
    await page.screenshot({ path: path.join(output, 'task-pptx.png') });
    report.checks.push('PPTX page navigation');
    await open('broken.xlsx', 'application/octet-stream', [1, 2, 3]);
    await page.getByRole('alert').waitFor(); await page.getByRole('button', { name: 'Retry' }).click();
    await page.getByRole('alert').waitFor(); report.checks.push('corrupt input has retryable error');
    await open('native.pdf', 'application/pdf', await readFile(path.join(fixtures, 'pdf/forms.pdf')), true);
    await page.locator('object[type="application/pdf"]').waitFor(); report.checks.push('native PDF attachment retained');
    assert.deepEqual(report.network, []); assert.deepEqual(report.errors, []); assert.deepEqual(report.failedRequests, []);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack;
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await session.closeElectron(app);
  }
});
