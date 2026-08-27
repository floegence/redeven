import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { ensureManagedLinuxRuntimeReady, openManagedLinuxRuntimeProcessSession } from './managedLinuxRuntime';
import { createWSLRuntimeHostExecutor } from './runtimeHostAccess';
import { startRuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';

const execFileAsync = promisify(execFile);
const distributionA = String(process.env.REDEVEN_WSL_CERT_DISTRIBUTION_A ?? '').trim();
const distributionB = String(process.env.REDEVEN_WSL_CERT_DISTRIBUTION_B ?? '').trim();
const runtimeArchive = String(process.env.REDEVEN_WSL_CERT_RUNTIME_ARCHIVE ?? '').trim();
const runtimeReleaseTag = String(process.env.REDEVEN_WSL_CERT_RUNTIME_RELEASE_TAG ?? '').trim();
const certificationEnabled = process.platform === 'win32'
  && distributionA !== ''
  && distributionB !== ''
  && runtimeArchive !== ''
  && runtimeReleaseTag !== '';

const certification = describe.runIf(certificationEnabled);

certification('Windows WSL 2 certification', () => {
  it('isolates two distributions across install, Bridge, external shutdown, update, retry, and exact stop', async () => {
    const runIdentity = String(process.env.GITHUB_RUN_ID ?? process.pid).replace(/[^0-9A-Za-z.-]/gu, '-');
    const targets = [distributionA, distributionB].map((distribution, index) => {
      const runtimeRoot = `/root/.redeven-cert-${runIdentity}-${index + 1}`;
      return {
        distribution,
        hostAccess: {
          kind: 'wsl_host' as const,
          distribution_name: distribution,
          linux_user: 'root',
        },
        placement: {
          kind: 'host_process' as const,
          runtime_root: runtimeRoot,
          runtime_state_root: `${runtimeRoot}/state`,
          bootstrap_strategy: 'desktop_upload' as const,
          release_base_url: 'https://invalid.example/redeven-certification',
        },
      };
    });
    const executors = targets.map((target) => createWSLRuntimeHostExecutor(target.hostAccess));
    const ready = await Promise.all(targets.map((target, index) => ensureManagedLinuxRuntimeReady({
      executor: executors[index]!,
      runtime_root: target.placement.runtime_root,
      runtime_state_root: target.placement.runtime_state_root,
      runtime_release_tag: runtimeReleaseTag,
      release_base_url: target.placement.release_base_url,
      asset_cache_root: path.join(os.tmpdir(), `redeven-wsl-cert-${runIdentity}-${index + 1}`),
      managed_runtime_archive_path: runtimeArchive,
      runtime_process_intent: 'start',
      timeout_ms: 120_000,
    })));

    const bridges = await Promise.all(targets.map((target, index) => startRuntimePlacementBridgeSession({
      host_access: target.hostAccess,
      placement: target.placement,
      runtime_binary_path: ready[index]!.runtime_binary_path,
      require_local_ui: true,
      fallback_local_id: `wsl-cert-${index + 1}`,
    })));
    expect(bridges[0]!.placement_target_id).not.toBe(bridges[1]!.placement_target_id);
    for (const bridge of bridges) {
      expect(new URL(bridge.local_ui_url).hostname).toBe('127.0.0.1');
      expect(bridge.startup.local_ui_bridge_token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
    }
    await Promise.all(bridges.map((bridge) => bridge.disconnect()));

    const updated = await ensureManagedLinuxRuntimeReady({
      executor: executors[0]!,
      runtime_root: targets[0]!.placement.runtime_root,
      runtime_state_root: targets[0]!.placement.runtime_state_root,
      runtime_release_tag: runtimeReleaseTag,
      release_base_url: targets[0]!.placement.release_base_url,
      asset_cache_root: path.join(os.tmpdir(), `redeven-wsl-cert-${runIdentity}-update`),
      managed_runtime_archive_path: runtimeArchive,
      runtime_process_intent: 'update',
      timeout_ms: 120_000,
    });
    const interruptedBridge = await startRuntimePlacementBridgeSession({
      host_access: targets[0]!.hostAccess,
      placement: targets[0]!.placement,
      runtime_binary_path: updated.runtime_binary_path,
      require_local_ui: true,
      fallback_local_id: 'wsl-cert-retry',
    });
    await execFileAsync('wsl.exe', ['--terminate', distributionA], { windowsHide: true });
    await expect(interruptedBridge.closed).resolves.toMatchObject({ kind: 'failed' });

    const restarted = await ensureManagedLinuxRuntimeReady({
      executor: executors[0]!,
      runtime_root: targets[0]!.placement.runtime_root,
      runtime_state_root: targets[0]!.placement.runtime_state_root,
      runtime_release_tag: runtimeReleaseTag,
      release_base_url: targets[0]!.placement.release_base_url,
      asset_cache_root: path.join(os.tmpdir(), `redeven-wsl-cert-${runIdentity}-retry`),
      managed_runtime_archive_path: runtimeArchive,
      runtime_process_intent: 'start',
      timeout_ms: 120_000,
    });
    expect(restarted.startup.pid).toBeGreaterThan(0);

    await Promise.all(targets.map(async (target, index) => {
      const processes = openManagedLinuxRuntimeProcessSession({
        executor: executors[index]!,
        runtime_root: target.placement.runtime_root,
        runtime_state_root: target.placement.runtime_state_root,
      });
      const inventory = await processes.inspect();
      expect(inventory.instances).toHaveLength(1);
      const stopped = await processes.stop(inventory);
      expect(stopped.after.instances).toHaveLength(0);
      await executors[index]!.release();
    }));
  }, 10 * 60_000);
});
