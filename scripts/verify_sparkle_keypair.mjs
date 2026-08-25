#!/usr/bin/env node

import { constants, lstatSync, openSync, closeSync, readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function decodeBase64Key(value, label) {
  const clean = String(value ?? '').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(clean)) {
    throw new Error(`${label} must be a base64-encoded 32-byte Ed25519 key.`);
  }
  const decoded = Buffer.from(clean, 'base64');
  if (decoded.length !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes.`);
  }
  return decoded;
}

export function publicSparkleKeyFromPrivateSeed(privateKeyValue) {
  const seed = decodeBase64Key(privateKeyValue, 'Sparkle private key');
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 32).toString('base64');
}

export function verifySparkleKeypair(privateKeyValue, expectedPublicKeyValue) {
  const expected = decodeBase64Key(expectedPublicKeyValue, 'Sparkle public key').toString('base64');
  const actual = publicSparkleKeyFromPrivateSeed(privateKeyValue);
  if (actual !== expected) {
    throw new Error('Sparkle private key does not match the configured public key.');
  }
}

function readPrivateKey(file) {
  const absolute = path.resolve(file);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Sparkle private key path must be a regular non-symlink file.');
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const privateKeyPath = String(process.argv[2] ?? '').trim();
    const expectedPublicKey = String(process.env.REDEVEN_SPARKLE_PUBLIC_ED_KEY ?? '').trim();
    if (!privateKeyPath || !expectedPublicKey) {
      throw new Error('usage: REDEVEN_SPARKLE_PUBLIC_ED_KEY=<public-key> verify_sparkle_keypair.mjs <private-key-file>');
    }
    verifySparkleKeypair(readPrivateKey(privateKeyPath), expectedPublicKey);
    process.stdout.write('Sparkle signing keypair verified.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
