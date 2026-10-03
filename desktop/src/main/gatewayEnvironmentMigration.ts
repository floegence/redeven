import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gatewayServiceTargetDescriptor } from './gatewayLifecycleManager';
import { gatewayRecordSSHPasswordRef } from './gatewayStore';
import { randomUUID } from 'node:crypto';
import type { DesktopSavedRuntimeTarget, UpsertDesktopSavedRuntimeTargetInput } from './desktopPreferences';
import { desktopRuntimeTargetID, normalizeDesktopRuntimeHostAccess, normalizeDesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import type { GatewayStore, LegacyDirectGatewayRecord } from './gatewayStore';

type JournalEntry = Readonly<{ gateway_id: string; environment_id: string; target_id: string }>;
type Journal = Readonly<{
  schema_version: 1;
  phase: 'prepared' | 'target_written' | 'gateway_removed';
  entries: readonly JournalEntry[];
  updated_at_unix_ms: number;
}>;

type MigrationOptions = Readonly<{
  journalPath: string;
  store: GatewayStore;
  targetInput: (legacy: LegacyDirectGatewayRecord) => Promise<UpsertDesktopSavedRuntimeTargetInput>;
  readTargets: () => Promise<readonly DesktopSavedRuntimeTarget[]>;
  writeTargets: (inputs: readonly UpsertDesktopSavedRuntimeTargetInput[]) => Promise<readonly DesktopSavedRuntimeTarget[]>;
}>;

export async function legacyGatewayRuntimeTargetInput(
  { record }: LegacyDirectGatewayRecord,
  readSecret: (reference: string) => Promise<string> | string,
): Promise<UpsertDesktopSavedRuntimeTargetInput> {
  const { host_access, placement } = gatewayServiceTargetDescriptor(record);
  // A legacy direct registration names a Runtime root, not the Gateway state subdirectory.
  const { runtime_state_root: _gatewayStateRoot, ...runtimePlacement } = placement;
  const reference = gatewayRecordSSHPasswordRef(record);
  const password = reference ? await readSecret(reference) : '';
  if ('ssh_password_configured' in record.connection && record.connection.ssh_password_configured && !password) {
    throw new Error('The saved SSH credential is unavailable; the legacy Gateway registration was kept.');
  }
  return { label: record.display_name, host_access, placement: runtimePlacement,
    ...(password ? { ssh_password: password, ssh_password_configured: true } : {}),
    auto_runtime_probe_enabled: true, created_at_ms: record.created_at_ms, updated_at_ms: record.updated_at_ms,
    last_used_at_ms: record.updated_at_ms };
}

/** One startup owner for legacy direct registrations; no network or Runtime lifecycle work. */
export class GatewayEnvironmentMigration {
  private task: Promise<void> | undefined;

  constructor(private readonly options: MigrationOptions) {}

  ensureComplete(): Promise<void> {
    // Keep failures visible to every caller until restart instead of racing a retry.
    return this.task ??= this.migrate();
  }

  private async writeJournal(journal: Journal): Promise<void> {
    const filePath = this.options.journalPath;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, filePath);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private async readJournal(): Promise<Journal | null> {
    let raw: string;
    try { raw = await fs.readFile(this.options.journalPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const value = JSON.parse(raw) as Journal;
    if (value?.schema_version !== 1 || !['prepared', 'target_written', 'gateway_removed'].includes(value.phase)
      || !Array.isArray(value.entries) || value.entries.some(entry => !entry
        || [entry.gateway_id, entry.environment_id, entry.target_id].some(id => typeof id !== 'string' || !id.trim()))
      || new Set(value.entries.map(entry => entry.gateway_id)).size !== value.entries.length) {
      throw new Error('Gateway migration journal is invalid; original records were kept.');
    }
    return value;
  }

  private async migrate(): Promise<void> {
    const { store } = this.options;
    let journal = await this.readJournal();
    const legacyRecords = await store.listLegacyDirectEnvironmentRecords();
    if (journal?.phase === 'gateway_removed') {
      await fs.rm(this.options.journalPath, { force: true });
      journal = null;
    }
    if (!journal && legacyRecords.length === 0) return;
    const prepared = await Promise.all(legacyRecords.map(async legacy => {
      if (legacy.record.connection.kind === 'url') {
        throw new Error('A legacy URL registration has an ambiguous Runtime mapping; original records were kept.');
      }
      const input = await this.options.targetInput(legacy);
      return { legacy, input, targetID: desktopRuntimeTargetID(input.host_access, input.placement) };
    }));
    if (!journal) {
      journal = { schema_version: 1, phase: 'prepared', updated_at_unix_ms: Date.now(),
        entries: prepared.map(({ legacy, targetID }) => ({ gateway_id: legacy.record.gateway_id,
          environment_id: legacy.runtime_environment_id, target_id: targetID })) };
      await this.writeJournal(journal);
    }
    if (journal.phase === 'prepared') {
      const inputs = journal.entries.map(entry => {
        const source = prepared.find(item => item.legacy.record.gateway_id === entry.gateway_id);
        if (!source || source.legacy.runtime_environment_id !== entry.environment_id || source.targetID !== entry.target_id) {
          throw new Error('Gateway migration source changed; original records were kept.');
        }
        return source.input;
      });
      // The writer preserves any existing target with this exact identity.
      await this.options.writeTargets(inputs);
    }
    const targets = await this.options.readTargets();
    if (journal.entries.some(entry => !targets.some(target => {
      if (target.id !== entry.target_id || desktopRuntimeTargetID(target.host_access, target.placement) !== entry.target_id) return false;
      const source = prepared.find(item => item.legacy.record.gateway_id === entry.gateway_id);
      if (!source) return journal?.phase === 'target_written';
      return source.targetID === entry.target_id
        && isDeepStrictEqual(target.host_access, normalizeDesktopRuntimeHostAccess(source.input.host_access))
        && isDeepStrictEqual(target.placement, normalizeDesktopRuntimePlacement(source.input.placement))
        && (!source.input.ssh_password || source.input.ssh_password === target.ssh_password);
    }))) {
      throw new Error('Gateway migration did not persist every complete Runtime target; original records were kept.');
    }
    journal = { ...journal, phase: 'target_written', updated_at_unix_ms: Date.now() };
    await this.writeJournal(journal);
    // Remove all source records in one atomic store mutation after durable readback.
    await store.removeMigratedDirectRecords(journal.entries);
    await this.writeJournal({ ...journal, phase: 'gateway_removed', updated_at_unix_ms: Date.now() });
    await fs.rm(this.options.journalPath, { force: true });
  }
}
