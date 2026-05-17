import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { startDesktopModelSource } from './desktopModelSource';

async function waitForFileText(filePath: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT' || Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

describe('desktopModelSource', () => {
  it('creates a session, passes runtime-control through env, and shuts down cleanly', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-model-source-test-'));
    const stateRoot = path.join(tempRoot, 'state');
    const argsPath = path.join(tempRoot, 'args.json');
    const scriptPath = path.join(tempRoot, 'mock-model-source.cjs');
    await fs.writeFile(
      scriptPath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const args = process.argv.slice(2);',
        "const reportIndex = args.indexOf('--startup-report-file');",
        "const sessionIndex = args.indexOf('--session-id');",
        'if (reportIndex < 0 || !args[reportIndex + 1]) process.exit(2);',
        'if (sessionIndex < 0 || !args[sessionIndex + 1]) process.exit(3);',
        "if (process.env.REDEVEN_DESKTOP_MODEL_SOURCE_RUNTIME_CONTROL_TOKEN !== 'runtime-token') process.exit(4);",
        "if (!args.includes('--runtime-control-url')) process.exit(5);",
        "if (!args.includes('http://127.0.0.1:41234/__redeven_runtime_control/')) process.exit(6);",
        "if (!args.includes('--desktop-owner-id')) process.exit(7);",
        "if (!args.includes('owner-1')) process.exit(8);",
        "if (!args.includes('--expires-at-unix-ms')) process.exit(9);",
        `fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args));`,
        'const reportPath = args[reportIndex + 1];',
        'const sessionID = args[sessionIndex + 1];',
        'fs.mkdirSync(path.dirname(reportPath), { recursive: true });',
        "fs.writeFileSync(reportPath, JSON.stringify({ status: 'connected', session_id: sessionID, pid: process.pid, configured: true, model_count: 1, missing_key_provider_ids: ['anthropic'] }) + '\\n');",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8',
    );
    await fs.chmod(scriptPath, 0o755);

    const modelSource = await startDesktopModelSource({
      executablePath: scriptPath,
      stateRoot,
      runtimeControl: {
        protocol_version: 'redeven-runtime-control-v1',
        base_url: 'http://127.0.0.1:41234/__redeven_runtime_control/',
        token: 'runtime-token',
        desktop_owner_id: 'owner-1',
      },
      tempRoot,
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 2_000,
    });

    expect(modelSource.sessionID).toMatch(/^dms_[a-f0-9]+$/u);
    expect(modelSource.configured).toBe(true);
    expect(modelSource.modelCount).toBe(1);
    expect(modelSource.missingKeyProviderIDs).toEqual(['anthropic']);
    await expect(fs.readFile(argsPath, 'utf8')).resolves.toContain('desktop-model-source');

    await expect(modelSource.stop()).resolves.toBeUndefined();
  });

  it('cancels model-source readiness waits and cleans up the child process', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-model-source-cancel-test-'));
    const stateRoot = path.join(tempRoot, 'state');
    const startedPath = path.join(tempRoot, 'model-source-started');
    const markerPath = path.join(tempRoot, 'model-source-exited');
    const scriptPath = path.join(tempRoot, 'slow-model-source.cjs');
    await fs.writeFile(
      scriptPath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(startedPath)}, 'started');`,
        `const marker = ${JSON.stringify(markerPath)};`,
        "process.on('SIGTERM', () => { fs.writeFileSync(marker, 'terminated'); process.exit(0); });",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8',
    );
    await fs.chmod(scriptPath, 0o755);
    const controller = new AbortController();

    const startup = startDesktopModelSource({
      executablePath: scriptPath,
      stateRoot,
      runtimeControl: {
        protocol_version: 'redeven-runtime-control-v1',
        base_url: 'http://127.0.0.1:41234/__redeven_runtime_control/',
        token: 'runtime-token',
        desktop_owner_id: 'owner-1',
      },
      tempRoot,
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 1_000,
      signal: controller.signal,
    });

    await expect(waitForFileText(startedPath)).resolves.toBe('started');
    controller.abort();
    await expect(startup).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waitForFileText(markerPath)).resolves.toBe('terminated');
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
});
