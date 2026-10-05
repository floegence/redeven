import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { verifyRuntimeAccessIdentity } from './runtimeAccessIdentity';

describe('Runtime access identity proof', () => {
  it('verifies possession and rejects replay, tampering and noncanonical encodings', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const challenge = randomBytes(32).toString('base64url');
    const proof = { version: 'redeven-runtime-access-v1', challenge,
      public_key: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'),
      signature: sign(null, Buffer.from(`redeven-runtime-access-v1\n${challenge}`), privateKey).toString('base64url') };
    expect(verifyRuntimeAccessIdentity(proof, challenge)).toMatch(/^runtime:[a-f0-9]{64}$/u);
    for (const bad of [{ ...proof, challenge: randomBytes(32).toString('base64url') },
      { ...proof, signature: randomBytes(64).toString('base64url') }, { ...proof, public_key: `${proof.public_key}=` },
      { ...proof, version: 'other' }, undefined]) {
      expect(verifyRuntimeAccessIdentity(bad, challenge)).toBeUndefined();
    }
  });
});
