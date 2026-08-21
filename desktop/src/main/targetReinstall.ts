import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type ReinstallTargetKind = 'gateway' | 'local_environment';

export type ReinstallTargetRequest = Readonly<{
  kind: ReinstallTargetKind;
  targetRoot: string;
  operationId: string;
}>;

export type ReinstallTargetJournal = Readonly<{
  schema_version: 1;
  operation_id: string;
  kind: ReinstallTargetKind;
  target_root: string;
  quarantine_root: string;
  started_at_unix_ms: number;
  isolated_at_unix_ms?: number;
  completed_at_unix_ms?: number;
}>;

export class ReinstallTargetError extends Error {
  constructor(readonly code: 'invalid_target' | 'target_missing' | 'target_is_symlink' | 'target_not_directory' | 'quarantine_exists' | 'target_locked' | 'cleanup_failed', message: string) {
    super(message);
    this.name = 'ReinstallTargetError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function operationSegment(operationId: string): string {
  const value = compact(operationId);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new ReinstallTargetError('invalid_target', 'Reinstall operation ID is invalid.');
  }
  return value;
}

function normalizeTargetRoot(value: string): string {
  const root = path.resolve(compact(value));
  const homeRoot = path.resolve(os.homedir());
  if (root === path.parse(root).root || root === path.dirname(root) || root === homeRoot) {
    throw new ReinstallTargetError('invalid_target', 'Reinstall target must be a dedicated environment directory.');
  }
  return root;
}

export function reinstallQuarantinePath(request: Pick<ReinstallTargetRequest, 'targetRoot' | 'operationId'>): string {
  const targetRoot = normalizeTargetRoot(request.targetRoot);
  return `${targetRoot}.redeven-quarantine-${operationSegment(request.operationId)}`;
}

async function assertTargetDirectory(targetRoot: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(targetRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ReinstallTargetError('target_missing', `Reinstall target does not exist: ${targetRoot}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new ReinstallTargetError('target_is_symlink', 'Reinstall refuses symbolic-link targets.');
  }
  if (!stat.isDirectory()) {
    throw new ReinstallTargetError('target_not_directory', 'Reinstall target must be a directory.');
  }
}

export async function preflightReinstallTarget(request: ReinstallTargetRequest): Promise<ReinstallTargetJournal> {
  const targetRoot = normalizeTargetRoot(request.targetRoot);
  const operationId = operationSegment(request.operationId);
  await assertTargetDirectory(targetRoot);
  const quarantineRoot = reinstallQuarantinePath({ targetRoot, operationId });
  const quarantinePrefix = `${path.basename(targetRoot)}.redeven-quarantine-`;
  const existingQuarantine = (await fs.readdir(path.dirname(targetRoot)))
    .find((entry) => entry.startsWith(quarantinePrefix));
  if (existingQuarantine) {
    throw new ReinstallTargetError('quarantine_exists', 'A previous reinstall quarantine requires manual recovery.');
  }
  try {
    await fs.lstat(quarantineRoot);
    throw new ReinstallTargetError('quarantine_exists', 'A previous reinstall quarantine already exists.');
  } catch (error) {
    if (error instanceof ReinstallTargetError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    schema_version: 1,
    operation_id: operationId,
    kind: request.kind,
    target_root: targetRoot,
    quarantine_root: quarantineRoot,
    started_at_unix_ms: Date.now(),
  };
}

export async function isolateReinstallTarget(journal: ReinstallTargetJournal): Promise<ReinstallTargetJournal> {
  await assertTargetDirectory(journal.target_root);
  try {
    await fs.rename(journal.target_root, journal.quarantine_root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ReinstallTargetError('quarantine_exists', 'A previous reinstall quarantine already exists.');
    }
    if ((error as NodeJS.ErrnoException).code === 'EBUSY' || (error as NodeJS.ErrnoException).code === 'EPERM') {
      throw new ReinstallTargetError('target_locked', 'The environment is still in use. Close it and try again.');
    }
    throw error;
  }
  await fs.mkdir(journal.target_root, { recursive: true });
  const isolated = { ...journal, isolated_at_unix_ms: Date.now() };
  await fs.writeFile(path.join(journal.target_root, '.reinstall-marker.json'), JSON.stringify(isolated, null, 2), 'utf8');
  return isolated;
}

export async function cleanupReinstallQuarantine(journal: ReinstallTargetJournal): Promise<void> {
  const expectedQuarantine = reinstallQuarantinePath({
    targetRoot: journal.target_root,
    operationId: journal.operation_id,
  });
  if (path.resolve(journal.quarantine_root) !== expectedQuarantine) {
    throw new ReinstallTargetError('invalid_target', 'Quarantine does not match the exact reinstall target and operation.');
  }
  try {
    await fs.rm(journal.quarantine_root, { recursive: true, force: false });
  } catch (error) {
    throw new ReinstallTargetError('cleanup_failed', `Reinstall completed but quarantine cleanup failed: ${String(error)}`);
  }
}

export async function reinstallTarget<T>(
  request: ReinstallTargetRequest,
  installFresh: (journal: ReinstallTargetJournal) => Promise<T>,
): Promise<T> {
  const preflight = await preflightReinstallTarget(request);
  const journal = await isolateReinstallTarget(preflight);
  const result = await installFresh(journal);
  await cleanupReinstallQuarantine({ ...journal, completed_at_unix_ms: Date.now() });
  return result;
}
