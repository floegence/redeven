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
import { inspectPreviewContinuity } from '../../internal/envapp/ui_src/scripts/previewContinuityAcceptance.mjs';

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
    await page.waitForFunction(() => document.querySelector('output')?.textContent === '1 / 1');
  };
  try {
    await page.goto(pathToFileURL(path.join(dist, 'office-preview.html')).href);
    await page.waitForFunction(() => window.officePreview);
    assert.ok(page.url().startsWith('file:'));
    const html = new TextEncoder().encode('<style>html,body{margin:0;background:#0a1018;color:#eee}main{height:2400px;padding:24px}</style><main><h1>Retained document</h1><input aria-label="Frame draft"></main><script>window.previewBoots=(window.previewBoots||0)+1</script>');
    await open('one.html', 'text/html', html, true);
    await page.waitForSelector('[data-floe-html-state="ready"]');
    await page.evaluate(bytes => window.officePreview.open({ name: 'two.html', mime: 'text/html', bytes, attachment: true }), [...html]);
    await page.waitForFunction(() => document.querySelectorAll('[data-floe-html-state="ready"]').length === 2);
    report.checks.push({ htmlContinuity: await inspectPreviewContinuity(page, page, '[data-attachment-preview-document]', ['one.html', 'two.html']) });
    await page.getByRole('button', { name: 'Close two.html', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 1);
    await page.screenshot({ path: path.join(output, 'html-retained-tabs.png') });
    const htmlSources = process.env.REDEVEN_ACCEPTANCE_HTML ? JSON.parse(process.env.REDEVEN_ACCEPTANCE_HTML) : [];
    if (htmlSources.length) {
      assert.equal(htmlSources.length, 2, 'Supply exactly two local HTML acceptance files');
      await open('acceptance-one.html', 'text/html', await readFile(htmlSources[0]), true);
      await page.waitForSelector('[data-floe-html-state="ready"]');
      await page.evaluate(bytes => window.officePreview.open({ name: 'acceptance-two.html', mime: 'text/html', bytes, attachment: true }), [...await readFile(htmlSources[1])]);
      await page.waitForFunction(() => document.querySelectorAll('[data-floe-html-state="ready"]').length === 2);
      report.checks.push({ originalHtmlContinuity: await inspectPreviewContinuity(page, page, '[data-attachment-preview-document]', ['acceptance-one.html', 'acceptance-two.html'], { interactive: false, brightnessLimit: 245 }) });
    }
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
    await open('quarterly-report.csv', 'text/csv', csv, true); await gridReady();
    const originalGrid = await page.locator('.flower-delimited-canvas').elementHandle();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.evaluate(bytes => window.officePreview.open({ name: 'review-notes.txt', mime: 'text/plain', bytes, attachment: true }), [...new TextEncoder().encode('Review notes retained in their own tab')]);
    await page.getByRole('tab', { name: 'quarterly-report.csv' }).waitFor();
    assert.equal(await page.locator('.flower-attachment-preview-window').count(), 1);
    assert.equal(await page.getByRole('tab').count(), 2);
    await page.getByRole('tab', { name: 'quarterly-report.csv' }).click(); await gridReady();
    assert.ok(await page.locator('.flower-delimited-canvas').evaluate((element, previous) => element === previous, originalGrid));
    assert.equal(await page.getByRole('button', { name: 'Actual size', exact: true }).textContent(), '110%');
    const previewWindow = page.locator('.flower-attachment-preview-window');
    const geometry = page.locator('[data-floe-geometry-surface="floating-window"]').first();
    const initialRect = await geometry.boundingBox();
    const csvTab = page.getByRole('tab', { name: 'quarterly-report.csv' });
    const textTab = page.getByRole('tab', { name: 'review-notes.txt' });
    const from = await csvTab.boundingBox(); const to = await textTab.boundingBox();
    await page.mouse.move(from.x + 18, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + to.width - 5, to.y + to.height / 2, { steps: 8 });
    assert.equal(await csvTab.getAttribute('data-floe-tab-motion'), 'dragging');
    assert.deepEqual(await csvTab.evaluate(element => { const style = getComputedStyle(element); return { opacity: style.opacity, outline: style.outlineStyle, border: style.borderTopColor }; }), { opacity: '1', outline: 'none', border: 'rgba(0, 0, 0, 0)' });
    await page.screenshot({ path: path.join(output, 'attachment-tabs-dragging.png') });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-floe-tab-motion]'));
    await page.waitForFunction(() => document.querySelector('[role="tab"]')?.textContent.includes('review-notes.txt'));
    assert.equal(await csvTab.getAttribute('aria-selected'), 'true');
    assert.equal(await csvTab.evaluate(element => getComputedStyle(element).userSelect), 'none');
    assert.equal(await page.evaluate(() => String(window.getSelection())), '');
    assert.deepEqual(await geometry.boundingBox(), initialRect);
    assert.ok(await page.locator('.flower-delimited-canvas').evaluate((element, previous) => element === previous, originalGrid));
    const titleContent = await previewWindow.locator('[data-floe-floating-window-title-content]').boundingBox();
    const x = titleContent.x + titleContent.width - 16; const y = titleContent.y + titleContent.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y + 40, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(y => document.querySelector('[data-floe-geometry-surface="floating-window"]').getBoundingClientRect().y > y + 20, initialRect.y);
    await page.screenshot({ path: path.join(output, 'attachment-tabs-csv.png') });
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.getByRole('tab', { name: 'review-notes.txt' }).click();
    await page.getByRole('tab', { name: 'quarterly-report.csv' }).click();
    assert.equal(await page.getByRole('button', { name: 'Source', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Close review-notes.txt', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 0);
    assert.match(await page.locator('pre').textContent(), /00123/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.flower-attachment-preview-window'));
    report.checks.push('file:// sortable multi-file header tabs, whitespace window drag, retained CSV canvas/zoom/source, independent text, close-to-single and Escape');

    await open('encoded.csv', 'text/csv', [0xc4, 0xe3, 0xba, 0xc3, 44, 48, 48, 49]);
    await page.getByRole('combobox', { name: 'Encoding' }).click();
    await page.getByRole('option', { name: 'GB18030', exact: true }).click(); await gridReady(); await find('你好');
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
      assert.deepEqual(await sheets.locator('..').locator('select option:not([value=""])').allTextContents(), ['Identity', 'Notes']);
      assert.equal(await page.getByRole('searchbox').count(), 0);
      assert.ok(await page.locator('.flower-spreadsheet-toolbar').evaluate(element => element.getBoundingClientRect().height <= 40));
      for (const value of ['00123', '12345678901234567890', 'Beyond legacy limits']) await find(value);
      await page.getByRole('searchbox').press('Escape');
      await page.locator('[data-spreadsheet-panel]').waitFor({ state: 'detached' });
      await gridReady();
      await sheets.click(); await page.getByRole('option', { name: 'Notes', exact: true }).click(); await gridReady(); await find('Commented cell');
      await page.getByRole('searchbox').press('Escape');
      await page.locator('[data-spreadsheet-panel]').waitFor({ state: 'detached' });
      await sheets.click(); await page.getByRole('option', { name: 'Identity', exact: true }).click(); await gridReady();
      await page.setViewportSize({ width: 390, height: 760 }); await gridReady();
      assert.ok(await page.locator('.flower-spreadsheet-toolbar').evaluate(element => element.scrollWidth <= element.clientWidth));
      assert.ok(await page.locator('.flower-spreadsheet-toolbar').evaluate(element => {
        const controls = [...element.querySelectorAll('button')].filter(control => control.checkVisibility() && !control.closest('[data-floating-presence]'));
        return controls.every((control, index) => !index || control.getBoundingClientRect().left >= controls[index - 1].getBoundingClientRect().right);
      }));
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
      const indices = await sheets.locator('..').locator('select option:not([value=""])').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent })));
      for (const index of indices) { await sheets.click(); await page.getByRole('option', { name: index.label, exact: true }).click(); await gridReady(); await page.screenshot({ path: path.join(output, 'original-sheet-' + index.value + '.png') }); }
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
