import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readBundledDesktopRuntimeIdentity } from './desktopRuntimeIdentity';

async function writeExecutable(name: string, body: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-identity-'));
  const executablePath = path.join(dir, name);
  await fs.writeFile(executablePath, body, { mode: 0o700 });
  return executablePath;
}

describe('desktopRuntimeIdentity', () => {
  it('reads the bundled runtime identity from redeven version output', async () => {
    const executablePath = await writeExecutable(
      'redeven',
      '#!/bin/sh\nprintf "%s\\n" "redeven v1.2.3 (abc123) 2026-01-02T03:04:05Z"\n',
    );

    expect(readBundledDesktopRuntimeIdentity(executablePath)).toEqual({
      runtime_version: 'v1.2.3',
      runtime_commit: 'abc123',
      runtime_build_time: '2026-01-02T03:04:05Z',
    });
  });

  it('returns null when the executable does not report a Redeven identity', async () => {
    const executablePath = await writeExecutable(
      'not-redeven',
      '#!/bin/sh\nprintf "%s\\n" "not redeven"\n',
    );

    expect(readBundledDesktopRuntimeIdentity(executablePath)).toBeNull();
  });
});
