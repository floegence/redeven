import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupReinstallQuarantine,
  preflightReinstallTarget,
  reinstallQuarantinePath,
  reinstallTarget,
  ReinstallTargetError,
} from './targetReinstall';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-reinstall-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('target reinstall', () => {
  it('replaces only the exact target and deletes its generated quarantine after success', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'local-environment');
    const siblingRoot = path.join(parent, 'keep-me');
    await fs.mkdir(targetRoot);
    await fs.mkdir(siblingRoot);
    await fs.writeFile(path.join(targetRoot, 'old-state'), 'old');
    await fs.writeFile(path.join(siblingRoot, 'user-data'), 'keep');

    await reinstallTarget({
      kind: 'local_environment',
      targetRoot,
      operationId: 'operation-1',
    }, async (journal) => {
      expect(journal.quarantine_root).toBe(`${targetRoot}.redeven-quarantine-operation-1`);
      await expect(fs.readFile(path.join(journal.quarantine_root, 'old-state'), 'utf8')).resolves.toBe('old');
      await fs.writeFile(path.join(targetRoot, 'fresh-state'), 'fresh');
    });

    await expect(fs.readFile(path.join(targetRoot, 'fresh-state'), 'utf8')).resolves.toBe('fresh');
    await expect(fs.stat(`${targetRoot}.redeven-quarantine-operation-1`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(siblingRoot, 'user-data'), 'utf8')).resolves.toBe('keep');
  });

  it('preserves the quarantine and never restores old state after fresh install fails', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'gateway');
    await fs.mkdir(targetRoot);
    await fs.writeFile(path.join(targetRoot, 'old-state'), 'old');

    await expect(reinstallTarget({
      kind: 'gateway',
      targetRoot,
      operationId: 'operation-2',
    }, async () => {
      throw new Error('fresh install failed');
    })).rejects.toThrow('fresh install failed');

    const quarantineRoot = reinstallQuarantinePath({ targetRoot, operationId: 'operation-2' });
    await expect(fs.readFile(path.join(quarantineRoot, 'old-state'), 'utf8')).resolves.toBe('old');
    await expect(fs.readFile(path.join(targetRoot, 'old-state'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(targetRoot, '.reinstall-marker.json'), 'utf8')).resolves.toContain('operation-2');
  });

  it('rejects broad roots and symbolic-link targets', async () => {
    await expect(preflightReinstallTarget({
      kind: 'local_environment',
      targetRoot: path.parse(process.cwd()).root,
      operationId: 'operation-3',
    })).rejects.toBeInstanceOf(ReinstallTargetError);

    await expect(preflightReinstallTarget({
      kind: 'local_environment',
      targetRoot: os.homedir(),
      operationId: 'operation-home',
    })).rejects.toMatchObject({ code: 'invalid_target' });

    const parent = await temporaryRoot();
    const realRoot = path.join(parent, 'real');
    const linkedRoot = path.join(parent, 'linked');
    await fs.mkdir(realRoot);
    await fs.symlink(realRoot, linkedRoot);
    await expect(preflightReinstallTarget({
      kind: 'gateway',
      targetRoot: linkedRoot,
      operationId: 'operation-4',
    })).rejects.toMatchObject({ code: 'target_is_symlink' });
  });

  it('refuses a forged cleanup path and leaves unrelated data untouched', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'environment');
    const unrelatedRoot = path.join(parent, 'unrelated');
    await fs.mkdir(targetRoot);
    await fs.mkdir(unrelatedRoot);
    const journal = await preflightReinstallTarget({
      kind: 'gateway',
      targetRoot,
      operationId: 'operation-5',
    });

    await expect(cleanupReinstallQuarantine({
      ...journal,
      quarantine_root: unrelatedRoot,
    })).rejects.toMatchObject({ code: 'invalid_target' });
    await expect(fs.stat(unrelatedRoot)).resolves.toBeDefined();
  });

  it('blocks a new reinstall while any quarantine for the target remains', async () => {
    const parent = await temporaryRoot();
    const targetRoot = path.join(parent, 'environment');
    await fs.mkdir(targetRoot);
    await fs.mkdir(`${targetRoot}.redeven-quarantine-previous-operation`);

    await expect(preflightReinstallTarget({
      kind: 'local_environment',
      targetRoot,
      operationId: 'new-operation',
    })).rejects.toMatchObject({ code: 'quarantine_exists' });
  });
});
