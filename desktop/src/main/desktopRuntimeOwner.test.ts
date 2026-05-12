import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeOwnerPath,
  loadOrCreateDesktopRuntimeOwnerID,
} from './desktopRuntimeOwner';

describe('desktopRuntimeOwner', () => {
  it('persists a stable Desktop runtime owner id under userData', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-owner-'));

    const first = await loadOrCreateDesktopRuntimeOwnerID(userDataDir);
    const second = await loadOrCreateDesktopRuntimeOwnerID(userDataDir);

    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(second).toBe(first);
  });

  it('recreates an invalid owner file with a usable id', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-owner-invalid-'));
    await fs.writeFile(desktopRuntimeOwnerPath(userDataDir), '{"owner_id":""}\n');

    const ownerID = await loadOrCreateDesktopRuntimeOwnerID(userDataDir);

    expect(ownerID).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
