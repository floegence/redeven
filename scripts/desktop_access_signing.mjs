import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const setting = 'REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY';
const supported = /^(Apple Development|Developer ID Application): /u;

function readSigningIdentities() {
  return execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Resolve once before cache identity and service shutdown. The exact certificate
// fingerprint flows through staging; never fall back to ad-hoc signing or pick
// whichever certificate happens to appear first in the keychain search list.
export function resolveDesktopAccessSigningIdentity({
  development = true, identity, environment = process.env, listIdentities = readSigningIdentities,
} = {}) {
  const requested = identity ?? environment[setting] ?? environment.REDEVEN_DESKTOP_MAC_IDENTITY;
  if (requested !== undefined && (!requested.trim() || requested.trim() === '-')) {
    throw new Error(`Set ${setting} to a valid Apple Development or Developer ID Application certificate. Ad-hoc signing cannot preserve desktop access permissions.`);
  }
  if (!development && requested === undefined) {
    throw new Error(`Production desktop access requires an explicit ${setting} or REDEVEN_DESKTOP_MAC_IDENTITY.`);
  }
  const certificates = new Map();
  for (const line of listIdentities().split(/\r?\n/u)) {
    const match = /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"\n]+)"\s*$/u.exec(line);
    if (match && supported.test(match[2])) certificates.set(match[1].toUpperCase(), match[2]);
  }
  const available = [...certificates].map(([hash, name]) => ({ hash, name }));
  let candidates;
  if (requested !== undefined) {
    const value = requested.trim();
    candidates = available.filter(item => item.hash === value.toUpperCase() || item.name === value);
  } else {
    const developmentCertificates = available.filter(item => item.name.startsWith('Apple Development: '));
    candidates = developmentCertificates.length ? developmentCertificates : available;
  }
  if (!candidates.length) {
    throw new Error(`No valid Apple Development or Developer ID Application certificate${requested === undefined ? ' is available' : ' matches the configured identity'}. Add the certificate and private key to an unlocked keychain, or set ${setting} to its exact fingerprint.`);
  }
  if (candidates.length !== 1) {
    throw new Error(`Multiple desktop access signing certificates match. Set ${setting} to one exact fingerprint:\n${candidates.map(item => `  ${item.hash} ${item.name}`).join('\n')}`);
  }
  return candidates[0].hash;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(resolveDesktopAccessSigningIdentity());
  } catch (error) {
    console.error(`[desktop-access] ${error.message}`);
    process.exitCode = 1;
  }
}
