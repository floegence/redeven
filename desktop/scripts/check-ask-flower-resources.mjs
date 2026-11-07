import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import { findDeepSeekProvider } from '../../scripts/smoke_flower_deepseek.mjs';
import { installReDevPluginRuntimeFixture } from '../../internal/envapp/ui_src/scripts/redevpluginRuntimeFixture.mjs';

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
for (const name of ['--binary', '--output', '--provider-source'])
  if (!process.argv.includes(name)) throw new Error(`Required ${name}`);
const binary = path.resolve(argument('--binary'));
const output = path.resolve(argument('--output'));
const providerSource = path.resolve(argument('--provider-source'));
const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 600000,
  actionMs: 30000,
});
const waitFor = async (read, label, timeout = 120000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`${label} timed out`);
};
const strings = (value) =>
  typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
await session.run(async () => {
  await mkdir(output, { recursive: true });
  const sourceFiles = ['config.json', 'secrets.json'];
  const sourceBytes = await Promise.all(sourceFiles.map((file) => readFile(path.join(providerSource, file))));
  const sourceHashes = sourceBytes.map((bytes) => createHash('sha256').update(bytes).digest('hex'));
  const selected = findDeepSeekProvider(...sourceBytes.map((bytes) => JSON.parse(bytes)), {
    model: 'deepseek-flash',
    requireConfigured: true,
  });
  const upstream = new URL(selected.provider.base_url);
  assert.equal(upstream.protocol, 'https:');
  const calls = [];
  const observations = [];
  let phase = 'setup';
  let proxyError;
  // Transparent transport: real model decides every call. Never replace its output.
  const proxy = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const payload = JSON.parse(body.toString());
      observations.push({
        phase,
        model: payload.model,
        toolCount: payload.tools?.length ?? 0,
        references: strings(payload.input).filter((text) => text.includes('resource_kind:')),
      });
      const target = new URL(upstream.href.replace(/\/$/u, '') + request.url);
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${selected.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(120000),
      });
      response.writeHead(upstreamResponse.status, {
        'Content-Type': upstreamResponse.headers.get('content-type') || 'text/event-stream',
      });
      let pending = '';
      const decoder = new TextDecoder();
      const seen = new Set();
      for await (const bytes of upstreamResponse.body) {
        response.write(bytes);
        pending += decoder.decode(bytes, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: {')) continue;
          const event = JSON.parse(line.slice(6));
          const items =
            event.type === 'response.output_item.done'
              ? [event.item]
              : event.type === 'response.completed'
                ? (event.response?.output ?? [])
                : [];
          for (const item of items)
            if (item.type === 'function_call' && !seen.has(item.call_id)) {
              seen.add(item.call_id);
              calls.push({
                phase,
                name: item.name,
                arguments: JSON.parse(item.arguments),
                callID: item.call_id,
              });
            }
        }
      }
      response.end();
    } catch (error) {
      proxyError = error.message;
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  await session.port(proxy.address().port);
  await session.defer('Real-model transport', async () => {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  });
  const state = await session.directory(await realpath(await mkdtemp(path.join(os.tmpdir(), 'redeven-ask-resource-'))));
  await installReDevPluginRuntimeFixture(state);
  await copyFile(binary, path.join(state, 'redeven'));
  const workspace = path.join(state, 'workspace');
  await mkdir(workspace);
  await mkdir(path.join(state, 'state/local-environment'), { recursive: true });
  await writeFile(
    path.join(state, 'state/local-environment/config.json'),
    JSON.stringify({
      runtime_config_version: 1,
      agent_home_dir: workspace,
      shell: '/bin/sh',
      permission_policy: {
        schema_version: 1,
        local_max: { read: true, write: true, execute: true },
      },
    }),
    { mode: 0o600 },
  );
  const startupFile = path.join(state, 'startup.json');
  const runtime = await session.spawn(
    path.join(state, 'redeven'),
    [
      'run',
      '--mode',
      'desktop',
      '--state-root',
      path.join(state, 'state'),
      '--local-ui-bind',
      '127.0.0.1:0',
      '--local-ui-protocol',
      'http',
      '--presentation',
      'machine',
      '--startup-report-file',
      startupFile,
    ],
    {
      cwd: state,
      env: { ...process.env, GOWORK: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    { kind: 'service' },
  );
  // The native stop command owns identity checks and bounded forced cleanup.
  // Its full 5-second grace period needs more than a 5-second process budget.
  await session.defer('Stop isolated Runtime', async () => {
    const target = path.join(state, 'state');
    const inventory = JSON.parse(
      execFileSync(binary, ['desktop-target-process-inventory', '--target-root', target], {
        encoding: 'utf8',
        timeout: 20000,
      }),
    );
    const stopped = JSON.parse(
      execFileSync(
        binary,
        [
          'desktop-target-process-stop',
          '--target-root',
          target,
          '--expected-inventory-digest',
          inventory.inventory_digest,
          '--grace-period',
          '5s',
        ],
        { encoding: 'utf8', timeout: 20000 },
      ),
    );
    assert.equal(stopped.after.instances.length, 0);
    await writeFile(path.join(output, 'runtime-cleanup.json'), JSON.stringify(stopped, null, 2));
  });
  await session.target(binary, path.join(state, 'state'));
  let logs = '';
  runtime.stdout.on('data', (bytes) => {
    logs += bytes;
    process.stdout.write(bytes);
  });
  runtime.stderr.on('data', (bytes) => {
    logs += bytes;
    process.stderr.write(bytes);
  });
  const startup = await waitFor(async () => {
    try {
      const value = JSON.parse(await readFile(startupFile));
      return value.status === 'ready' && value;
    } catch {
      if (runtime.exitCode !== null) throw new Error(logs);
      return null;
    }
  }, 'Runtime readiness');
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(new URL('/_redeven_proxy/api/' + route, startup.local_ui_url), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: new URL(startup.local_ui_url).origin,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    assert.ok(response.ok && value.ok !== false, `${route}: ${JSON.stringify(value)}`);
    return value.data ?? value;
  };
  await api('ai/provider_bundle', 'PUT', {
    model_profile: {
      current_model_id: selected.currentModelID,
      providers: [
        {
          ...selected.provider,
          base_url: `http://127.0.0.1:${proxy.address().port}`,
          web_search: { enabled: false, source: 'native' },
        },
      ],
    },
    provider_api_key_patches: [{ provider_id: selected.provider.id, api_key: 'isolated-proxy-only' }],
    web_search_provider_key_patches: [],
  });
  await api('ai/default_permission', 'PUT', { permission_type: 'readonly' });
  const managed = [];
  const waitOperation = async (id) => {
    const response = await fetch(
      new URL(`/_redeven_proxy/api/managed-web-service-operations/${id}/events`, startup.local_ui_url),
      { signal: AbortSignal.timeout(120000) },
    );
    assert.ok(response.ok);
    let pending = '';
    const decoder = new TextDecoder();
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines)
        if (line.startsWith('data: ')) {
          const op = JSON.parse(line.slice(6));
          if (['failed', 'cancelled', 'interrupted'].includes(op.state)) throw new Error(JSON.stringify(op));
          if (op.state === 'succeeded') return;
        }
    }
    throw new Error('Operation ended without terminal success');
  };
  await session.defer(
    'Stop exact fixture services',
    async () => {
      for (const id of managed) {
        const op = await api(`managed-web-services/${id}/operations`, 'POST', {
          request_id: `stop-${id}`,
          action: 'stop',
        });
        await waitOperation(op.operation_id);
      }
    },
    { phase: 'release' },
  );
  const index = JSON.parse(
    execFileSync('docker', ['buildx', 'imagetools', 'inspect', 'node:26.7.0-bookworm', '--raw'], { encoding: 'utf8' }),
  );
  const platform = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const digest = index.manifests.find(
    (item) => item.platform.os === 'linux' && item.platform.architecture === platform,
  )?.digest;
  assert.ok(digest);
  const image = `node:26.7.0-bookworm@${digest}`;
  const server =
    "require('http').createServer((q,s)=>s.end('Ask Flower acceptance fixture')).listen(Number(process.env.REDEVEN_SERVICE_PORT||8080),'0.0.0.0')";
  await mkdir(path.join(workspace, 'host'));
  const hostScript = path.join(workspace, 'host/server.cjs');
  await writeFile(hostScript, server);
  const serviceIDs = {};
  for (const deployment of ['host', 'container']) {
    const spec = {
      schema_version: 7,
      kind: deployment,
      endpoint: {
        scheme: 'http',
        path: '/',
        health_path: '/',
        ...(deployment === 'container' ? { container_port: 8080 } : {}),
      },
      ...(deployment === 'host'
        ? {
            host: {
              start_script: `exec '${process.execPath}' '${hostScript}'`,
            },
          }
        : {
            container: {
              image,
              command: ['node', '-e', server],
              read_only_root: true,
            },
          }),
    };
    const template = await api('managed-web-service-templates', 'POST', {
      request_id: `template-${deployment}`,
      name: `Harness ${deployment} fixture`,
      description: `Node.js HTTP acceptance service returning the fixed text Ask Flower acceptance fixture; ${deployment} deployment.`,
      spec,
    });
    await mkdir(path.join(workspace, deployment), { recursive: true });
    const req = {
      request_id: `install-${deployment}`,
      template_id: template.template_id,
      deployment,
      workspace_path: path.join(workspace, deployment),
      access_mode: 'unified_proxy',
    };
    const plan = await api('managed-web-services/install-plans', 'POST', req);
    const created = await api('managed-web-services', 'POST', {
      ...req,
      workspace_path: plan.workspace_path,
      plan_digest: plan.plan_digest,
    });
    serviceIDs[deployment] = created.service.service_id;
    managed.push(created.service.service_id);
    if (deployment === 'container') {
      await session.defer('Remove owned fixture container', async () => {
        const ids = execFileSync(
          'docker',
          ['ps', '-aq', '--filter', `label=com.floegence.redeven.managed-web-service=${created.service.service_id}`],
          { encoding: 'utf8' },
        )
          .trim()
          .split('\n')
          .filter(Boolean);
        for (const id of ids) execFileSync('docker', ['rm', '-f', id], { stdio: 'pipe' });
      });
    }
    await waitOperation(created.operation.operation_id);
  }
  const manual = await api('forwards', 'POST', {
    target: 'http://127.0.0.1:1',
    name: 'Harness host fixture',
    description: 'Manually added address',
    access_mode: 'unified_proxy',
  });
  const entryFile = path.join(state, 'main.cjs');
  await writeFile(
    entryFile,
    `const {app,BrowserWindow}=require('electron');
    app.whenReady().then(()=>{const window=new BrowserWindow({width:1440,height:1000,useContentSize:true,webPreferences:{contextIsolation:true,sandbox:true}});window.loadURL('about:blank');});
    app.on('window-all-closed',()=>app.quit());`,
  );
  const browser = await session.launchElectron(_electron, {
    executablePath: electron,
    args: [entryFile, `--user-data-dir=${state}/profile`],
    cwd: state,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const page = await browser.firstWindow();
  page.setDefaultTimeout(20000);
  await page.addInitScript(() => {
    localStorage.setItem('redeven_ui_language_preference', 'en-US');
    localStorage.setItem('redeven_envapp_active_tab', 'ports');
    localStorage.setItem(
      'redeven-envapp:env_local-activity-navigation',
      JSON.stringify({
        version: 1,
        target: { kind: 'builtin', page: 'ports' },
        recentBuiltins: ['ports'],
      }),
    );
  });
  const report = {
    status: 'running',
    model: 'deepseek-flash',
    realProvider: true,
    binarySHA256: createHash('sha256')
      .update(await readFile(binary))
      .digest('hex'),
    cases: [],
    calls,
    observations,
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  try {
    await page.goto(startup.local_ui_url);
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    const navigate = () =>
      page.getByRole('button', { name: 'Web Services', exact: true }).filter({ visible: true }).last().click();
    const card = page.locator('[data-floe-prompt-card]');
    for (const scenario of ['host', 'container', 'manual', 'host-live']) {
      phase = scenario;
      await navigate();
      const id = scenario === 'manual' ? manual.forward_id : serviceIDs[scenario === 'host-live' ? 'host' : scenario];
      const row = page.locator(
        scenario === 'manual' ? `[data-forward-id="${id}"]` : `[data-managed-service-id="${id}"]`,
      );
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
      await card.waitFor();
      await card.locator('.flower-composer-context-source').first().click();
      const preview = page.locator('.flower-context-preview-window');
      const text = preview.locator('[data-flower-context-preview-text]');
      await text.waitFor();
      const context = await text.textContent();
      assert.ok(context.includes(id));
      assert.ok(context.includes(scenario === 'manual' ? 'resource_kind: port_forward' : `binding.resourceId: ${id}`));
      if (scenario !== 'manual')
        assert.ok(context.includes(`deployment: ${scenario === 'host-live' ? 'host' : scenario}`));
      await page.screenshot({
        path: path.join(output, `${scenario}-reference.png`),
      });
      await preview.locator('[data-floe-floating-window-control="close"]').click();
      await preview.waitFor({ state: 'hidden' });
      const before = new Set((await api('ai/threads?limit=100')).threads.map((item) => item.thread_id));
      const question = scenario === 'host-live' ? '请核实这个服务现在的运行状态和监听端口。' : '这是什么';
      await card.locator('textarea').fill(question);
      const start = Date.now();
      await card.locator('.floe-prompt-card-submit').click();
      const thread = await waitFor(async () => {
        const fresh = (await api('ai/threads?limit=100')).threads.filter((item) => !before.has(item.thread_id));
        assert.ok(fresh.length <= 1);
        return fresh[0];
      }, 'New task');
      const detail = await waitFor(
        async () => {
          assert.ok(!proxyError, proxyError);
          const value = await api(`ai/threads/${thread.thread_id}`);
          assert.notEqual(value.current.last_outcome, 'failed', JSON.stringify(value.current.error));
          return value.current.activity === 'idle' && value.current.last_outcome === 'completed' && value;
        },
        'Flower answer',
        180000,
      );
      const finalIDs = new Set(detail.current.turns.flatMap((turn) => turn.final_item_ids ?? []));
      const answers = [];
      for (const item of detail.current.items.filter((item) => finalIDs.has(item.id))) {
        let text = item.text ?? '';
        const body = item.body;
        let offset = Buffer.byteLength(text);
        while (body && offset < body.bytes) {
          const chunk = await api(`ai/threads/${thread.thread_id}/history-body`, 'POST', {
            item_id: item.id,
            source_id: body.source_id,
            run_id: body.run_id,
            entry_id: body.entry_id,
            field: body.field,
            through_bytes: body.bytes,
            offset_bytes: offset,
          });
          assert.ok(!chunk.source_changed && chunk.text.length > 0);
          text += chunk.text;
          offset += Buffer.byteLength(chunk.text);
        }
        answers.push(text);
      }
      const answer = answers.join('\n');
      assert.ok(answer.length > 20);
      if (scenario === 'manual') {
        assert.ok(answer.includes('127.0.0.1:1'));
        for (const serviceID of Object.values(serviceIDs)) assert.ok(!answer.includes(serviceID));
      } else {
        const deployment = scenario === 'host-live' ? 'host' : scenario;
        assert.match(answer, deployment === 'host' ? /host|宿主|主机/u : /container|容器/u);
        assert.ok(
          answer.includes(context.match(/^runtime_port: (\d+)/m)[1]),
          'Answer must identify the referenced port',
        );
      }

      report.cases.push({
        scenario,
        threadID: thread.thread_id,
        question,
        context,
        answer,
        elapsedMs: Date.now() - start,
      });
      assert.ok(
        strings(detail.current.items.filter((item) => item.kind === 'user')).some((value) => value.includes(context)),
        'Preview equals canonical submitted reference',
      );
      const scenarioCalls = calls.filter((call) => call.phase === scenario);
      if (scenario === 'manual')
        assert.ok(
          !scenarioCalls.some((call) => call.name.startsWith('tessiven_')),
          'A manual address must not be substituted with a same-name managed resource',
        );
      for (const call of scenarioCalls.filter((call) =>
        ['find', 'read_file', 'list_files', 'grep'].includes(call.name),
      )) {
        const target = call.arguments.root ?? call.arguments.path;
        const expected = path.join(workspace, scenario === 'host-live' ? 'host' : scenario);
        assert.ok(
          target && (target === expected || target.startsWith(expected + path.sep)),
          'Do not widen a resource explanation to surrounding directories',
        );
      }
      assert.ok(
        !scenarioCalls.some((call) => /terminal|tessiven_list|tessiven_read|tessiven_search/u.test(call.name)),
        'Explanation must not explore unrelated files or canvases',
      );
      for (const call of scenarioCalls.filter((call) => call.name === 'tessiven_inspect')) {
        assert.equal(call.arguments.runtime_ref, 'local:local');
        assert.ok(['inspect', 'logs', 'operation'].includes(call.arguments.action));
        assert.equal(call.arguments.binding?.owner, 'managed_service');
        assert.equal(call.arguments.binding?.resourceId, id);
        assert.ok(!call.arguments.canvas_id && !call.arguments.instance_id);
      }
      if (scenario === 'host-live')
        assert.ok(
          scenarioCalls.some((call) => call.name === 'tessiven_inspect'),
          'Live status must be checked',
        );
      assert.ok(
        observations.some(
          (item) =>
            item.phase === scenario &&
            item.references.some(
              (value) => value.includes(context) || value.includes(JSON.stringify(context).slice(1, -1)),
            ),
        ),
        'Exact reference reaches real model',
      );
      await card.waitFor({ state: 'hidden' });
      const normalize = (text) => text.replace(/[^\p{L}\p{N}]/gu, '');
      const tail = normalize(answer).slice(-45);
      await waitFor(
        async () => normalize(await page.locator('body').innerText()).includes(tail),
        'Complete rendered answer',
      );
      const screenshotName = `${scenario}-answer.png`;
      await page.screenshot({ path: path.join(output, screenshotName) });
      Object.assign(report.cases.at(-1), {
        previewEqualsSubmission: true,
        answerVisible: true,
      });
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`PASS ${scenario}: real model completed in ${Date.now() - start}ms, ${scenarioCalls.length} calls`);
    }
    const after = await Promise.all(sourceFiles.map((file) => readFile(path.join(providerSource, file))));
    assert.deepEqual(
      after.map((bytes) => createHash('sha256').update(bytes).digest('hex')),
      sourceHashes,
    );
    report.sourceUnchanged = true;
    report.status = 'passed';
  } catch (error) {
    report.error = error.stack;
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await session.writeEvidence(path.join(output, 'report.json'), report);
  }
});
