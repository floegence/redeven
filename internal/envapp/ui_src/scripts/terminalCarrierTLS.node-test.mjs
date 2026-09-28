import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:tls';

import { readTLSServerSPKIHash } from './checkSemanticTerminalCarrier.mjs';

test('terminal carrier pins only a server authenticated by its isolated certificate authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'redeven-carrier-tls-'));
  let server;
  try {
    for (const name of ['trusted', 'unrelated']) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout', path.join(root, `${name}.key`), '-out', path.join(root, `${name}.pem`)], { stdio: 'ignore' });
    }
    const cert = await readFile(path.join(root, 'trusted.pem'));
    server = createServer({ cert, key: await readFile(path.join(root, 'trusted.key')) }, socket => socket.end());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `https://127.0.0.1:${server.address().port}`;
    const expected = createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    assert.equal(await readTLSServerSPKIHash(url, path.join(root, 'trusted.pem')), expected);
    await assert.rejects(readTLSServerSPKIHash(url, path.join(root, 'unrelated.pem')), /certificate/i);
    await assert.rejects(readTLSServerSPKIHash(url), /certificate authority/i);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
