import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopSessionTarget } from './desktopTarget';

export function nativeCodeSpaceIdentity(
  target: DesktopSessionTarget,
  codeSpaceID: string,
  accountID = '',
): string {
  if (
    target.kind === 'local_environment' &&
    target.provider_origin &&
    !accountID
  )
    throw new Error('codespace_account_required');
  const owner =
    target.kind === 'local_environment' && target.provider_origin
      ? [
          target.provider_origin,
          target.provider_id,
          accountID,
          target.env_public_id,
        ]
      : [target.kind, target.environment_id];
  return createHash('sha256')
    .update(JSON.stringify([...owner, codeSpaceID]))
    .digest('hex');
}

/** Corrupt or future profile state fails closed; editor origins must never silently change. */
export class NativeCodeSpaceProfiles {
  private readonly ports: Record<string, number>;
  constructor(private readonly filePath: string) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        version?: unknown;
        ports?: Record<string, unknown>;
      };
      if (
        data.version !== 1 ||
        !data.ports ||
        typeof data.ports !== 'object' ||
        Array.isArray(data.ports) ||
        Object.entries(data.ports).some(
          ([key, port]) =>
            !/^[a-f0-9]{64}$/u.test(key) ||
            !Number.isInteger(port) ||
            Number(port) < 1024 ||
            Number(port) > 65535,
        )
      ) {
        throw new Error('codespace_profiles_invalid');
      }
      this.ports = data.ports as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('codespace_profiles_invalid');
      this.ports = {};
    }
  }
  port(identity: string): number | undefined {
    return this.ports[identity];
  }
  remember(identity: string, port: number): void {
    if (
      !/^[a-f0-9]{64}$/u.test(identity) ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535
    )
      throw new Error('codespace_profile_invalid');
    if (this.ports[identity] !== undefined && this.ports[identity] !== port)
      throw new Error('codespace_origin_conflict');
    if (this.ports[identity] === port) return;
    const ports = { ...this.ports, [identity]: port };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, ports }), {
        mode: 0o600,
        flag: 'wx',
      });
      fs.renameSync(temporary, this.filePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    this.ports[identity] = port;
  }
}
