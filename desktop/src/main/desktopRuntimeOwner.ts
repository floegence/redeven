import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type DesktopRuntimeOwnerSnapshot = Readonly<{
  owner_id: string;
  created_at_unix_ms: number;
}>;

const DESKTOP_RUNTIME_OWNER_FILE = 'desktop-runtime-owner.json';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeOwnerSnapshot(value: unknown): DesktopRuntimeOwnerSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const ownerID = compact(record.owner_id);
  if (ownerID === '') {
    return null;
  }
  const createdAt = Number(record.created_at_unix_ms);
  return {
    owner_id: ownerID,
    created_at_unix_ms: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now(),
  };
}

export function desktopRuntimeOwnerPath(userDataDir: string): string {
  return path.join(compact(userDataDir), DESKTOP_RUNTIME_OWNER_FILE);
}

export async function loadOrCreateDesktopRuntimeOwnerID(userDataDir: string): Promise<string> {
  const ownerPath = desktopRuntimeOwnerPath(userDataDir);
  try {
    const raw = await fs.readFile(ownerPath, 'utf8');
    const snapshot = normalizeOwnerSnapshot(JSON.parse(raw));
    if (snapshot) {
      return snapshot.owner_id;
    }
  } catch {
    // Recreate below.
  }

  const snapshot: DesktopRuntimeOwnerSnapshot = {
    owner_id: randomUUID(),
    created_at_unix_ms: Date.now(),
  };
  await fs.mkdir(path.dirname(ownerPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(ownerPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  return snapshot.owner_id;
}
