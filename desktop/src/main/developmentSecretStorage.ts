import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createSafeStorageSecretCodec, type DesktopSecretCodec, type SafeStorageLike } from './desktopPreferences';

const ENCODING = 'development_aes_256_gcm';

export class DevelopmentSecretStorageError extends Error {
  constructor(readonly canMigrate: boolean, options?: ErrorOptions) {
    super(canMigrate ? 'Development credentials require migration' : 'Development credentials could not be read', options);
  }
}

function readSecretFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function hasLegacySecrets(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasLegacySecrets);
  const record = value as Record<string, unknown>;
  return record.encoding === 'safe_storage' || Object.values(record).some(hasLegacySecrets);
}

function developmentKey(userDataRoot: string): Buffer {
  fs.mkdirSync(userDataRoot, { recursive: true, mode: 0o700 });
  const file = path.join(userDataRoot, 'development-secret-key-v1');
  try {
    fs.writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new Error('Invalid Desktop development secret key; the existing key was preserved.');
  return key;
}

function migrateSecrets(file: string, codec: DesktopSecretCodec, legacy: DesktopSecretCodec): void {
  const source = readSecretFile(file);
  if (source === undefined) return;
  let changed = false;
  const migrate = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(migrate);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.encoding === ENCODING && typeof record.data === 'string') {
      codec.decodeSecret({ encoding: ENCODING, data: record.data });
      return record;
    }
    if (record.encoding === 'safe_storage' && typeof record.data === 'string') {
      let value: string;
      try { value = legacy.decodeSecret({ encoding: 'safe_storage', data: record.data }); } catch (error) {
        throw new DevelopmentSecretStorageError(true, { cause: error });
      }
      const secret = codec.encodeSecret(value);
      changed = true;
      return secret;
    }
    if (record.encoding === 'plain' && typeof record.data === 'string') {
      changed = true;
      return codec.encodeSecret(record.data);
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, migrate(entry)]));
  };
  // Decrypt every record before replacing the file. A denied Keychain request
  // must preserve the file without letting preference recovery discard credentials.
  const migrated = migrate(source);
  if (!changed) return;
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(migrated, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function createDesktopSecretCodec(options: {
  isPackaged: boolean;
  developmentInstanceID: string | undefined;
  userDataRoot: string;
  stateRoot: string;
  safeStorage: SafeStorageLike;
  migrateLegacy?: boolean;
}): DesktopSecretCodec {
  const legacy = createSafeStorageSecretCodec(options.safeStorage);
  if (options.isPackaged || !options.developmentInstanceID?.trim()) return legacy;
  const files = [
    path.join(options.userDataRoot, 'desktop-secrets.json'),
    path.join(options.stateRoot, 'local-environment/gateway/gateway-secrets.json'),
    path.join(options.stateRoot, 'maintenance/environment-registration-migration.json'),
  ];
  // Scan before any decryption or mutation. Only an explicit launcher action may
  // request system authorization; an old profile must still open a window.
  if (!options.migrateLegacy && files.some(file => hasLegacySecrets(readSecretFile(file)))) {
    throw new DevelopmentSecretStorageError(true);
  }
  const key = developmentKey(options.userDataRoot);
  const codec: DesktopSecretCodec = {
    encodeSecret: value => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return { encoding: ENCODING, data: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64') };
    },
    decodeSecret: secret => {
      if (secret.encoding !== ENCODING) throw new Error('unsupported development secret encoding');
      const encrypted = Buffer.from(secret.data, 'base64');
      if (encrypted.length < 28) throw new Error('Invalid Desktop development secret.');
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  for (const file of files) migrateSecrets(file, codec, legacy);
  return codec;
}
