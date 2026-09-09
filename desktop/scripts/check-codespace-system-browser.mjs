import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const requireUI = createRequire(
  path.join(repo, 'internal/envapp/ui_src/package.json'),
);
const { chromium } = requireUI('playwright');
const directory = await mkdtemp(
  path.join(tmpdir(), 'redeven-codespace-browser-'),
);
const marker = randomUUID();
let fixture, fixtureExit, browser, sessions, timer, page;
try {
  const binary = path.join(directory, 'bridge-fixture');
  execFileSync('go', ['test', '-c', '-o', binary, './internal/localui'], {
    cwd: repo,
    env: { ...process.env, GOWORK: 'off' },
    stdio: 'inherit',
  });
  await build({
    stdin: {
      contents: `export { CodeSpaceBrowserSessions } from './src/main/codespaceBrowserSessions'; export { NativeCodeSpaceProfiles } from './src/main/codespaceNativeProfiles'; export { createLocalNativeCodeSpaceRoute } from './src/main/codespaceNativeRoute';`,
      resolveDir: path.join(repo, 'desktop'),
      loader: 'ts',
    },
    outfile: path.join(directory, 'helpers.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const {
    CodeSpaceBrowserSessions,
    NativeCodeSpaceProfiles,
    createLocalNativeCodeSpaceRoute,
  } = await import(pathToFileURL(path.join(directory, 'helpers.mjs')));
  fixture = spawn(
    binary,
    [
      '-test.run=^TestNativeCodeSpaceBrowserEditorFixture$',
      '-test.timeout=120s',
      '-test.v',
    ],
    {
      cwd: directory,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        REDEVEN_NATIVE_BROWSER_FIXTURE_STATE: path.join(directory, 'state'),
        REDEVEN_BROWSER_RUN_MARKER: marker,
      },
    },
  );
  fixtureExit = once(fixture, 'exit');
  const terminateFixture = () => {
    if (!fixture || fixture.exitCode !== null || fixture.signalCode !== null)
      return;
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/PID', String(fixture.pid), '/T', '/F']);
    else process.kill(-fixture.pid, 'SIGTERM');
  };
  timer = setTimeout(terminateFixture, 100_000);
  const ready = await new Promise((resolve, reject) => {
    let buffer = '';
    fixture.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.startsWith('NATIVE_BROWSER_READY '))
          resolve(JSON.parse(line.slice(21)));
      }
    });
    fixture.once('exit', (code, signal) =>
      reject(
        new Error(
          `private bridge fixture exited before readiness: ${code} ${signal}`,
        ),
      ),
    );
  });
  console.log(
    'Owned browser acceptance runtime:',
    JSON.stringify({
      ...ready,
      fixture_pid: fixture.pid,
      marker,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim(),
    }),
  );
  const raw = await fetch(ready.bridge_url + '/cs/native-smoke/');
  assert.equal(raw.status, 401);
  assert.match(await raw.text(), /Local UI bridge authorization required/);
  sessions = new CodeSpaceBrowserSessions();
  let entry;
  await sessions.open('native-smoke', {
    identity: 'a'.repeat(64),
    profiles: new NativeCodeSpaceProfiles(
      path.join(directory, 'profiles.json'),
    ),
    createRoute: (signal) =>
      createLocalNativeCodeSpaceRoute({
        transport: {
          kind: 'native_local_bridge',
          baseURL: ready.bridge_url,
          allowedBaseURL: ready.bridge_url,
          proxyPolicy: 'direct',
        },
        startup: {
          local_ui_bridge_url: ready.bridge_url,
          local_ui_bridge_token: 'A'.repeat(43),
        },
        webSession: {
          fetch: async (url, options) => {
            const response = await fetch(url, options);
            if (!response.ok)
              console.error(
                'Fixture descriptor rejected:',
                response.status,
                await response.clone().text(),
              );
            return response;
          },
          cookies: { get: async () => [] },
        },
        codeSpaceID: 'native-smoke',
        signal,
      }),
    openExternal: async (url) => {
      entry = url;
    },
  });
  // A real system Chrome profile has no Electron request hook or injected authorization.
  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [`--redeven-browser-run=${marker}`],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(25_000);
  const failed = [],
    sockets = [];
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      response.url().startsWith(new URL(entry).origin)
    )
      failed.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
      });
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto(entry);
  await page.locator('.monaco-workbench').waitFor();
  const trust = page.getByRole('button', { name: /Yes, I trust/ });
  if (await trust.count()) await trust.click();
  await page
    .locator('.label-name')
    .getByText('native-smoke.txt', { exact: true })
    .dblclick();
  await page.waitForFunction(() =>
    document
      .querySelector('.monaco-editor .view-lines')
      ?.textContent.replaceAll('\u00a0', ' ')
      .includes('native editor smoke'),
  );
  await page.keyboard.insertText('saved through system browser ');
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+s' : 'Control+s',
  );
  const waitFile = async (name, text) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        if (
          (await readFile(path.join(ready.workspace, name), 'utf8')).includes(
            text,
          )
        )
          return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${name} did not contain ${text}`);
  };
  await waitFile('native-smoke.txt', 'saved through system browser');
  await page.keyboard.press('Control+Backquote');
  await page.waitForFunction(() => {
    for (const button of document.querySelectorAll('button,[role=button]')) {
      if (button.textContent.includes('Trust Folder & Continue'))
        button.click();
    }
    return document
      .querySelector('.xterm-accessibility-tree')
      ?.textContent.includes('redeven-smoke$');
  });
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(
    'printf system-browser-terminal-ok > native-terminal.txt',
    { delay: 5 },
  );
  await page.keyboard.press('Enter');
  await waitFile('native-terminal.txt', 'system-browser-terminal-ok');
  assert(sockets.length > 0, 'editor must establish native WebSockets');
  assert(
    !new URL(page.url()).searchParams.has('entry'),
    'entry must leave the address bar',
  );
  assert.equal(new URL(page.url()).searchParams.get('folder'), ready.workspace);
  assert(
    !(await page.evaluate(() => document.cookie)).includes(
      'redeven_codespace_browser=',
    ),
  );
  const cookies = await context.cookies();
  const authority = cookies.find(
    (cookie) => cookie.name === 'redeven_codespace_browser',
  );
  assert(authority?.httpOnly && authority.sameSite === 'Strict');
  assert.equal(authority.domain, new URL(entry).hostname);
  assert.equal(
    (await context.request.get(entry, { maxRedirects: 0 })).status(),
    401,
    'entry replay',
  );
  assert.equal(
    (
      await context.request.get(new URL('/api/local/agent', entry).href)
    ).status(),
    404,
    'no management API',
  );
  assert.equal(
    (await context.request.get(new URL('/cs/another/', entry).href)).status(),
    404,
    'no other CodeSpace',
  );
  const foreign = await browser.newContext();
  assert.equal(
    (await foreign.request.get(new URL('/', entry).href)).status(),
    401,
    'fresh browser requires handoff',
  );
  await foreign.close();
  // Reload demonstrates that root-relative resources retain authorization without a new entry.
  await page.reload();
  await page.locator('.monaco-workbench').waitFor();
  await page
    .locator('.label-name')
    .getByText('native-smoke.txt', { exact: true })
    .dblclick();
  await page.waitForFunction(() =>
    document
      .querySelector('.monaco-editor .view-lines')
      ?.textContent.replaceAll('\u00a0', ' ')
      .includes('saved through system browser'),
  );
  await page
    .locator('.label-name')
    .getByText('native-terminal.txt', { exact: true })
    .waitFor();
  assert.deepEqual(
    failed.filter((failure) => failure.status === 401),
    [],
    'editor requests must not encounter the original bridge rejection',
  );
  if (process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT) {
    await mkdir(process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT, {
      recursive: true,
    });
    await page.screenshot({
      path: path.join(
        process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT,
        'codespace-system-browser.png',
      ),
    });
    await writeFile(
      path.join(process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT, 'result.json'),
      JSON.stringify(
        {
          browser: await browser.version(),
          marker,
          fixture_pid: fixture.pid,
          ...ready,
          websocket_count: sockets.length,
          failed_requests: failed,
          checks: [
            'private bridge reproduces 401',
            'single-use handoff',
            'workspace with spaces',
            'file read/edit/save',
            'terminal execution',
            'reload',
            'HttpOnly scoped cookie',
            'replay rejection',
            'management and sibling resource denial',
            'fresh browser denial',
          ],
        },
        null,
        2,
      ),
    );
  }
  await sessions.close();
  await assert.rejects(
    context.request.get(new URL('/', entry).href),
    /ECONNREFUSED|ERR_CONNECTION_REFUSED/,
  );
  console.log(
    'System Chrome: private-bridge reproduction, authorized editor, save, terminal, reload and rejection/teardown checks passed.',
  );
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(
      'Browser failure state:',
      await page.locator('body').innerText(),
    );
    if (process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT) {
      await mkdir(process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT, {
        recursive: true,
      });
      await page.screenshot({
        path: path.join(
          process.env.REDEVEN_BROWSER_ACCEPTANCE_OUTPUT,
          'failure.png',
        ),
      });
    }
  }
  throw error;
} finally {
  clearTimeout(timer);
  await browser?.close();
  await sessions?.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null)
    fixture.kill('SIGTERM');
  try {
    if (fixtureExit) {
      const [code, signal] = await fixtureExit;
      assert.equal(
        code,
        0,
        `private bridge fixture must exit cleanly; signal=${signal}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
