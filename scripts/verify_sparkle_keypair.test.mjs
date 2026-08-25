import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { publicSparkleKeyFromPrivateSeed, verifySparkleKeypair } from './verify_sparkle_keypair.mjs';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey: pkcs8.subarray(pkcs8.length - 32).toString('base64'),
    publicKey: spki.subarray(spki.length - 32).toString('base64'),
  };
}

test('derives and verifies the Sparkle public key without exposing the private key', () => {
  const keys = fixture();
  assert.equal(publicSparkleKeyFromPrivateSeed(keys.privateKey), keys.publicKey);
  assert.doesNotThrow(() => verifySparkleKeypair(keys.privateKey, keys.publicKey));
});

test('rejects a mismatched Sparkle keypair', () => {
  const left = fixture();
  const right = fixture();
  assert.throws(
    () => verifySparkleKeypair(left.privateKey, right.publicKey),
    /does not match/u,
  );
});
