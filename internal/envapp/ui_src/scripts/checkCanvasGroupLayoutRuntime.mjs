#!/usr/bin/env node
import { createDesktopTestSession } from '../../../../scripts/desktop_test_session.mjs';
/* global window, document, innerHeight */
// Qualify the actual Kubernetes regression through an isolated Runtime and
// optional Desktop. Only model output is scripted; all tools and UI are real.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, _electron } from 'playwright';
import { load as loadYAML } from 'js-yaml';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 180000,
});
await session.run(async () => {
  const [binary, outputArgument, desktopBundle] = process.argv.slice(2);
  assert(binary && outputArgument, 'Usage: <Runtime bundle binary> <evidence directory> [Desktop bundle]');
  const root = path.resolve(import.meta.dirname, '../../../..'),
    output = path.resolve(outputArgument);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'redeven-group-layout-')),
    state = path.join(temp, 'state');
  await session.directory(temp);
  await session.target(binary, state);
  const canvasID = 'kubernetes-group-layout',
    marker = randomUUID();
  const source = await readFile(path.join(root, 'internal/tessiven/testdata/kubernetes-group-layout.yaml'), 'utf8');
  const original = source.replace('redeven.io/tessiven/v1.1.0', 'redeven.io/tessiven/v1.0.0').replace(/ {2}groupLayouts:\n[\s\S]*$/, '');
  const fixture = loadYAML(source);
  const report = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    marker,
    state,
    scenarios: [],
    geometry: [],
    errors: [],
  };
  let app,
    welcome,
    runtime,
    browser,
    page,
    origin,
    runtimeLog = '',
    providerError;
  let commands = [],
    toolIndex = 0;
  async function until(read, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (providerError) throw providerError;
      if (runtime && (runtime.exitCode !== null || runtime.signalCode !== null)) throw new Error(runtimeLog);
      const result = await read();
      if (result) return result;
      await delay(50);
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function api(route, method = 'GET', body) {
    if (welcome) {
      const result = await welcome.evaluate((request) => window.redevenDesktopSettings.requestRuntimeFlower(request), {
        method,
        path: route,
        ...(body ? { body } : {}),
      });
      assert(result.ok, JSON.stringify(result));
      return result.data;
    }
    const response = await fetch(new URL(route, origin), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: new URL(origin).origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200, route);
    const result = await response.json();
    assert.notEqual(result.ok, false, JSON.stringify(result));
    return result.data ?? result;
  }
  const latest = () => api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/latest`);
  const provider = http.createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw);
      report.tool_results ??= [];
      for (const item of input.input ?? [])
        if (item.type === 'function_call_output')
          if (!report.tool_results.some((result) => result.call_id === item.call_id)) report.tool_results.push(item);
      response.setHeader('Content-Type', 'text/event-stream');
      const send = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
      const command = input.tools?.some((tool) => tool.name === 'tessiven_edit') ? commands.shift() : undefined;
      const item = command
        ? {
            type: 'function_call',
            id: `tool-${++toolIndex}`,
            call_id: `tool-${toolIndex}`,
            name: command.name,
            arguments: JSON.stringify(command.arguments),
          }
        : {
            type: 'message',
            id: 'reply',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Updated the node pool layout and preserved its peer relationships.',
              },
            ],
          };
      send({ type: 'response.output_item.added', output_index: 0, item });
      if (!command)
        send({
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: item.content[0].text,
        });
      send({ type: 'response.output_item.done', output_index: 0, item });
      send({
        type: 'response.completed',
        response: {
          id: `response-${randomUUID()}`,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 30, output_tokens: 20 },
        },
      });
      response.end('data: [DONE]\n\n');
    } catch (error) {
      providerError = error;
      response.destroy();
    }
  });
  async function ready() {
    await page.locator('[data-node-id="n-etcd-1"]').waitFor();
    await until(
      async () => (await page.getByRole('status', { name: 'Arranging canvas', exact: true }).count()) === 0,
      'finished graph layout',
    );
  }
  async function geometry(flow, limit = 3) {
    await ready();
    const boxes = await page.locator('.tessiven-node[data-group-id="g-etcd"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { id: node.dataset.nodeId, x, y, width, height };
      }),
    );
    assert.equal(boxes.length, 3);
    const close = (a, b) => Math.abs(a - b) < 0.1;
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1],
        b = boxes[i];
      if (i % limit) {
        assert(close(flow === 'row' ? a.y : a.x, flow === 'row' ? b.y : b.x), 'same line');
        assert(flow === 'row' ? a.x + a.width < b.x : a.y + a.height < b.y, 'member spacing');
      } else assert(flow === 'row' ? b.y > a.y + a.height : b.x > a.x + a.width, 'line wraps');
    }
    for (const [from, to] of [
      [1, 2],
      [2, 3],
      [3, 1],
    ])
      assert.equal(await page.locator(`[data-graph-object="n-etcd-${from}/n-etcd-${to}"]`).count(), 1, 'peer edge retained');
    const group = await page.locator('[data-graph-object="g-etcd"]').boundingBox();
    for (const box of boxes)
      assert(
        box.x >= group.x &&
          box.y >= group.y &&
          box.x + box.width <= group.x + group.width + 0.1 &&
          box.y + box.height <= group.y + group.height + 0.1,
        'node inside pool',
      );
    assert.equal(await page.locator('.tessiven-error').count(), 0);
    report.geometry.push({ flow, limit, boxes });
    return boxes;
  }
  async function edit(oldString, newString, version, flow, limit) {
    commands = [
      {
        name: 'tessiven_read',
        arguments: { canvas_id: canvasID, start_line: 1, line_count: 20 },
      },
      {
        name: 'tessiven_edit',
        arguments: {
          canvas_id: canvasID,
          expected_version: version,
          request_id: `layout-${version}`,
          summary: `Use ${flow} packing`,
          edits: [
            ...(version === 1
              ? [
                  {
                    old_string: 'apiVersion: redeven.io/tessiven/v1.0.0',
                    new_string: 'apiVersion: redeven.io/tessiven/v1.1.0',
                  },
                ]
              : []),
            { old_string: oldString, new_string: newString },
          ],
        },
      },
    ];
    await page
      .locator('.flower-composer textarea')
      .fill(`Arrange the etcd node pool in ${flow} flow, with at most ${limit} members per line. Preserve all peer relationships.`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const current = await until(async () => {
      const approval = page.locator('.flower-approval-decision-approve:not([disabled])').first();
      if ((await approval.count()) && (await approval.isVisible())) await approval.click();
      const value = await latest();
      return value.number === version + 1 ? value : null;
    }, 'saved partial layout edit');
    await until(() => page.locator('[data-flower-selected-thread-status="success"]').count(), 'completed Flower turn');
    assert.equal(commands.length, 0, 'Flower used Read and Edit');
    assert.deepEqual(current.document.relations, fixture.relations);
    assert.deepEqual(current.document.nodes, fixture.nodes);
    assert.equal(current.document.presentation.direction, 'DOWN');
    assert.deepEqual(current.document.presentation.groupLayouts['g-etcd'], {
      flow,
      maxPerLine: limit,
    });
    await geometry(flow, limit);
  }
  try {
    await mkdir(output, { recursive: true });
    const library = path.join(state, 'local-environment/apps/tessiven/canvases.sqlite');
    await mkdir(path.dirname(library), { recursive: true });
    const db = new DatabaseSync(library);
    try {
      db.exec(await readFile(path.join(root, 'internal/tessiven/testdata/schema_v1.sql'), 'utf8'));
      db.prepare('INSERT INTO canvases VALUES(?,?,?,1,0,100,100)').run(canvasID, fixture.metadata.title, '');
      db.prepare('INSERT INTO versions VALUES(?,1,?,?,100,?,?)').run(
        canvasID,
        original,
        createHash('sha256').update(original).digest('hex'),
        'import',
        'Historical Kubernetes canvas',
      );
    } finally {
      db.close();
    }
    if (desktopBundle) {
      execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
      const require = createRequire(path.join(root, 'desktop/package.json'));
      const manifest = JSON.parse(await readFile(path.join(desktopBundle, 'desktop-bundle-manifest.json'), 'utf8'));
      assert(report.commit.startsWith(manifest.commit), 'Runtime bundle belongs to this source commit');
      app = await session.launchElectron(_electron, {
        executablePath: require('electron'),
        cwd: temp,
        args: [path.join(root, 'desktop'), `--user-data-dir=${temp}/profile`, `--redeven-test-launch-id=${marker}`],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          REDEVEN_STATE_ROOT: state,
          REDEVEN_DESKTOP_USER_DATA_ROOT: `${temp}/profile`,
          REDEVEN_DESKTOP_CACHE_ROOT: `${temp}/cache`,
          REDEVEN_DESKTOP_TEMP_ROOT: `${temp}/temp`,
          REDEVEN_DESKTOP_AUTO_START_RUNTIME: '1',
          REDEVEN_DESKTOP_OPEN_DEVTOOLS: '0',
          REDEVEN_DESKTOP_LOCAL_UI_BIND: '127.0.0.1:0',
          REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT: desktopBundle,
          REDEVEN_DESKTOP_BUNDLE_VERSION: manifest.version,
          REDEVEN_DESKTOP_BUNDLE_COMMIT: manifest.commit,
        },
      });
      report.pid = app.process().pid;
      assert.equal(
        Number(
          execFileSync('ps', ['-o', 'pgid=', '-p', String(report.pid)], {
            encoding: 'utf8',
          }).trim(),
        ),
        report.pid,
        'Own dedicated Electron process group',
      );
      welcome = await app.firstWindow();
      await welcome.waitForFunction(() => Boolean(window.redevenDesktopSettings && window.redevenDesktopLanguage));
      await welcome.evaluate(() => window.redevenDesktopLanguage.setPreference('en-US'));
      await until(
        async () =>
          (
            await welcome.evaluate(() =>
              window.redevenDesktopSettings.requestRuntimeFlower({
                method: 'GET',
                path: '/_redeven_proxy/api/ai/threads',
              }),
            )
          ).ok,
        'Desktop runtime ready',
        60000,
      );
      await welcome
        .getByRole('button', { name: /^(Open|Show) Env App$/ })
        .first()
        .click({ timeout: 60000 });
      const environment = await until(
        () =>
          app
            .context()
            .pages()
            .find((candidate) => candidate.url().includes('/_redeven_proxy/env/')),
        'owned Env App',
      );
      const opened = await environment.evaluate((request) => window.redevenDesktopShell.openServiceCanvasWindow(request), {
        canvas_id: canvasID,
      });
      assert.deepEqual(opened, { ok: true }, 'Session-authorized standalone window');
      page = await until(
        () =>
          app
            .context()
            .pages()
            .find((candidate) => new URL(candidate.url()).searchParams.get('canvas') === canvasID),
        'owned standalone canvas',
      );
    } else {
      const staged = path.join(temp, 'redeven');
      await copyFile(binary, staged);
      for (const name of [
        'redevplugin-runtime',
        '.redevplugin-release-artifacts-verified.json',
        'REDEVPLUGIN_RUNTIME.spdx.json',
        'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
        'redevplugin-runtime.provenance.json',
        'redevplugin-runtime.sig',
        'redevplugin-runtime.pem',
      ])
        await copyFile(path.join(path.dirname(binary), name), path.join(temp, name));
      const startup = path.join(temp, 'startup.json');
      runtime = await session.spawn(
        staged,
        [
          'run',
          '--mode',
          'local',
          '--state-root',
          state,
          '--local-ui-bind',
          '127.0.0.1:0',
          '--presentation',
          'machine',
          '--startup-report-file',
          startup,
        ],
        { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] },
        { kind: 'service' },
      );
      runtime.stdout.on('data', (chunk) => {
        runtimeLog += chunk;
      });
      runtime.stderr.on('data', (chunk) => {
        runtimeLog += chunk;
      });
      origin = (
        await until(
          async () => {
            try {
              return JSON.parse(await readFile(startup, 'utf8'));
            } catch {
              return null;
            }
          },
          'Runtime ready',
          60000,
        )
      ).local_ui_url;
      report.runtime = { pid: runtime.pid, origin, state };
      browser = await session.launchBrowser(chromium, { headless: true });
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

      await page.goto(new URL(`/_redeven_proxy/env/?surface=tessiven&window=service-canvas&canvas=${canvasID}`, origin).href);
    }
    report.url = page.url();
    page.on('pageerror', (error) => report.errors.push(error.message));
    await ready();
    assert.equal(
      await page.locator('[data-floe-shell-slot], [data-workbench-dock-action]').count(),
      0,
      'Standalone window has no Env App frame',
    );
    const baseline = await latest();
    assert.equal(baseline.dsl_version, 'v1.0.0');
    assert.equal(baseline.document.apiVersion, 'redeven.io/tessiven/v1.1.0');
    assert.equal(baseline.document_yaml, original);
    assert.equal(baseline.migrations.length, 1);
    report.scenarios.push('historical-v1.0.0-startup-with-immutable-yaml');
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    await session.port(provider.address().port);
    await session.defer('provider connections', () => provider.closeAllConnections?.(), { phase: 'release' });
    await session.defer(
      'provider',
      () =>
        new Promise((resolve, reject) =>
          provider.close((error) => (error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())),
        ),
    );
    await api('/_redeven_proxy/api/ai/provider_bundle', 'PUT', {
      model_profile: {
        current_model_id: 'fixture/gpt-5-mini',
        providers: [
          {
            id: 'fixture',
            name: 'Acceptance',
            type: 'openai',
            base_url: `http://127.0.0.1:${provider.address().port}/v1`,
            models: [
              {
                model_name: 'gpt-5-mini',
                input_modalities: ['text'],
                context_window: 400000,
                max_output_tokens: 8192,
              },
            ],
          },
        ],
      },
      provider_api_key_patches: [{ provider_id: 'fixture', api_key: 'fixture-only' }],
      web_search_provider_key_patches: [],
    });
    await page.reload();
    await ready();
    const rule = '  groupLayouts:\n    g-etcd:\n      flow: row\n      maxPerLine: 3\n';
    await edit('    - [res-registry, res-storage]\n', `    - [res-registry, res-storage]\n${rule}`, 1, 'row', 3);
    await page.screenshot({
      path: path.join(output, 'kubernetes-row.png'),
      animations: 'disabled',
    });
    await edit('flow: row', 'flow: column', 2, 'column', 3);
    await edit('flow: column\n      maxPerLine: 3', 'flow: row\n      maxPerLine: 2', 3, 'row', 2);
    await page.screenshot({
      path: path.join(output, 'kubernetes-wrap.png'),
      animations: 'disabled',
    });
    await edit('maxPerLine: 2', 'maxPerLine: 3', 4, 'row', 3);
    report.scenarios.push('flower-read-edit-row-column-wrap-preserves-peer-cycle');
    await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
    const visible = await page.locator('.tessiven-node').count();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'View', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).click();
      await until(async () => (await page.locator('.tessiven-node').count()) === 0, 'compact collapse');
      await page.getByRole('button', { name: 'View', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Expand all', exact: true }).click();
      await until(async () => (await page.locator('.tessiven-node').count()) === visible, 'compact expansion');
      await geometry('row');
    }
    report.scenarios.push('repeated-compact-collapse-expand');
    if (app) {
      for (const [mode, preset] of [
        ['light', 'porcelain-light'],
        ['dark', 'porcelain-dark'],
        ['light', 'hc-light'],
      ]) {
        await welcome.evaluate(
          async ({ mode, preset }) => {
            await window.redevenDesktopTheme.setShellTheme(mode, preset);
            await window.redevenDesktopTheme.setSource(mode);
          },
          { mode, preset },
        );
        await page.waitForFunction(
          ({ mode, preset }) =>
            document.documentElement.classList.contains('dark') === (mode === 'dark') &&
            document.documentElement.dataset.floeShellTheme === preset &&
            !document.documentElement.dataset.redevenThemeSwitching,
          { mode, preset },
        );
        await geometry('row');
        await page.screenshot({
          path: path.join(output, `desktop-${preset}.png`),
          animations: 'disabled',
        });
      }
      await app.evaluate(({ BrowserWindow }, url) => {
        const target = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL() === url);
        target.setMinimumSize(600, 320);
        target.setContentSize(800, 420);
      }, page.url());
      await page.waitForFunction(() => innerHeight <= 420);
    } else await page.setViewportSize({ width: 800, height: 420 });
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await geometry('row');
    await page.screenshot({
      path: path.join(output, 'short-window.png'),
      animations: 'disabled',
    });
    report.scenarios.push('narrow-short-window');
    await page.reload();
    await ready();
    await geometry('row');
    const history = await api(`/_redeven_proxy/api/tessiven/canvases/${canvasID}/versions/1`);
    assert.equal(history.document_yaml, original);
    assert.equal(history.digest, baseline.digest);
    assert.equal((await latest()).document.apiVersion, 'redeven.io/tessiven/v1.1.0');
    assert.deepEqual(report.errors, []);
    report.scenarios.push('refresh-keeps-rules-and-original-history');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack;
    process.exitCode = 1;
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
      await writeFile(
        path.join(output, 'failure.txt'),
        await page
          .locator('body')
          .innerText()
          .catch(() => ''),
      );
    }
  } finally {
    await session.closeBrowser(browser);

    await writeFile(path.join(output, 'runtime.log'), runtimeLog);
    await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report));
});
