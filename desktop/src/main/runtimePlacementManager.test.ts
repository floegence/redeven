import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadAssetMocks = vi.hoisted(() => ({
  prepareDesktopRuntimeUploadAsset: vi.fn(),
}));

vi.mock('./runtimeUploadAsset', async () => {
  const actual = await vi.importActual<typeof import('./runtimeUploadAsset')>('./runtimeUploadAsset');
  return {
    ...actual,
    prepareDesktopRuntimeUploadAsset: uploadAssetMocks.prepareDesktopRuntimeUploadAsset,
  };
});

import { ensureRuntimePlacementReady } from './runtimePlacementManager';

describe('runtimePlacementManager', () => {
  let originalPath = '';

  beforeEach(() => {
    originalPath = process.env.PATH ?? '';
    uploadAssetMocks.prepareDesktopRuntimeUploadAsset.mockReset();
    uploadAssetMocks.prepareDesktopRuntimeUploadAsset.mockResolvedValue({
      archiveData: Buffer.from('redeven-archive'),
    });
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  async function installFakeDocker(tempDir: string): Promise<string> {
    const dockerPath = path.join(tempDir, 'docker');
    const markerPath = path.join(tempDir, 'installed');
    await fs.writeFile(dockerPath, [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      `const marker = ${JSON.stringify(markerPath)};`,
      'const args = process.argv.slice(2);',
      'if (args[0] === "inspect") {',
      '  process.stdout.write(JSON.stringify([{ Id: args[1], Name: "/dev", State: { Running: true, Status: "running" } }]));',
      '  process.exit(0);',
      '}',
      'if (args[0] === "exec") {',
      '  const markerIndex = args.findIndex((value) => value.startsWith("redeven-container-"));',
      '  const script = args.includes("-c") ? args[args.indexOf("-c") + 1] : "";',
      '  if (script.includes("uname -s")) { process.stdout.write("Linux\\nx86_64\\n"); process.exit(0); }',
      '  if (args[markerIndex] === "redeven-container-runtime-probe") {',
      '    if (fs.existsSync(marker)) {',
      '      process.stdout.write("status=ready\\nexpected_release_tag=v1.2.3\\nreported_release_tag=v1.2.3\\nbinary_path=/opt/redeven-desktop/runtime/releases/v1.2.3/bin/redeven\\nstamp_path=/opt/redeven-desktop/runtime/releases/v1.2.3/desktop-runtime.stamp\\nreason=ready\\n");',
      '    } else {',
      '      process.stdout.write("status=missing_binary\\nexpected_release_tag=v1.2.3\\nreported_release_tag=\\nbinary_path=/opt/redeven-desktop/runtime/releases/v1.2.3/bin/redeven\\nstamp_path=/opt/redeven-desktop/runtime/releases/v1.2.3/desktop-runtime.stamp\\nreason=missing\\n");',
      '    }',
      '    process.exit(0);',
      '  }',
      '  if (args[markerIndex] === "redeven-container-upload-driver") {',
      '    const chunks = [];',
      '    process.stdin.on("data", (chunk) => chunks.push(chunk));',
      '    process.stdin.on("end", () => { fs.writeFileSync(marker, Buffer.concat(chunks)); process.exit(0); });',
      '    return;',
      '  }',
      '}',
      'process.stderr.write(`unexpected docker args: ${args.join(" ")}\\n`);',
      'process.exit(1);',
    ].join('\n'), { mode: 0o755 });
    process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;
    return markerPath;
  }

  it('installs a missing runtime inside a running local container before returning a bridge binary path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const markerPath = await installFakeDocker(tempDir);

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_label: 'dev',
        runtime_install_root: '/opt/redeven-desktop/runtime',
        runtime_state_root: '/var/lib/redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
    });

    expect(ready.runtime_binary_path).toBe('/opt/redeven-desktop/runtime/releases/v1.2.3/bin/redeven');
    expect(await fs.readFile(markerPath, 'utf8')).toBe('redeven-archive');
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledWith(expect.objectContaining({
      runtimeReleaseTag: 'v1.2.3',
      platform: expect.objectContaining({ platform_id: 'linux_amd64' }),
    }));
  });

  it('replaces a ready container runtime when Desktop is using the current source runtime', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const markerPath = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'old-runtime');

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_label: 'dev',
        runtime_install_root: '/opt/redeven-desktop/runtime',
        runtime_state_root: '/var/lib/redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
    });

    expect(ready.runtime_binary_path).toBe('/opt/redeven-desktop/runtime/releases/v1.2.3/bin/redeven');
    expect(await fs.readFile(markerPath, 'utf8')).toBe('redeven-archive');
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledWith(expect.objectContaining({
      runtimeReleaseTag: 'v1.2.3',
      sourceRuntimeRoot: tempDir,
      platform: expect.objectContaining({ platform_id: 'linux_amd64' }),
    }));
  });
});
