import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DesktopServiceKit } from './remoteDesktopDeployment';

// Released SDK bytes come only from the trusted bundled Runtime. Renderer input
// may choose a supported architecture, never sources, commands or manifests.
export async function loadDesktopServiceKit(executable: string, architecture: 'amd64' | 'arm64', signal: AbortSignal): Promise<DesktopServiceKit> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-kit-'));
  const output = path.join(directory, 'kit');
  try {
    const manifest = await new Promise<{ service_sha256: string; worker_sha256: string }>((resolve, reject) => {
      const child = spawn(executable, ['desktop-service-kit', '--arch', architecture, '--output', output], { signal, stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '', failed = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 4096) { failed = true; child.kill(); } });
      child.once('error', () => { failed = true; });
      child.once('close', code => {
        try {
          const value = JSON.parse(stdout);
          if (failed || code !== 0 || !value || !/^[a-f0-9]{64}$/u.test(value.service_sha256) || !/^[a-f0-9]{64}$/u.test(value.worker_sha256)) throw new Error('Invalid service kit');
          resolve(value);
        } catch { reject(new Error('Desktop service kit unavailable')); }
      });
    });
    const files = new Map<string, Buffer>();
    for (const name of ['floe-host-desktop-service', 'desktop-drm', 'libdrmtap.LICENSE']) files.set(name, await fs.readFile(path.join(output, name)));
    return { files, serviceSHA256: manifest.service_sha256, workerSHA256: manifest.worker_sha256 };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
