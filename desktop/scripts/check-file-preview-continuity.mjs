import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { pdfAssetsPlugin } from '@floegence/floe-webapp-core/pdf-assets';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { inspectPreviewContinuity } from '../../internal/envapp/ui_src/scripts/previewContinuityAcceptance.mjs';
import welcomeConfig from '../vite.welcome.config.mjs';

const session = await createDesktopTestSession(import.meta.url, { timeoutMs: 180000 });
await session.run(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  const state = await session.directory(await mkdtemp(path.join(tmpdir(), 'redeven-html-workspace-')));
  const output = path.join(root, 'desktop/dist/file-preview-continuity'); await mkdir(output, { recursive: true });
  const dist = path.join(state, 'renderer');
  const transport = { name: 'acceptance-file-transport', enforce: 'pre',
    resolveId(source, importer) { if (source.endsWith('/utils/fileStreamReader') && importer?.endsWith('/createFilePreviewController.ts')) return '\0acceptance-file-transport'; },
    load(id) { if (id !== '\0acceptance-file-transport') return;
      return `export async function openReadFileStreamChannel({path}) { const test=window.filePreviewAcceptance; test.reads++; const bytes=test.files.get(path); if(!bytes)throw new Error('Missing acceptance file');let offset=0;return {meta:{content_len:bytes.length},channel:{reader:{readExactly:async length=>{const value=bytes.slice(offset,offset+length);offset+=length;return value}},close:async()=>{},stream:{reset(){}}}};}`;
    } };
  await build({ ...welcomeConfig, configFile: false, root: path.join(root, 'desktop/scripts/fixtures'), base: './', logLevel: 'warn', plugins: [...welcomeConfig.plugins, pdfAssetsPlugin(), transport],
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: path.join(root, 'desktop/scripts/fixtures/file-preview-workspace.html') } } });
  const entry = path.join(state, 'main.cjs');
  await writeFile(entry, "const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:900,useContentSize:true,webPreferences:{contextIsolation:true,sandbox:true}});win.loadURL('about:blank');});");
  const app = await session.launchElectron(_electron, { executablePath: electron, args: [entry, '--user-data-dir='+path.join(state,'profile')], cwd: state, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const report = { status: 'running', checks: [], errors: [], commit: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim() };
  page.on('pageerror', error => report.errors.push(error.message));
  try {
    await page.goto(pathToFileURL(path.join(dist,'file-preview-workspace.html')).href);
    await page.waitForFunction(()=>window.filePreviewAcceptance);
    const open = (name, bytes) => page.evaluate(({name,bytes})=>window.filePreviewAcceptance.open(name,bytes),{name,bytes:[...bytes]});
    const html = new TextEncoder().encode('<style>html,body{margin:0;background:#0a1018;color:#eee}main{height:2400px;padding:24px}</style><main><input aria-label="Frame draft"></main><script>window.previewBoots=(window.previewBoots||0)+1</script>');
    await open('one.html',html); await open('two.html',html);
    report.checks.push(await inspectPreviewContinuity(page,page,'[data-preview-document]',['one.html','two.html']));
    assert.equal(await page.evaluate(()=>window.filePreviewAcceptance.reads),2);
    await page.getByRole('button',{name:'Close two.html',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 1);
    await page.screenshot({path:path.join(output,'retained-html.png')});
    await open('LICENSE', new TextEncoder().encode('MIT License\nCopyright Floegence\nLicense terms'));
    const more = page.locator('[data-floe-floating-window-titlebar] button[aria-label="More file actions"]:visible');
    const openFind = async () => {
      assert.equal(await page.locator('[data-floe-floating-window-titlebar] [data-redeven-preview-find]').count(), 0);
      await page.waitForFunction(() => {
        const header = document.querySelector('[data-floe-floating-window-titlebar]');
        return header && !header.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')
          && [...header.querySelectorAll('button[aria-label="More file actions"]')].filter(element => element.checkVisibility()).length === 1;
      });
      await more.click();
      await page.getByRole('menuitem', { name: 'Find in file', exact: true }).click();
    };
    await more.waitFor();
    const editor = page.locator('[data-preview-document="/acceptance/LICENSE"] .monaco-editor');
    await editor.waitFor();
    const editorBounds = await editor.boundingBox();
    const documentBounds = await page.locator('[data-preview-document="/acceptance/LICENSE"]').boundingBox();
    assert.equal(editorBounds.y, documentBounds.y, 'Monaco must not reserve a Find toolbar row');
    assert.equal(editorBounds.height, documentBounds.height, 'Monaco must fill the document viewport');
    await openFind();
    const find = page.locator('.find-widget textarea[aria-label="Find"]');
    await find.fill('License');
    await page.waitForFunction(() => document.querySelector('.matchesCount')?.textContent === '1 of 2');
    assert.deepEqual(await editor.boundingBox(), editorBounds, 'Opening Monaco Find must preserve viewport geometry');
    for (const label of ['Find in Selection', 'Close']) {
      const target = page.locator('.find-widget [aria-label^="' + label + '"]');
      if (label === 'Find in Selection') {
        await page.locator('.monaco-editor .view-lines').click();
        await page.keyboard.press('ControlOrMeta+A');
      }
      await target.hover();
      await page.waitForFunction(label => [...document.querySelectorAll('.monaco-hover')].some(el => el.textContent.includes(label) && el.getBoundingClientRect().width > 0), label);
      for (let sample = 0; sample < 8; sample++) {
        await page.waitForTimeout(100);
        const geometry = await target.evaluate((element, label) => {
          const rect = element.getBoundingClientRect();
          const tooltip = [...document.querySelectorAll('.monaco-hover')].find(el => el.textContent.includes(label) && el.getBoundingClientRect().width > 0);
          const bounds = tooltip?.getBoundingClientRect();
          const viewport = element.closest('[data-preview-document]').getBoundingClientRect();
          return { hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
            contained: !!bounds && bounds.top >= rect.bottom - 1 && bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1 };
        }, label);
        assert.ok(geometry.hit && geometry.contained, label + ': ' + JSON.stringify(geometry));
      }
      await page.screenshot({ path: path.join(output, 'search-tooltip-' + label.replaceAll(' ', '-') + '.png') });
      await page.mouse.move(0, 0);
    }
    await open('notes.md', new TextEncoder().encode('# Reading preview\n\nHello **world**, hello world.'));
    assert.equal(await page.locator('[data-preview-document="/acceptance/LICENSE"]').evaluate(el => getComputedStyle(el).opacity), '0');
    const markdown = page.locator('[data-preview-document="/acceptance/notes.md"] .file-markdown-body');
    const markdownBounds = await markdown.boundingBox();
    await openFind();
    await page.getByRole('searchbox').fill('hello world');
    await page.getByRole('status').filter({ hasText: '1 of 2' }).waitFor();
    await page.getByRole('searchbox').press('Enter');
    assert.equal(await page.locator('.floe-text-search [role="status"]').textContent(), '2 of 2');
    assert.deepEqual(await markdown.boundingBox(), markdownBounds, 'Opening rendered Find must preserve viewport geometry');
    const searchLayout = await page.locator('[data-preview-document="/acceptance/notes.md"] .redeven-preview-search-overlay').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const owner = element.closest('[data-preview-document]').getBoundingClientRect();
      return { absolute: getComputedStyle(element).position === 'absolute', compact: bounds.width <= 450,
        contained: bounds.left >= owner.left && bounds.right <= owner.right,
        noOverflow: element.scrollWidth <= element.clientWidth };
    });
    assert.deepEqual(searchLayout, { absolute: true, compact: true, contained: true, noOverflow: true });
    await page.screenshot({ path: path.join(output, 'markdown-search.png') });
    await page.getByRole('tab').filter({ hasText: 'LICENSE' }).click();
    assert.equal(await find.inputValue(), 'License');
    await page.getByRole('tab').filter({ hasText: 'notes.md' }).click();
    assert.equal(await page.getByRole('searchbox').inputValue(), 'hello world');
    await page.getByRole('searchbox').press('Escape');
    assert.equal(await page.getByRole('search').count(), 0);
    assert.deepEqual(await markdown.boundingBox(), markdownBounds, 'Closing Find must preserve viewport geometry');
    assert.ok(await more.evaluate(element => element === document.activeElement), 'Closing Find must restore the header action focus');
    assert.equal(await page.locator('[data-floe-floating-window-surface]').count(), 1);
    report.checks.push({ search: 'markdown-and-text', tooltip: 'stable-contained', retainedSearch: true, searchLayout: 'more-menu-and-compact-overlay', viewportUnchanged: true });
    const fixtures = path.join(root, 'internal/envapp/ui_src/src/ui/widgets/__fixtures__');
    const matchStyles = owner => owner.locator('.flower-delimited-canvas').evaluate(element => [...element.querySelectorAll('div')]
      .filter(node => node.style.borderWidth === '2px' && node.style.pointerEvents === 'none')
      .map(node => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor })));
    for (const format of ['csv', 'tsv']) {
      const name = 'current-match.' + format;
      await open(name, new TextEncoder().encode('match,match\nmatch,end'.replaceAll(',', format === 'csv' ? ',' : '\t')));
      const owner = page.locator('[data-preview-document="/acceptance/' + name + '"]');
      await owner.getByRole('button', { name: 'Zoom in', exact: true }).waitFor();
      const body = owner.locator('.flower-delimited-body');
      const before = await body.boundingBox();
      await openFind();
      const input = page.getByRole('searchbox');
      await input.fill('match'); await input.press('Enter');
      await page.getByRole('status').filter({ hasText: '1 / 3' }).waitFor();
      const first = await matchStyles(owner);
      assert.equal(first.length, 3);
      assert.notDeepEqual(first[0], first[1]); assert.deepEqual(first[1], first[2]);
      assert.equal(await owner.locator('[data-xlsx-selection-border]').count(), 1);
      assert.ok(await input.evaluate(element => element === document.activeElement));
      await page.screenshot({ path: path.join(output, name + '-first.png') });
      await input.press('Enter');
      await page.getByRole('status').filter({ hasText: '2 / 3' }).waitFor();
      assert.deepEqual(await matchStyles(owner), [first[1], first[0], first[1]]);
      await input.press('Shift+Enter');
      await page.getByRole('status').filter({ hasText: '1 / 3' }).waitFor();
      await input.press('Shift+Enter');
      await page.getByRole('status').filter({ hasText: '3 / 3' }).waitFor();
      await page.setViewportSize({ width: 390, height: 760 });
      // Crossing the mobile breakpoint replaces the window with a dialog.
      await page.getByRole('button', { name: 'More file actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Find in file', exact: true }).click();
      await input.fill('match'); await input.press('Enter');
      await page.getByRole('status').filter({ hasText: '1 / 3' }).waitFor();
      const panel = page.locator('[data-spreadsheet-panel]');
      assert.ok(await panel.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth; }));
      await page.screenshot({ path: path.join(output, name + '-narrow.png') });
      await input.press('Escape');
      await page.setViewportSize({ width: 1280, height: 900 });
      await openFind();
      await input.fill('match'); await input.press('Enter');
      await page.getByRole('status').filter({ hasText: '1 / 3' }).waitFor();
      await input.press('Shift+Enter');
      await page.getByRole('status').filter({ hasText: '3 / 3' }).waitFor();
      await input.press('Escape');
      assert.deepEqual(await body.boundingBox(), before);
      await open('current-match-notes.txt', new TextEncoder().encode('Independent document'));
      assert.equal(await page.locator('[data-spreadsheet-panel]:visible').count(), 0);
      await page.getByRole('tab').filter({ hasText: name }).click();
      await page.waitForFunction(name => document.querySelector('[data-preview-document="/acceptance/' + name + '"]')?.getAttribute('aria-hidden') !== 'true', name);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await openFind();
      await page.getByRole('status').filter({ hasText: '3 / 3' }).waitFor();
      assert.equal(await input.inputValue(), 'match');
      assert.deepEqual(await matchStyles(owner), [first[1], first[1], first[0]]);
      await input.fill('missing'); await input.press('Enter');
      await page.getByRole('status').filter({ hasText: '0 / 0' }).waitFor();
      assert.deepEqual(await matchStyles(owner), []);
      await input.press('Escape');
      report.checks.push({ format, activeMatch: 'distinct-blue-fill-and-selection-border', position: 'renderer-match-index', navigation: 'forward-backward-wrap', retainedFile: true, narrowOverlay: true });
    }
    const documents = [
      { name: 'search.docx', bytes: await readFile(path.join(fixtures, 'preview-pages.docx')), query: 'Second page', count: '1 of 1', viewport: '.docx-preview-pane' },
      { name: 'search.pptx', bytes: await readFile(path.join(fixtures, 'preview-pages.pptx')), query: 'Presentation page 30', count: '1 of 1', viewport: '.pptx-preview-pane' },
      { name: 'search.pdf', bytes: await readFile(path.join(fixtures, 'pdf/long-text.pdf')), query: 'REDEVEN-300', count: '1 of 29', viewport: '.pdf-preview-pane' },
      { name: 'search.xlsx', bytes: await readFile(path.join(fixtures, 'preview-workbook.xlsx')), query: '00123', count: '1 / 1', viewport: '.flower-delimited-body', submit: true },
      { name: 'search.csv', bytes: new TextEncoder().encode('name,id\nNeedle,0007'), query: 'Needle', count: '1 / 1', viewport: '.flower-delimited-body', submit: true },
      { name: 'search.tsv', bytes: new TextEncoder().encode('name\tid\nNeedle\t0007'), query: 'Needle', count: '1 / 1', viewport: '.flower-delimited-body', submit: true },
      { name: 'search.html', bytes: new TextEncoder().encode('<h1>Hello <b>world</b></h1><p>Hello world</p>'), query: 'hello world', count: '1 of 2', viewport: '.html-preview-frame' },
    ];
    for (const document of documents) {
      await open(document.name, document.bytes);
      const owner = page.locator('[data-preview-document="/acceptance/' + document.name + '"]');
      await owner.locator(document.viewport).waitFor();
      await openFind();
      const input = page.getByRole('searchbox');
      await input.waitFor();
      assert.ok(await input.evaluate(element => element === window.document.activeElement));
      const bounds = await owner.locator(document.viewport).boundingBox();
      await input.fill(document.query); if (document.submit) await input.press('Enter');
      await page.getByRole('status').filter({ hasText: document.count }).waitFor();
      if (document.name.endsWith('.pptx')) {
        await owner.locator('[data-page-number="30"] [data-pptx-search-match]').waitFor();
        assert.ok(await owner.locator('.pptx-preview-pane__page').count() < 8);
      }
      if (document.name.endsWith('.html')) {
        await input.press('Enter'); await page.getByRole('status').filter({ hasText: '2 of 2' }).waitFor();
      }
      await page.screenshot({ path: path.join(output, document.name + '.png') });
      await input.press('Escape');
      assert.equal(await page.locator('[data-floe-floating-window-surface]').count(), 1);
      assert.deepEqual(await owner.locator(document.viewport).boundingBox(), bounds, document.name + ' search must not consume a row');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'More file actions');
      report.checks.push({ menuSearch: document.name, matches: document.count, viewportUnchanged: true });
    }
    const sources = process.env.REDEVEN_ACCEPTANCE_HTML ? JSON.parse(process.env.REDEVEN_ACCEPTANCE_HTML) : [];
    if (sources.length) {
      assert.equal(sources.length,2);
      await page.evaluate(()=>window.filePreviewAcceptance.close()); await page.waitForSelector('[data-preview-document]',{state:'detached'});
      await open('acceptance-one.html',await readFile(sources[0])); await open('acceptance-two.html',await readFile(sources[1]));
      report.checks.push(await inspectPreviewContinuity(page,page,'[data-preview-document]',['acceptance-one.html','acceptance-two.html'],{interactive:false,brightnessLimit:245}));
      await page.screenshot({path:path.join(output,'original-html.png')});
    }
    assert.deepEqual(report.errors,[]);
    await page.evaluate(()=>window.filePreviewAcceptance.close()); await page.waitForSelector('iframe',{state:'detached'});
    report.status='passed'; console.log(JSON.stringify(report));
  } catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); await page.screenshot({path:path.join(output,'failure.png')}); report.dom = await page.locator('[data-preview-document]:not([aria-hidden])').evaluate(el=>el.innerHTML.slice(0,5000)).catch(()=> ''); throw error; }
  finally { await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)); await session.closeElectron(app); }
});
