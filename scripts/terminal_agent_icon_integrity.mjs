import { createHash } from 'node:crypto';
import fs from 'node:fs';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function verifyBundledIconIntegrity({
  filePath,
  bundledSha256,
  upstreamSha256,
  modified,
}) {
  if (!/^[0-9a-f]{64}$/u.test(String(bundledSha256 ?? ''))) {
    throw new Error(`terminal agent icon bundled SHA-256 is invalid: ${filePath}`);
  }
  if (!/^[0-9a-f]{64}$/u.test(String(upstreamSha256 ?? ''))) {
    throw new Error(`terminal agent icon upstream SHA-256 is invalid: ${filePath}`);
  }
  if (modified !== false && modified !== 'trailing_newline_only') {
    throw new Error(`terminal agent icon modification marker is invalid: ${filePath}`);
  }

  const bytes = fs.readFileSync(filePath);
  if (sha256(bytes) !== bundledSha256) {
    throw new Error(`terminal agent icon bundled hash mismatch: ${filePath}`);
  }
  if (modified === false) {
    if (bundledSha256 !== upstreamSha256) {
      throw new Error(`unmodified terminal agent icon differs from pinned upstream: ${filePath}`);
    }
    return;
  }

  if (bytes.length < 2 || bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a) {
    throw new Error(`terminal agent icon must add exactly one trailing newline: ${filePath}`);
  }
  if (sha256(bytes.subarray(0, -1)) !== upstreamSha256) {
    throw new Error(`terminal agent icon differs from pinned upstream beyond one trailing newline: ${filePath}`);
  }
}
