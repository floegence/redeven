import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopSecretCodec } from './developmentSecretStorage';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-dev-secrets-'));
  roots.push(stateRoot);
  const userDataRoot = path.join(stateRoot, 'desktop/user-data');
  const safeStorage = {
    isEncryptionAvailable: vi.fn((): boolean => { throw new Error('Keychain access requested'); }),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  };
  return { isPackaged: false, developmentInstanceID: 'rdi-test', stateRoot, userDataRoot, safeStorage };
}

function writeJSON(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

describe('development secret storage', () => {
  it('encrypts across restarts with a private profile key without touching Keychain', () => {
    const options = fixture();
    const codec = createDesktopSecretCodec(options);
    const secret = codec.encodeSecret('test-development-credential');
    expect(secret.encoding).toBe('development_aes_256_gcm');
    expect(secret.data).not.toContain('test-development-credential');
    expect(codec.encodeSecret('test-development-credential').data).not.toBe(secret.data);
    expect(createDesktopSecretCodec(options).decodeSecret(secret)).toBe('test-development-credential');
    expect(options.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(fs.statSync(path.join(options.userDataRoot, 'development-secret-key-v1')).mode & 0o777).toBe(0o600);
    const tampered = Buffer.from(secret.data, 'base64');
    tampered[12] ^= 1;
    expect(() => codec.decodeSecret({ ...secret, data: tampered.toString('base64') })).toThrow();
  });

  it.each([{ isPackaged: true }, { developmentInstanceID: undefined }])('keeps system storage outside launcher development: %j', override => {
    const options = { ...fixture(), ...override };
    const codec = createDesktopSecretCodec(options);
    expect(fs.existsSync(options.userDataRoot)).toBe(false);
    expect(() => codec.encodeSecret('test')).toThrow('Keychain access requested');
  });

  it('migrates Desktop and Gateway secrets once and preserves unrelated fields', () => {
    const options = fixture();
    options.safeStorage.isEncryptionAvailable.mockImplementation(() => true);
    const files = [path.join(options.userDataRoot, 'desktop-secrets.json'), path.join(options.stateRoot, 'local-environment/gateway/gateway-secrets.json')];
    for (const file of files) writeJSON(file, { version: 5, secrets: { retained: 7, credential: { encoding: 'safe_storage', data: Buffer.from('legacy-test').toString('base64') } } });
    const codec = createDesktopSecretCodec(options);
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(data.version).toBe(5);
      expect(data.secrets.retained).toBe(7);
      expect(codec.decodeSecret(data.secrets.credential)).toBe('legacy-test');
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(options.safeStorage.decryptString).toHaveBeenCalledTimes(2);
    options.safeStorage.isEncryptionAvailable.mockImplementation(() => { throw new Error('Unexpected Keychain access'); });
    createDesktopSecretCodec(options);
    expect(options.safeStorage.decryptString).toHaveBeenCalledTimes(2);
  });

  it('preserves the complete legacy file when authorization or decryption fails', () => {
    const options = fixture();
    const file = path.join(options.userDataRoot, 'desktop-secrets.json');
    writeJSON(file, { credential: { encoding: 'safe_storage', data: 'legacy' } });
    const original = fs.readFileSync(file, 'utf8');
    expect(() => createDesktopSecretCodec(options)).toThrow('Keychain access requested');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(options.userDataRoot).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('does not replace a partially decoded file when a later legacy secret fails', () => {
    const options = fixture();
    options.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    options.safeStorage.decryptString.mockImplementationOnce(() => 'first').mockImplementationOnce(() => { throw new Error('Decryption denied'); });
    const file = path.join(options.userDataRoot, 'desktop-secrets.json');
    writeJSON(file, { secrets: [ { encoding: 'safe_storage', data: 'first' }, { encoding: 'safe_storage', data: 'second' } ] });
    const original = fs.readFileSync(file, 'utf8');
    expect(() => createDesktopSecretCodec(options)).toThrow('Decryption denied');
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('migrates plaintext and interrupted registration credentials without losing their schema', () => {
    const options = fixture();
    const file = path.join(options.stateRoot, 'maintenance/environment-registration-migration.json');
    writeJSON(file, { schema_version: 1, legacy_ssh_secrets: [{ ssh_password: { encoding: 'plain', data: 'test-ssh' } }] });
    const codec = createDesktopSecretCodec(options);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(data.schema_version).toBe(1);
    expect(codec.decodeSecret(data.legacy_ssh_secrets[0].ssh_password)).toBe('test-ssh');
    expect(options.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it('blocks preference recovery if the profile key no longer decrypts saved credentials', () => {
    const options = fixture();
    const codec = createDesktopSecretCodec(options);
    const file = path.join(options.userDataRoot, 'desktop-secrets.json');
    writeJSON(file, { credential: codec.encodeSecret('test-retained') });
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(path.join(options.userDataRoot, 'development-secret-key-v1'), Buffer.alloc(32, 3));
    expect(() => createDesktopSecretCodec(options)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(options.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  it('rejects a damaged key instead of replacing it', () => {
    const options = fixture();
    const file = path.join(options.userDataRoot, 'development-secret-key-v1');
    fs.mkdirSync(options.userDataRoot, { recursive: true });
    fs.writeFileSync(file, 'damaged');
    expect(() => createDesktopSecretCodec(options)).toThrow('existing key was preserved');
    expect(fs.readFileSync(file, 'utf8')).toBe('damaged');
  });
});
