import { createDesktopTestSession } from '../../scripts/desktop_test_session.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { _electron } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';
import {
  createBuiltDistServer,
  createBuiltDistTLS,
  trustBuiltDistWebTransport,
} from '../../internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs';

const session = await createDesktopTestSession(import.meta.url, {
  timeoutMs: 180000,
});
await session.run(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = path.join(root, 'desktop/dist/flower-media-acceptance');
  execFileSync(path.join(root, 'scripts/check_desktop_electron_test_runtime.sh'), [path.join(root, 'desktop')], { stdio: 'inherit' });
  await mkdir(output, { recursive: true });
  const state = await mkdtemp(path.join(tmpdir(), 'redeven-flower-media-'));
  await session.directory(state);
  const tls = await createBuiltDistTLS();
  await session.defer('TLS fixture', () => tls.cleanup());
  const server = await createSSHSettingsPreviewServer(0, ['flower-navigation.html']);
  const previewServer = await session.defer('preview server', () => server.close());
  await session.port(new URL(server.resolvedUrls.local[0]).port);
  await server.watcher.close();
  const report = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDiff: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).trim(),
    floe: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version,
    state,
    marker: randomUUID(),
    url: server.resolvedUrls.local[0],
    errors: [],
    status: 'running',
  };
  let child;
  let browser;
  let page;
  let envServer;
  const html =
    '<h1>Daily brief</h1><input aria-label="Reading note"><button onclick="this.textContent=\'Updated\'">Update report</button><a href="#economy">Economy</a><a href="https://example.com/news">News source</a><a href="javascript:alert(1)">Unsupported link</a><section id="economy" style="margin-top:1200px">Economy section</section>';

  async function qualifyHtmlGeneration(surface, publish) {
    const canvas = page.locator('.chat-html-canvas');
    const prefix = 'Here is the workspace preview.\n\n![Workspace](computer://browser-main/' + 'a'.repeat(64) + ')\n\n';
    const fence = '```html preview\n';
    await publish(prefix + fence + html.slice(0, 16), true);
    await page.waitForFunction(() => document.querySelector('.chat-html-canvas')?.dataset.state === 'generating');
    const original = await canvas.elementHandle();
    const height = (await canvas.boundingBox()).height;
    assert.equal(await canvas.locator('.chat-html-skeleton').count(), 0);
    assert.equal(await canvas.locator('iframe').count(), 0);
    assert.equal(await canvas.locator('.chat-html-sheet').isVisible(), false);
    const status = canvas.locator('.chat-html-loading [data-floe-progress-shimmer=text]');
    await status.waitFor();
    assert.equal(await status.textContent(), 'Creating preview…');
    assert.equal(await status.evaluate((element) => getComputedStyle(element).animationName), 'floe-progress-shimmer');
    assert.equal(
      await canvas.locator('.chat-html-sheen').evaluate((element) => getComputedStyle(element).animationName),
      'chat-html-sweep',
    );
    for (const width of [1240, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await canvas.scrollIntoViewIfNeeded();
      const bounds = await canvas.boundingBox();
      const text = await status.boundingBox();
      assert.ok(Math.abs(text.x + text.width / 2 - bounds.x - bounds.width / 2) < 1);
      assert.ok(Math.abs(text.y + text.height / 2 - bounds.y - bounds.height / 2) < 1);
      assert.equal(await canvas.evaluate((element) => getComputedStyle(element).borderWidth), '0px');
      await page.screenshot({ path: path.join(output, surface + '-html-generating-' + width + '.png') });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await status.evaluate((element) => getComputedStyle(element).animationName), 'none');
    assert.equal(await canvas.locator('.chat-html-sheen').evaluate((element) => getComputedStyle(element).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1240, height: 900 });
    await publish(prefix + fence + html + '\n```', true);
    await canvas.locator('iframe').waitFor();
    assert.equal(await canvas.evaluate((element, original) => element === original, original), true);
    assert.equal((await canvas.boundingBox()).height, height);
    assert.equal(await canvas.locator('.chat-html-loading').count(), 0);
    await publish(prefix + fence + html + '\n```', false);
    await canvas.locator('iframe').waitFor();
    return {
      noSkeleton: true,
      centered: true,
      textShimmer: true,
      dottedSheen: true,
      borderless: true,
      reducedMotion: true,
      stableCompletion: true,
    };
  }

  async function qualifyHtmlPreview(surface) {
    const sourceURL = page.url();
    const canvas = page.locator('.chat-html-canvas');
    assert.equal(await canvas.evaluate((element) => getComputedStyle(element).borderWidth), '0px');
    await canvas.scrollIntoViewIfNeeded();
    const contentGeometry = async () => {
      const area = await canvas.boundingBox();
      const sheet = await canvas.locator('.chat-html-sheet').boundingBox();
      const button = canvas.locator('[data-chat-media-action=preview]');
      const action = await button.boundingBox();
      assert.ok(sheet.width / area.width > .92 && sheet.height / area.height > .82);
      assert.ok(action.x > area.x + area.width / 2 && action.y + action.height < sheet.y);
      assert.equal(action.width, action.height);
      assert.equal(await button.evaluate((element) => getComputedStyle(element).borderRadius), '50%');
    };
    await contentGeometry();
    await page.screenshot({ path: path.join(output, `${surface}-html-canvas.png`) });
    const inline = page.frameLocator('.chat-html-sheet iframe');
    const original = await page.locator('.chat-html-sheet iframe').elementHandle();
    await inline.getByRole('textbox', { name: 'Reading note' }).fill('Keep this reading state');
    await inline.getByRole('button', { name: 'Update report' }).click();
    await page.locator('.chat-html-controls [data-chat-media-action="source"]').click();
    assert.equal(await canvas.getAttribute('data-view'), 'source');
    assert.equal(await page.locator('.chat-html-source').textContent(), html);
    await page.locator('.chat-html-controls [data-chat-media-action="source"]').click();
    assert.equal(await inline.getByRole('textbox', { name: 'Reading note' }).inputValue(), 'Keep this reading state');
    assert.equal(await inline.getByRole('button').textContent(), 'Updated');
    await inline.getByRole('link', { name: 'Economy', exact: true }).click();
    const frame = await original.contentFrame();
    assert.equal(await frame.evaluate(() => location.href), 'about:srcdoc');
    assert.ok(await frame.evaluate(() => scrollY > 500));
    await inline.getByRole('link', { name: 'News source' }).click();
    await page.waitForFunction(() => window.htmlPreviewURLs?.includes('https://example.com/news'));
    await inline.getByRole('link', { name: 'Unsupported link' }).click();
    await page.locator('.chat-html-sheet [role="alert"]').waitFor();
    assert.equal(page.url(), sourceURL);

    const trigger = canvas.locator('[data-chat-media-action=preview]');
    await trigger.focus();
    const scrollBefore = await trigger.evaluate((element) => {
      const positions = [];
      for (let node = element; node; node = node.parentElement) positions.push(node.scrollTop);
      return positions;
    });
    await page.keyboard.press('Enter');
    const popup = page.locator('.chat-media-preview-window');
    await popup.waitFor();
    await page.waitForFunction(
      () => document.querySelector('.chat-media-preview-window')?.getAttribute('data-floating-presence') === 'open',
    );
    await popup.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    const copy = page.frameLocator('.chat-media-preview-window iframe');
    assert.equal(await copy.getByRole('textbox', { name: 'Reading note' }).inputValue(), '');
    assert.equal(await inline.getByRole('textbox', { name: 'Reading note' }).inputValue(), 'Keep this reading state');
    assert.equal(await inline.getByRole('button').textContent(), 'Updated');
    assert.equal(await page.locator('.chat-html-sheet iframe').evaluate((element, original) => element === original, original), true);
    assert.deepEqual(
      await trigger.evaluate((element) => {
        const positions = [];
        for (let node = element; node; node = node.parentElement) positions.push(node.scrollTop);
        return positions;
      }),
      scrollBefore,
    );
    await copy.getByRole('link', { name: 'Economy', exact: true }).focus();
    await page.keyboard.press('Enter');
    const popupFrame = await (await popup.locator('iframe').elementHandle()).contentFrame();
    assert.equal(await popupFrame.evaluate(() => location.href), 'about:srcdoc');
    assert.ok(await popupFrame.evaluate(() => scrollY > 500));
    await popup.locator('[data-floe-floating-window-control="maximize"]').click();
    await popup.locator('[data-floe-floating-window-control="maximize"]').click();
    await popup.locator('[data-floe-floating-window-control="close"]').focus();
    await page.keyboard.press('Enter');
    await popup.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.scrollIntoViewIfNeeded();
    await contentGeometry();
    const cdp = await browser.contexts()[0].newCDPSession(page);
    const bounds = await trigger.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await popup.waitFor();
    await page.waitForFunction(
      () => document.querySelector('.chat-media-preview-window')?.getAttribute('data-floating-presence') === 'open',
    );
    await popup.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    const narrow = await popup.boundingBox();
    assert.ok(narrow.x >= 0 && narrow.y >= 0 && narrow.x + narrow.width <= 391 && narrow.y + narrow.height <= 845, JSON.stringify(narrow));
    await page.screenshot({
      path: path.join(output, `${surface}-html-narrow.png`),
    });
    await popup.locator('[data-floe-floating-window-control="close"]').click();
    await popup.waitFor({ state: 'detached' });
    await cdp.detach();
    await page.setViewportSize({ width: 1240, height: 900 });
    return {
      directPreview: true,
      contentGeometry: true,
      sourceRetained: true,
      independentCopy: true,
      localAnchors: true,
      externalURL: true,
      errorsRetainSource: true,
      keyboard: true,
      touch: true,
      narrow,
    };
  }
  try {
    const entry = path.join(state, 'main.cjs');
    await writeFile(
      entry,
      `const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => { const win = new BrowserWindow({ width: 1240, height: 900, useContentSize: true,
      webPreferences: { contextIsolation: true, sandbox: true } }); win.loadURL('about:blank'); });`,
    );
    const application = await session.launchElectron(_electron, {
      executablePath: electron,
      args: [
        entry,
        `--user-data-dir=${state}/profile`,
        `--redeven-smoke-run=${report.marker}`,
        `--ignore-certificate-errors-spki-list=${tls.certificateSPKIHash}`,
      ],
      cwd: state,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    child = application.process();
    report.pid = child.pid;
    browser = { contexts: () => [application.context()] };
    page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].waitForEvent('page'));
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => report.errors.push(error.message));
    const { mixedEnvironmentFixture } = await server.ssrLoadModule(path.join(root, 'desktop/src/testSupport/mixedEnvironmentFixture.ts'));
    const { RUNTIME_SERVICE_COMPATIBILITY_EPOCH: epoch, RUNTIME_SERVICE_PROTOCOL_VERSION: protocol } = await server.ssrLoadModule(
      path.join(root, 'desktop/src/shared/runtimeService.ts'),
    );
    const snapshot = mixedEnvironmentFixture().snapshot;
    snapshot.environments = snapshot.environments.map((entry) => ({
      ...entry,
      runtime_service: {
        ...(entry.runtime_service ?? entry.local_environment_runtime_service),
        compatibility_epoch: epoch,
        protocol_version: protocol,
        compatibility: 'compatible',
        open_readiness: { state: 'openable' },
        ai_readiness: { state: 'inspecting' },
      },
    }));
    await page.addInitScript((snapshot) => {
      if (window.top !== window) return;
      window.navigationSnapshot = { ...snapshot, navigation_revision: 1 };
      const language = {
        preference: 'zh-CN',
        resolved_locale: 'zh-CN',
        source: 'explicit',
        system_candidates: [],
      };
      window.redevenDesktopLanguage = {
        getSnapshot: () => language,
        subscribe: () => () => {},
      };
      window.htmlPreviewURLs = [];
      window.redevenDesktopShell = {
        openExternalURL: async (url) => {
          window.htmlPreviewURLs.push(url);
          return { ok: true };
        },
      };
    }, snapshot);
    await page.goto(new URL('flower-navigation.html?media=1', report.url).href, { timeout: 60000 });
    await page.getByRole('button', { name: 'Flower', exact: true }).click();
    await page.evaluate(() => window.navigationFixture.releaseRuntime());
    await page.locator('[data-thread-id="navigation-thread"] button').first().click();
    await page.waitForFunction(() => document.querySelector('.chat-media-image')?.naturalWidth > 0);
    await page.locator('.chat-media-image').scrollIntoViewIfNeeded();
    report.generation = await qualifyHtmlGeneration('welcome', (text, generating) =>
      page.evaluate(({ text, generating }) => window.navigationFixture.publishHTML(text, generating), { text, generating }),
    );
    await page.screenshot({ path: path.join(output, 'before.png') });
    report.stability = await page.evaluate(async () => {
      const image = document.querySelector('.chat-media-image');
      const src = image.src;
      const before = {
        requests: window.navigationFixture.requests.length,
        streams: window.navigationFixture.streams,
        cancellations: window.navigationFixture.cancellations,
      };
      let reloads = 0;
      let snapshots = 0;
      const observer = new MutationObserver(() => {
        if (document.querySelector('.chat-media-image') !== image || image.src !== src) reloads++;
      });
      observer.observe(image.closest('[data-floe-markdown-media]'), {
        subtree: true,
        childList: true,
        attributes: true,
      });
      const timer = setInterval(() => {
        window.navigationFixture.refreshHealth();
        snapshots++;
      }, 500);
      await new Promise((resolve) => setTimeout(resolve, 30000));
      clearInterval(timer);
      observer.disconnect();
      return {
        seconds: 30,
        snapshots,
        reloads,
        sameNode: document.querySelector('.chat-media-image') === image,
        sameURL: image.src === src,
        extraRequests: window.navigationFixture.requests.slice(before.requests),
        requests: [...window.navigationFixture.requests],
        extraStreams: window.navigationFixture.streams - before.streams,
        cancellations: window.navigationFixture.cancellations - before.cancellations,
      };
    });
    assert.equal(report.stability.sameNode, true);
    assert.equal(report.stability.sameURL, true);
    assert.equal(report.stability.reloads, 0);
    assert.ok(report.stability.snapshots >= 50);
    assert.deepEqual(report.stability.extraRequests, []);
    assert.equal(report.stability.extraStreams, 0);
    assert.equal(report.stability.cancellations, 0);
    await page.screenshot({ path: path.join(output, 'after.png') });
    await page.locator('.chat-media-image-button').click();
    await page.locator('.chat-media-preview-window').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.chat-media-preview-window').waitFor({ state: 'detached' });
    report.html = await qualifyHtmlPreview('welcome');
    const screenshotBytes = Buffer.from(
      await page.evaluate(async () =>
        Array.from(new Uint8Array(await (await fetch(document.querySelector('.chat-media-image').src)).arrayBuffer())),
      ),
    );
    await page.evaluate(() => window.navigationFixture.dispose());
    assert.ok(await page.evaluate(() => window.navigationFixture.cancellations > 0), 'Disposal releases the workspace stream');
    // Release the Welcome dev server before switching to the built Env App.
    await page.goto('about:blank');
    await session.release(previewServer);

    const thread = {
      thread_id: 'env-media-thread',
      title: 'Workspace preview',
      title_status: 'ready',
      title_generation: 1,
      model_id: 'fixture/fixture-model',
      run_status: 'idle',
      working_dir: '/workspace',
      created_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      last_message_at_unix_ms: 2,
      read_status: {
        is_unread: false,
        snapshot: { activity_revision: 1 },
        read_state: { last_seen_activity_revision: 1 },
      },
    };
    const resourceRef = `computer://browser-main/${'a'.repeat(64)}`;
    let current = {
      thread_id: thread.thread_id,
      view_version: 1,
      activity: 'idle',
      queue: [],
      interactions: [],
      items: [
        {
          id: 'env-reply',
          kind: 'assistant',
          turn_id: 'env-turn',
          run_id: 'env-run',
          ordinal: 1,
          text: `Here is the workspace preview.\n\n![Workspace](${resourceRef})\n\n\`\`\`html preview\n${html}\n\`\`\``,
        },
      ],
    };
    const requests = [];
    const streams = new Set();
    let streamReady;
    const liveReady = new Promise((resolve) => { streamReady = resolve; });
    envServer = await createBuiltDistServer({
      accessReady: true,
      fileContinuity: true,
      tls,
      handleRequest: async (request, response, url) => {
        const route = url.pathname;
        if (route.startsWith('/_redeven_proxy/api/ai/')) requests.push(`${request.method} ${route}`);
        let value;
        if (route.endsWith('/ai/threads')) value = { threads: [thread] };
        else if (route.endsWith('/ai/conversation_preferences')) value = { revision: 0, reasoning_by_model: {} };
        else if (route.endsWith(`/ai/threads/${thread.thread_id}`) || route.endsWith(`/ai/threads/${thread.thread_id}/history`)) value = { thread, current };
        else if (route.endsWith(`/ai/threads/${thread.thread_id}/read`)) {
          let body = '';
          for await (const chunk of request) body += chunk;
          const { snapshot } = JSON.parse(body);
          thread.read_status = { is_unread: false, snapshot,
            read_state: { last_seen_activity_revision: snapshot.activity_revision } };
          value = { read_status: thread.read_status };
        }
        else if (route.endsWith('/ai/attachments/capabilities')) value = { model_id: thread.model_id, revision: '1', enabled: false };
        else if (route.includes('/computer-media/')) {
          response.writeHead(200, { 'content-type': 'image/png' });
          response.end(screenshotBytes);
          return true;
        } else if (route.endsWith('/ai/flower/stream')) {
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
          });
          const payload = Buffer.from(
            JSON.stringify({
              schema_version: 2,
              kind: 'ready',
              summaries: [thread],
            }),
          );
          const frame = {
            envelope_id: 'env-ready',
            fragment_index: 0,
            fragment_count: 1,
            total_bytes: payload.length,
            data_base64: payload.toString('base64'),
          };
          response.write('data: ' + JSON.stringify(frame) + '\n\n');
          streams.add(response);
          streamReady();
          request.on('close', () => streams.delete(response));
          return true;
        } else return false;
        response.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify(value));
        return true;
      },
    });
    await session.defer('Env fixture', () => envServer.close());
    await session.port(new URL(envServer.baseURL).port);
    report.envURL = envServer.baseURL;
    await trustBuiltDistWebTransport(page, tls);
    await page.addInitScript(() => {
      if (window.top !== window) return;
      localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
      localStorage.setItem(
        'redeven-envapp:env_local-activity-navigation',
        JSON.stringify({
          version: 1,
          target: { kind: 'builtin', page: 'ai' },
          recentBuiltins: ['ai'],
        }),
      );
    });
    await page.goto(new URL('_redeven_proxy/env/', envServer.baseURL).href);
    await page.locator(`[data-thread-id="${thread.thread_id}"] button`).first().click();
    await page.waitForFunction(() => document.querySelector('.chat-media-image')?.naturalWidth > 0);
    await liveReady;
    await page.waitForFunction(() => document.querySelector('[data-flower-selected-thread-loading="false"]')
      && !document.querySelector('[data-flower-sync-state]'));
    await page.locator('.chat-media-image').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'env-before.png') });
    const requestCount = requests.length;
    const heartbeat = setInterval(() => {
      for (const stream of streams) stream.write(': keepalive\n\n');
    }, 500);
    try {
      report.envStability = await page.evaluate(async () => {
        const image = document.querySelector('.chat-media-image');
        const src = image.src;
        let reloads = 0;
        const observer = new MutationObserver(() => {
          if (document.querySelector('.chat-media-image') !== image || image.src !== src) reloads++;
        });
        observer.observe(image.closest('[data-floe-markdown-media]'), {
          subtree: true,
          childList: true,
          attributes: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 30000));
        observer.disconnect();
        return {
          seconds: 30,
          reloads,
          sameNode: document.querySelector('.chat-media-image') === image,
          sameURL: image.src === src,
        };
      });
    } finally {
      clearInterval(heartbeat);
    }
    report.envStability.extraRequests = requests.slice(requestCount);
    report.envStability.requests = [...requests];
    assert.equal(report.envStability.sameNode, true);
    assert.equal(report.envStability.sameURL, true);
    assert.equal(report.envStability.reloads, 0);
    assert.deepEqual(report.envStability.extraRequests, []);
    await page.screenshot({ path: path.join(output, 'env-after.png') });
    report.envGeneration = await qualifyHtmlGeneration('env', async (text, generating) => {
      const previous = current;
      const previousText = previous.items[0].text;
      current = {
        ...current,
        view_version: current.view_version + 1,
        activity: generating ? 'active' : 'idle',
        turn_id: 'env-turn',
        run_id: 'env-run',
        run_progress: generating ? { phase: 'streaming' } : null,
        items: current.items.map((item) => ({
          ...item,
          text,
          live: generating,
        })),
      };
      const content = generating && previous.activity === 'active' && text.startsWith(previousText)
        ? { update: { thread_id: thread.thread_id, turn_id: 'env-turn', run_id: 'env-run',
          base_version: previous.view_version, view_version: current.view_version,
          facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
          items: [{ kind: 'append', item_id: 'env-reply', append: { offset_bytes: Buffer.byteLength(previousText), text: text.slice(previousText.length) } }] } }
        : { current };
      const payload = Buffer.from(
        JSON.stringify({
          schema_version: 2,
          kind: 'thread.batch',
          thread_id: thread.thread_id,
          ...content,
        }),
      );
      const frame = {
        envelope_id: 'html-' + current.view_version,
        fragment_index: 0,
        fragment_count: 1,
        total_bytes: payload.length,
        data_base64: payload.toString('base64'),
      };
      for (const stream of streams) stream.write('data: ' + JSON.stringify(frame) + '\n\n');
    });
    report.envHTML = await qualifyHtmlPreview('env');
    assert.deepEqual(report.errors, []);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null, 'External termination is a visible verification failure');
    report.status = 'passed';
    console.log(JSON.stringify(report.stability));
    console.log(JSON.stringify(report.envStability));
  } catch (error) {
    report.status = 'failed';
    report.failure = String(error);
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await session.writeEvidence(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
});
