import fs from 'node:fs/promises';
import path from 'node:path';

export class DesktopCloudStateError extends Error {
  readonly code = 'desktop_cloud_state_invalid';
  constructor(readonly file: string, reason: string) {
    super(`${file}: ${reason} Existing files were not changed. Remove the obsolete Cloud registration and its saved credentials, or launch Desktop with a new REDEVEN_STATE_ROOT and user-data directory, then sign in and enroll again.`);
    this.name = 'DesktopCloudStateError';
  }
}

const retiredFields = new Set(['provider_origin', 'provider_id', 'provider', 'current_provider_binding', 'provider_environments']);

function validateRecord(value: unknown, file: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const child of value) validateRecord(child, file); return; }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (retiredFields.has(key)) throw new DesktopCloudStateError(file, `Retired Cloud field ${key} is unsupported.`);
  }
  if (Object.hasOwn(record, 'protocol_version') && record.protocol_version !== 'rcpp-v5') {
    throw new DesktopCloudStateError(file, 'Unsupported saved Cloud protocol; expected rcpp-v5.');
  }
  for (const child of Object.values(record)) validateRecord(child, file);
}

// Validate the saved Cloud contract before any preference normalization writes.
// Old registrations and migration journals are never converted or replayed.
export async function validateDesktopCloudState(options: {
  stateRoot: string; preferencesFile: string; secretsFile: string;
  localEnvironmentFile: string; cloudDirectories: readonly string[];
}): Promise<void> {
  const journal = path.join(options.stateRoot, 'maintenance', 'cloud-identity-migration.json');
  try {
    await fs.lstat(journal);
    throw new DesktopCloudStateError(journal, 'Retired Cloud migration journal is unsupported.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const files = [options.preferencesFile, options.secretsFile, options.localEnvironmentFile];
  for (const directory of options.cloudDirectories) {
    try {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(directory, entry.name));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const file of files) {
    let raw: string;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new DesktopCloudStateError(file, 'Saved Cloud state is not valid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DesktopCloudStateError(file, 'Saved Cloud state must be an object.');
    const record = value as Record<string, unknown>;
    const versionField = file === options.preferencesFile || file === options.secretsFile ? 'version' : 'schema_version';
    const maxVersion = file === options.preferencesFile ? 16 : file === options.secretsFile ? 5 : 1;
    if (record[versionField] != null && (!Number.isInteger(record[versionField]) || Number(record[versionField]) < 1 || Number(record[versionField]) > maxVersion)) {
      throw new DesktopCloudStateError(file, 'Unsupported saved Cloud state schema.');
    }
    validateRecord(value, file);
  }
}
