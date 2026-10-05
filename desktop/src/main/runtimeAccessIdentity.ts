import { createHash, createPublicKey, verify } from 'node:crypto';

/** Proof is for display association over the selected transport, never authorization. */
export function verifyRuntimeAccessIdentity(value: unknown, challenge: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const proof = value as Record<string, unknown>;
  if (proof.version !== 'redeven-runtime-access-v1' || proof.challenge !== challenge) return undefined;
  const decode = (raw: unknown, length: number) => {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(raw)) return undefined;
    const bytes = Buffer.from(raw, 'base64url');
    return bytes.length === length && bytes.toString('base64url') === raw ? bytes : undefined;
  };
  const key = decode(proof.public_key, 32);
  const signature = decode(proof.signature, 64);
  if (!key || !signature) return undefined;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(`redeven-runtime-access-v1\n${challenge}`), publicKey, signature)) return undefined;
    return `runtime:${createHash('sha256').update(key).digest('hex')}`;
  } catch { return undefined; }
}
