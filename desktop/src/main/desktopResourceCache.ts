import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeResourceCacheRequest } from '../shared/resourceCacheIPC';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Preserve the published ESM entrypoint in the CommonJS Desktop build.
const loadResourceCache = new Function(
  'return import("@floegence/floe-webapp-core/resource-cache")',
) as () => Promise<typeof import('@floegence/floe-webapp-core/resource-cache')>;

/** Asynchronous storage for disposable renderer snapshots, separate from preferences. */
export class DesktopResourceCache {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly maxBytes = 32 * 1024 * 1024) {}

  private ownerDirectory(owner: string) { return path.join(this.directory, hash(owner)); }
  private file(owner: string, key: string) { return path.join(this.ownerDirectory(owner), `${hash(key)}.json`); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const request = this.pending.catch(() => undefined).then(action);
    this.pending = request;
    return request;
  }
  get(owner: string, key: string): Promise<string | null> {
    const file = this.file(owner, key);
    return this.serial(async () => {
      try {
        const record = JSON.parse(await readFile(file, 'utf8')) as { key?: unknown; value?: unknown };
        if (record.key !== key || typeof record.value !== 'string') throw new Error('Invalid resource snapshot');
        await utimes(file, new Date(), (await stat(file)).mtime);
        return record.value;
      } catch { await rm(file, { force: true }).catch(() => undefined); return null; }
    });
  }
  set(owner: string, key: string, value: string): Promise<void> {
    const file = this.file(owner, key);
    return this.serial(async () => {
      await mkdir(this.ownerDirectory(owner), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ key, value }), { mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      const { enforceResourceCacheBudget } = await loadResourceCache();
      await enforceResourceCacheBudget({
        list: () => this.allEntries(),
        remove: key => rm(path.join(this.directory, key), { force: true }),
      }, this.maxBytes);
    });
  }
  remove(owner: string, key: string): Promise<void> {
    const file = this.file(owner, key);
    return this.serial(() => rm(file, { force: true }));
  }
  private async entries(directory: string): Promise<{ key: string; bytes: number; lastAccessedAt: number; file: string }[]> {
    const names = await readdir(directory).catch(() => [] as string[]);
    const entries = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).map(async name => {
      const file = path.join(directory, name);
      try {
        const info = await stat(file);
        const content = await readFile(file, 'utf8');
        // Index scans must not count every file as a user read.
        await utimes(file, info.atime, info.mtime);
        const record = JSON.parse(content) as { key?: unknown; value?: unknown };
        if (typeof record.key !== 'string' || typeof record.value !== 'string' || `${hash(record.key)}.json` !== name) throw new Error('Invalid resource snapshot');
        return [{ key: record.key, bytes: Buffer.byteLength(record.value, 'utf8'), lastAccessedAt: info.atime.getTime(), file: name }];
      } catch { await rm(file, { force: true }).catch(() => undefined); return []; }
    }));
    return entries.flat();
  }
  async list(owner: string): Promise<{ key: string; bytes: number; lastAccessedAt: number }[]> {
    return this.serial(async () => (await this.entries(this.ownerDirectory(owner))).map(({ key, bytes, lastAccessedAt }) => ({ key, bytes, lastAccessedAt })));
  }
  private async allEntries() {
    const owners = await readdir(this.directory).catch(() => [] as string[]);
    const entries = await Promise.all(owners.filter(owner => /^[a-f0-9]{64}$/u.test(owner)).map(async owner => (
      (await this.entries(path.join(this.directory, owner))).map(entry => ({ ...entry, key: `${owner}/${entry.file}` }))
    )));
    return entries.flat();
  }
  async handle(owner: string, input: unknown): Promise<unknown> {
    const request = normalizeResourceCacheRequest(input);
    if (!owner || !request) throw new Error('Invalid resource cache request');
    if (request.action === 'list') return this.list(owner);
    if (request.action === 'get') return this.get(owner, request.key);
    if (request.action === 'remove') return this.remove(owner, request.key);
    return this.set(owner, request.key, request.value);
  }
}
