import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { startDesktopAIBroker } from './desktopAIBroker';

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

describe('desktopAIBroker', () => {
  it('creates a session, injects a token, and shuts down cleanly', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ai-broker-test-'));
    const stateRoot = path.join(tempRoot, 'state');
    const scriptPath = path.join(tempRoot, 'mock-broker.cjs');
    await fs.writeFile(
      scriptPath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const args = process.argv.slice(2);',
        "const reportIndex = args.indexOf('--startup-report-file');",
        'if (reportIndex < 0 || !args[reportIndex + 1]) process.exit(2);',
        "if (!process.env.REDEVEN_DESKTOP_AI_BROKER_TOKEN) process.exit(3);",
        "if (!args.includes('--session-id')) process.exit(4);",
        "if (!args.includes('--ssh-runtime-key')) process.exit(5);",
        "if (!args.includes('ssh:devbox:22:key_agent:remote_default')) process.exit(6);",
        "if (!args.includes('--expires-at-unix-ms')) process.exit(7);",
        'const reportPath = args[reportIndex + 1];',
        'fs.mkdirSync(path.dirname(reportPath), { recursive: true });',
        "fs.writeFileSync(reportPath, JSON.stringify({ status: 'ready', url: 'http://127.0.0.1:41234', pid: process.pid, configured: true, model_count: 1, missing_key_provider_ids: ['anthropic'] }) + '\\n');",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8',
    );
    await fs.chmod(scriptPath, 0o755);

    const broker = await startDesktopAIBroker({
      executablePath: scriptPath,
      stateRoot,
      runtimeKey: 'ssh:devbox:22:key_agent:remote_default',
      tempRoot,
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 2_000,
    });

    expect(broker.url).toBe('http://127.0.0.1:41234');
    expect(broker.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(broker.sessionID).toMatch(/^broker_[a-f0-9]+$/);
    expect(broker.configured).toBe(true);
    expect(broker.modelCount).toBe(1);
    expect(broker.missingKeyProviderIDs).toEqual(['anthropic']);

    await expect(broker.stop()).resolves.toBeUndefined();
  });

  it('cancels broker readiness waits and cleans up the child process', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-ai-broker-cancel-test-'));
    const stateRoot = path.join(tempRoot, 'state');
    const startedPath = path.join(tempRoot, 'broker-started');
    const markerPath = path.join(tempRoot, 'broker-exited');
    const scriptPath = path.join(tempRoot, 'slow-broker.cjs');
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

    const startup = startDesktopAIBroker({
      executablePath: scriptPath,
      stateRoot,
      runtimeKey: 'ssh:devbox:22:key_agent:remote_default',
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
