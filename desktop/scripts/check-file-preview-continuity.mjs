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
    await page.getByRole('button', { name: 'Find in file', exact: true }).click();
    const find = page.locator('.find-widget textarea[aria-label="Find"]');
    await find.fill('License');
    await page.waitForFunction(() => document.querySelector('.matchesCount')?.textContent === '1 of 2');
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
        const geometry = await target.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const tooltip = [...document.querySelectorAll('.monaco-hover')].find(el => el.getBoundingClientRect().width > 0);
          const bounds = tooltip?.getBoundingClientRect();
          const viewport = element.closest('[data-preview-document]').getBoundingClientRect();
          return { hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
            contained: !!bounds && bounds.top >= rect.bottom - 1 && bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1 };
        });
        assert.ok(geometry.hit && geometry.contained, label + ': ' + JSON.stringify(geometry));
      }
      await page.screenshot({ path: path.join(output, 'search-tooltip-' + label.replaceAll(' ', '-') + '.png') });
      await page.mouse.move(0, 0);
    }
    await open('notes.md', new TextEncoder().encode('# Reading preview\n\nHello **world**, hello world.'));
    assert.equal(await page.locator('[data-preview-document="/acceptance/LICENSE"]').evaluate(el => getComputedStyle(el).opacity), '0');
    await page.getByRole('button', { name: 'Find in file', exact: true }).click();
    await page.getByRole('searchbox').fill('hello world');
    await page.getByRole('status').filter({ hasText: '1 of 2' }).waitFor();
    await page.getByRole('searchbox').press('Enter');
    assert.equal(await page.locator('.floe-text-search [role="status"]').textContent(), '2 of 2');
    await page.screenshot({ path: path.join(output, 'markdown-search.png') });
    await page.getByRole('tab').filter({ hasText: 'LICENSE' }).click();
    assert.equal(await find.inputValue(), 'License');
    await page.getByRole('tab').filter({ hasText: 'notes.md' }).click();
    assert.equal(await page.getByRole('searchbox').inputValue(), 'hello world');
    await page.getByRole('searchbox').press('Escape');
    assert.equal(await page.getByRole('search').count(), 0);
    assert.equal(await page.locator('[data-floe-floating-window-surface]').count(), 1);
    report.checks.push({ search: 'markdown-and-text', tooltip: 'stable-contained', retainedSearch: true });
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
