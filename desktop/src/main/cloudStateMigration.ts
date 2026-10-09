import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

type Change = { path: string; before: string; after: string };

async function readOptional(file: string): Promise<string | null> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

async function writeAtomic(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.cloud-migration.tmp`;
  try {
    const handle = await fs.open(temporary, 'w', 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally { await fs.rm(temporary, { force: true }); }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function migrateRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.map(migrateRecord).some(Boolean);
  const record = value as Record<string, unknown>;
  let changed = false;
  for (const [oldName, newName] of [
    ['provider_origin', 'cloud_origin'], ['provider_id', 'cloud_id'], ['provider', 'cloud'],
    ['current_provider_binding', 'current_cloud_binding'], ['provider_environments', 'cloud_environments'],
  ]) {
    if (!Object.hasOwn(record, oldName)) continue;
    if (oldName === 'provider' && (record[oldName] == null || typeof record[oldName] !== 'object')) continue;
    if (Object.hasOwn(record, newName) && !isDeepStrictEqual(record[oldName], record[newName])) {
      throw new Error(`Conflicting saved Cloud fields: ${oldName} and ${newName}.`);
    }
    record[newName] = record[oldName];
    delete record[oldName];
    changed = true;
  }
  if (record.protocol_version === 'rcpp-v3') { record.protocol_version = 'rcpp-v4'; changed = true; }
  else if (typeof record.protocol_version === 'string' && record.protocol_version.startsWith('rcpp-') && record.protocol_version !== 'rcpp-v4') {
    throw new Error('Unsupported saved Cloud protocol version.');
  }
  for (const child of Object.values(record)) changed = migrateRecord(child) || changed;
  return changed;
}

// File names and identity keys stay stable. The journal makes an interrupted
// multi-file migration recoverable without decoding or replacing secret bytes.
export async function migrateDesktopCloudState(options: {
  stateRoot: string; preferencesFile: string; secretsFile: string;
  localEnvironmentFile: string; cloudDirectories: readonly string[];
}): Promise<void> {
  const files = [options.preferencesFile, options.secretsFile, options.localEnvironmentFile];
  for (const directory of options.cloudDirectories) {
    try {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(directory, entry.name));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const journalPath = path.join(options.stateRoot, 'maintenance', 'cloud-identity-migration.json');
  const previous = await readOptional(journalPath);
  if (previous != null) {
    const journal = JSON.parse(previous) as { version: number; changes: Change[] };
    if (journal.version !== 1 || !Array.isArray(journal.changes)) throw new Error('Unsupported Cloud migration journal.');
    for (const change of journal.changes) {
      if (!change || typeof change.path !== 'string' || typeof change.before !== 'string' || typeof change.after !== 'string'
        || !files.includes(change.path)) throw new Error('Cloud migration journal path is outside the saved catalog.');
      const current = await readOptional(change.path);
      if (current !== change.before && current !== change.after) throw new Error('Saved Cloud state changed during migration.');
    }
    for (const change of journal.changes) await writeAtomic(change.path, change.before);
    await fs.rm(journalPath);
    await syncDirectory(path.dirname(journalPath));
  }
  const changes: Change[] = [];
  for (const file of files) {
    const before = await readOptional(file);
    if (before == null) continue;
    const value = JSON.parse(before) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved Cloud state.');
    const maxVersion = file === options.preferencesFile ? 16 : file === options.secretsFile ? 5 : 2;
    const versionField = file === options.preferencesFile || file === options.secretsFile ? 'version' : 'schema_version';
    if (value[versionField] != null && (!Number.isInteger(value[versionField]) || Number(value[versionField]) < 1 || Number(value[versionField]) > maxVersion)) {
      throw new Error(`Unsupported saved Cloud state version in ${file}.`);
    }
    if (migrateRecord(value)) changes.push({ path: file, before, after: `${JSON.stringify(value, null, 2)}\n` });
  }
  if (changes.length === 0) return;
  await writeAtomic(journalPath, `${JSON.stringify({ version: 1, changes })}\n`);
  try {
    for (const change of changes) await writeAtomic(change.path, change.after);
  } catch (error) {
    for (const change of changes) await writeAtomic(change.path, change.before);
    await fs.rm(journalPath);
    throw error;
  }
  await fs.rm(journalPath);
  await syncDirectory(path.dirname(journalPath));
}
