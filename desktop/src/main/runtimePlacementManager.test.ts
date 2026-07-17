import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadAssetMocks = vi.hoisted(() => ({
  prepareDesktopRuntimeUploadAsset: vi.fn(),
}));

vi.mock('./runtimePackageCache', async () => {
  const actual = await vi.importActual<typeof import('./runtimePackageCache')>('./runtimePackageCache');
  return {
    ...actual,
    prepareDesktopRuntimeUploadAsset: uploadAssetMocks.prepareDesktopRuntimeUploadAsset,
  };
});

import {
  ensureRuntimePlacementReady,
  RuntimePlacementReadinessTimeoutError,
} from './runtimePlacementManager';
import type { RuntimePlacementProgressPhase } from './runtimePlacementManager';
import { DefaultDesktopSSHTransportManager } from './sshTransportManager';

const MANAGED_RUNTIME_BINARY_PATH = '/root/.redeven/runtime/managed/bin/redeven';
const MANAGED_RUNTIME_STAMP_PATH = '/root/.redeven/runtime/managed/managed-runtime.stamp';

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

  async function installFakeDocker(tempDir: string): Promise<Readonly<{
    markerPath: string;
    uploadedArchivePath: string;
    daemonPath: string;
    daemonPidSequencePath: string;
    orphanPath: string;
    notRunningPath: string;
    foreignPath: string;
    eventsPath: string;
  }>> {
    const dockerPath = path.join(tempDir, 'docker');
    const markerPath = path.join(tempDir, 'installed');
    const uploadedArchivePath = path.join(tempDir, 'uploaded-archive');
    const daemonPath = path.join(tempDir, 'daemon');
    const daemonPidSequencePath = path.join(tempDir, 'daemon-pid-sequence');
    const orphanPath = path.join(tempDir, 'orphan');
    const notRunningPath = path.join(tempDir, 'not-running-status');
    const foreignPath = path.join(tempDir, 'foreign-runtime');
    const eventsPath = path.join(tempDir, 'events');
    await fs.writeFile(dockerPath, [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      `const marker = ${JSON.stringify(markerPath)};`,
      `const uploadedArchive = ${JSON.stringify(uploadedArchivePath)};`,
      `const daemon = ${JSON.stringify(daemonPath)};`,
      `const daemonPidSequence = ${JSON.stringify(daemonPidSequencePath)};`,
      `const orphan = ${JSON.stringify(orphanPath)};`,
      `const notRunning = ${JSON.stringify(notRunningPath)};`,
      `const foreign = ${JSON.stringify(foreignPath)};`,
      `const events = ${JSON.stringify(eventsPath)};`,
      `const managedBinary = ${JSON.stringify(MANAGED_RUNTIME_BINARY_PATH)};`,
      `const managedStamp = ${JSON.stringify(MANAGED_RUNTIME_STAMP_PATH)};`,
      'function event(name) { fs.appendFileSync(events, `${name}\\n`); }',
      'function normalizedReleaseTag(value) {',
      '  const clean = String(value || "").trim();',
      '  return clean.startsWith("v") ? clean : `v${clean}`;',
      '}',
      'function nextDaemonPID() {',
      '  if (!fs.existsSync(daemonPidSequence)) return undefined;',
      '  const values = fs.readFileSync(daemonPidSequence, "utf8").split(/\\s+/).map((value) => value.trim()).filter(Boolean);',
      '  if (values.length === 0) return undefined;',
      '  const current = values[0];',
      '  fs.writeFileSync(daemonPidSequence, (values.length > 1 ? values.slice(1) : values).join("\\n"));',
      '  const pid = Number(current);',
      '  return Number.isInteger(pid) && pid > 0 ? pid : undefined;',
      '}',
      'function processInventory() {',
      '  const instances = [];',
      '  if (fs.existsSync(daemon)) {',
      '    const storedPID = Number(fs.readFileSync(daemon, "utf8"));',
      '    instances.push({ pid: Number.isInteger(storedPID) && storedPID > 0 ? storedPID : 4242, process_started_at_unix_ms: 1000, desktop_owner_id: "owner", state_root: "/root/.redeven", executable_path: managedBinary, executable_device: 1, executable_inode: 2, namespace_id: "mnt:[container]", runtime_version: fs.existsSync(marker) ? normalizedReleaseTag(fs.readFileSync(marker, "utf8")) : "v0.0.0-dev", identity_status: "verified", owner_status: "current", layout_status: "current", owner_evidence: "process_environment", stop_authority: "automatic" });',
      '  }',
      '  if (fs.existsSync(orphan)) {',
      '    instances.push({ pid: 4343, process_started_at_unix_ms: 900, state_root: "/root/.redeven", executable_path: managedBinary, executable_device: 3, executable_inode: 4, namespace_id: "mnt:[container]", reason_code: "runtime_owner_identity_unavailable", identity_status: "verified", owner_status: "missing", layout_status: "current", owner_evidence: "missing", stop_authority: "confirmed_takeover" });',
      '  }',
      '  if (fs.existsSync(foreign)) {',
      '    instances.push({ pid: 4444, process_started_at_unix_ms: 800, desktop_owner_id: "another-owner", state_root: "/root/.redeven", executable_path: managedBinary, executable_device: 5, executable_inode: 6, namespace_id: "mnt:[container]", reason_code: "runtime_owned_by_another_desktop", identity_status: "verified", owner_status: "foreign", layout_status: "current", owner_evidence: "process_environment", stop_authority: "confirmed_takeover" });',
      '  }',
      '  const automatic = instances.filter((entry) => entry.stop_authority === "automatic").length;',
      '  const confirmedTakeover = instances.filter((entry) => entry.stop_authority === "confirmed_takeover").length;',
      '  const blocked = instances.filter((entry) => entry.stop_authority === "blocked").length;',
      '  return { schema_version: 2, scope: { runtime_root: "/root/.redeven", state_root: "/root/.redeven", desktop_owner_id: "owner", user_identity: "root", namespace_id: "mnt:[container]" }, inventory_digest: instances.length > 0 ? "a".repeat(64) : "b".repeat(64), instances, summary: { automatic, confirmed_takeover: confirmedTakeover, blocked } };',
      '}',
      'function processCommandEnvelope(operation) {',
      '  const before = processInventory();',
      '  if (operation === "stop") { try { fs.unlinkSync(daemon); } catch {} try { fs.unlinkSync(orphan); } catch {} try { fs.unlinkSync(foreign); } catch {} event("stop"); const after = processInventory(); return JSON.stringify({ schema_version: 2, before, after, stopped: before.instances }); }',
      '  return JSON.stringify(before);',
      '}',
      'const args = process.argv.slice(2);',
      'if (args[0] === "inspect") {',
      '  process.stdout.write(JSON.stringify([{ Id: args[1], Name: "/dev", State: { Running: true, Status: "running" } }]));',
      '  process.exit(0);',
      '}',
      'if (args[0] === "exec") {',
      '  const markerIndex = args.findIndex((value) => value.startsWith("redeven-container-"));',
      '  const execMarker = markerIndex >= 0 ? args[markerIndex] : "";',
      '  if (execMarker === "redeven-container-runtime-inventory") {',
      '    const exitCode = fs.existsSync(marker) ? 0 : 127;',
      '    process.stdout.write(`__REDEVEN_RUNTIME_PROCESS_EXIT__=${exitCode}\\n`);',
      '    if (exitCode === 0) process.stdout.write(processCommandEnvelope("inventory"));',
      '    process.exit(0);',
      '  }',
      '  if (execMarker === "redeven-container-runtime-stop-all") { process.stdout.write("__REDEVEN_RUNTIME_PROCESS_EXIT__=0\\n" + processCommandEnvelope("stop")); process.exit(0); }',
      '  if (execMarker === "redeven-container-runtime-process-helper") {',
      '    fs.readFileSync(0);',
      '    const operation = args[markerIndex + 5];',
      '    process.stdout.write("__REDEVEN_RUNTIME_PROCESS_EXIT__=0\\n" + processCommandEnvelope(operation));',
      '    process.exit(0);',
      '  }',
      '  if (execMarker === "redeven-container-runtime-start" || (args.includes("run") && args.includes("--desktop-managed"))) { event("run"); fs.writeFileSync(daemon, "running"); process.exit(0); }',
      '  if (execMarker === "redeven-container-runtime-status" || args.includes("desktop-runtime-status")) {',
      '    if (fs.existsSync(orphan)) { event("orphan_status"); fs.unlinkSync(orphan); process.stdout.write(JSON.stringify({ status: "blocked", code: "live_process_without_management_socket", message: "A Redeven runtime process is alive, but its management socket is not reachable.", lock_owner: { pid: 4242, desktop_managed: true, desktop_owner_id: "owner" }, diagnostics: { lock_pid: 4242, pid_alive: true, attach_state: "live_process_without_management_socket", failure_code: "management_socket_unreachable", socket_reachable: false } })); process.exit(0); }',
      '    if (fs.existsSync(notRunning)) { event("not_running_status"); fs.unlinkSync(notRunning); process.stdout.write(JSON.stringify({ status: "blocked", code: "not_running", message: "Runtime daemon is not running.", diagnostics: { attach_state: "not_running" } })); process.exit(0); }',
      '    if (!fs.existsSync(daemon)) { process.stderr.write("runtime daemon is not running\\n"); process.exit(1); }',
      '    const pid = nextDaemonPID();',
      '    const report = { local_ui_url: "http://127.0.0.1:43210/", local_ui_urls: ["http://127.0.0.1:43210/"], password_required: false, desktop_managed: true, desktop_owner_id: "owner", runtime_control: { protocol_version: "runtime-control-v1", base_url: "http://127.0.0.1:43211/", token: "token", desktop_owner_id: "owner" }, runtime_service: { status: "online", desktop_managed: true, effective_run_mode: "local", remote_enabled: false } };',
      '    if (pid) { report.pid = pid; fs.writeFileSync(daemon, String(pid)); }',
      '    process.stdout.write(JSON.stringify(report));',
      '    process.exit(0);',
      '  }',
      '  if (execMarker === "redeven-container-runtime-stop" || args.includes("desktop-runtime-stop")) { event("stop"); try { fs.unlinkSync(daemon); } catch {} try { fs.unlinkSync(orphan); } catch {} process.exit(0); }',
      '  const script = args.includes("-c") ? args[args.indexOf("-c") + 1] : "";',
      '  if (script.includes("uname -s")) { process.stdout.write("Linux\\nx86_64\\n"); process.exit(0); }',
      '  if (execMarker === "redeven-container-runtime-probe") {',
      '    const expectedReleaseTag = normalizedReleaseTag(args[markerIndex + 2]);',
      '    if (fs.existsSync(marker)) {',
      '      const installedReleaseTag = normalizedReleaseTag(fs.readFileSync(marker, "utf8"));',
      '      process.stdout.write(`status=ready\\nslot_release_tag=${installedReleaseTag}\\nreported_release_tag=${installedReleaseTag}\\ntarget_release_tag=${expectedReleaseTag}\\nbinary_path=${managedBinary}\\nstamp_path=${managedStamp}\\nreason=ready\\n`);',
      '    } else {',
      '      process.stdout.write(`status=missing_binary\\nslot_release_tag=\\nreported_release_tag=\\ntarget_release_tag=${expectedReleaseTag}\\nbinary_path=${managedBinary}\\nstamp_path=${managedStamp}\\nreason=missing\\n`);',
      '    }',
      '    process.exit(0);',
      '  }',
      '  if (execMarker === "redeven-container-upload-driver") {',
      '    event("install");',
      '    const installedReleaseTag = normalizedReleaseTag(args[markerIndex + 2]);',
      '    const chunks = [];',
      '    process.stdin.on("data", (chunk) => chunks.push(chunk));',
      '    process.stdin.on("end", () => { fs.writeFileSync(uploadedArchive, Buffer.concat(chunks)); fs.writeFileSync(marker, installedReleaseTag); process.exit(0); });',
      '    return;',
      '  }',
      '}',
      'process.stderr.write(`unexpected docker args: ${args.join(" ")}\\n`);',
      'process.exit(1);',
    ].join('\n'), { mode: 0o755 });
    process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;
    return { markerPath, uploadedArchivePath, daemonPath, daemonPidSequencePath, orphanPath, notRunningPath, foreignPath, eventsPath };
  }

  async function installFakeSSH(tempDir: string): Promise<void> {
    const sshPath = path.join(tempDir, 'ssh');
    await fs.writeFile(sshPath, [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const { spawnSync } = require("node:child_process");',
      'const args = process.argv.slice(2);',
      'const socketIndex = args.indexOf("-S");',
      'const socketPath = socketIndex >= 0 ? args[socketIndex + 1] : "";',
      'if (args.includes("-M") && args.includes("-N")) {',
      '  fs.writeFileSync(socketPath, "ready");',
      '  const close = () => { try { fs.unlinkSync(socketPath); } catch {} process.exit(0); };',
      '  process.on("SIGTERM", close);',
      '  process.on("SIGINT", close);',
      '  setInterval(() => {}, 1000);',
      '  return;',
      '}',
      'if (args.includes("-O") && args[args.indexOf("-O") + 1] === "check") {',
      '  process.exit(socketPath && fs.existsSync(socketPath) ? 0 : 255);',
      '}',
      'const command = args[args.length - 1] || "";',
      'if (command === "" || command.startsWith("-")) {',
      '  process.stderr.write(`unexpected ssh args: ${args.join(" ")}\\n`);',
      '  process.exit(1);',
      '}',
      'const input = fs.readFileSync(0);',
      'const result = spawnSync("sh", ["-c", command], { input, encoding: "buffer", env: process.env });',
      'if (result.stdout) process.stdout.write(result.stdout);',
      'if (result.stderr) process.stderr.write(result.stderr);',
      'if (result.error) { process.stderr.write(String(result.error)); process.exit(1); }',
      'process.exit(result.status === null ? 1 : result.status);',
    ].join('\n'), { mode: 0o755 });
  }

  it('installs a missing runtime inside a running local container before returning a bridge binary path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, uploadedArchivePath } = await installFakeDocker(tempDir);
    const progressPhases: RuntimePlacementProgressPhase[] = [];

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
      desktop_owner_id: 'owner',
      on_progress: (progress) => {
        progressPhases.push(progress.phase);
      },
    });

    expect(ready.runtime_binary_path).toBe(MANAGED_RUNTIME_BINARY_PATH);
    expect(ready.probe).toMatchObject({
      status: 'ready',
      slot_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.3',
      target_release_tag: 'v1.2.3',
      binary_path: MANAGED_RUNTIME_BINARY_PATH,
      stamp_path: MANAGED_RUNTIME_STAMP_PATH,
    });
    expect(await fs.readFile(markerPath, 'utf8')).toBe('v1.2.3');
    expect(await fs.readFile(uploadedArchivePath, 'utf8')).toBe('redeven-archive');
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledWith(expect.objectContaining({
      runtimeReleaseTag: 'v1.2.3',
      platform: expect.objectContaining({ platform_id: 'linux_amd64' }),
    }));
    expect(progressPhases).toEqual([
      'checking_container',
      'detecting_platform',
      'discovering_runtime_instances',
      'checking_runtime',
      'preparing_runtime_package',
      'installing_runtime',
      'starting_runtime_daemon',
      'waiting_runtime_daemon',
      'verifying_runtime_inventory',
      'runtime_ready',
    ]);
  });

  it('does not replace a ready container runtime when Start sees an older installed version than the Desktop target', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v0.6.10');
    const progressPhases: RuntimePlacementProgressPhase[] = [];

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v0.0.0-dev',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
      desktop_owner_id: 'owner',
      on_progress: (progress) => {
        progressPhases.push(progress.phase);
      },
    });

    expect(ready.runtime_binary_path).toBe(MANAGED_RUNTIME_BINARY_PATH);
    expect(ready.probe).toMatchObject({
      status: 'ready',
      slot_release_tag: 'v0.6.10',
      reported_release_tag: 'v0.6.10',
      target_release_tag: 'v0.0.0-dev',
      binary_path: MANAGED_RUNTIME_BINARY_PATH,
      stamp_path: MANAGED_RUNTIME_STAMP_PATH,
    });
    expect(await fs.readFile(markerPath, 'utf8')).toBe('v0.6.10');
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledTimes(2);
    expect(progressPhases).toEqual([
      'checking_container',
      'detecting_platform',
      'discovering_runtime_instances',
      'checking_runtime',
      'starting_runtime_daemon',
      'waiting_runtime_daemon',
      'verifying_runtime_inventory',
      'runtime_ready',
    ]);
  });

  it('installs a missing container runtime from the current source runtime', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, uploadedArchivePath } = await installFakeDocker(tempDir);

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
      desktop_owner_id: 'owner',
    });

    expect(ready.runtime_binary_path).toBe(MANAGED_RUNTIME_BINARY_PATH);
    expect(ready.probe.reported_release_tag).toBe('v1.2.3');
    expect(await fs.readFile(markerPath, 'utf8')).toBe('v1.2.3');
    expect(await fs.readFile(uploadedArchivePath, 'utf8')).toBe('redeven-archive');
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledWith(expect.objectContaining({
      runtimeReleaseTag: 'v1.2.3',
      sourceRuntimeRoot: tempDir,
      platform: expect.objectContaining({ platform_id: 'linux_amd64' }),
    }));
  });

  it('replaces a ready container runtime when the user explicitly requests an update', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, uploadedArchivePath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v0.6.10');

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v0.0.0-dev',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
      force_runtime_update: true,
      desktop_owner_id: 'owner',
    });

    expect(ready.runtime_binary_path).toBe(MANAGED_RUNTIME_BINARY_PATH);
    expect(ready.probe).toMatchObject({
      status: 'ready',
      slot_release_tag: 'v0.0.0-dev',
      reported_release_tag: 'v0.0.0-dev',
      target_release_tag: 'v0.0.0-dev',
      binary_path: MANAGED_RUNTIME_BINARY_PATH,
      stamp_path: MANAGED_RUNTIME_STAMP_PATH,
    });
    expect(await fs.readFile(markerPath, 'utf8')).toBe('v0.0.0-dev');
    expect(await fs.readFile(uploadedArchivePath, 'utf8')).toBe('redeven-archive');
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledWith(expect.objectContaining({
      runtimeReleaseTag: 'v0.0.0-dev',
      sourceRuntimeRoot: tempDir,
      platform: expect.objectContaining({ platform_id: 'linux_amd64' }),
    }));
  });

  it('stops the verified container inventory before switching the staged update and starting a new process', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, daemonPath, daemonPidSequencePath, eventsPath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v0.6.10');
    await fs.writeFile(daemonPath, '1111');
    await fs.writeFile(daemonPidSequencePath, '2222');

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
      runtime_process_intent: 'update',
      force_runtime_update: true,
      previous_runtime_pid: 1111,
      require_new_daemon: true,
      desktop_owner_id: 'owner',
    });

    expect(ready.startup?.pid).toBe(2222);
    expect(await fs.readFile(eventsPath, 'utf8')).toBe('stop\ninstall\nrun\n');
  });

  it('keeps container Restart version-stable when the installed runtime package is missing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { eventsPath, uploadedArchivePath } = await installFakeDocker(tempDir);

    await expect(ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
      runtime_process_intent: 'restart',
      desktop_owner_id: 'owner',
    })).rejects.toMatchObject({
      name: 'RuntimePlacementMaintenanceRequiredError',
      message: expect.stringContaining('Update this container runtime'),
    });

    expect(await fs.readFile(eventsPath, 'utf8').catch(() => '')).toBe('');
    await expect(fs.stat(uploadedArchivePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not stop, switch, or start when container inventory contains a foreign owner', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, foreignPath, eventsPath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v0.6.10');
    await fs.writeFile(foreignPath, 'another-owner');

    await expect(ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      source_runtime_root: tempDir,
      asset_cache_root: tempDir,
      runtime_process_intent: 'update',
      force_runtime_update: true,
      desktop_owner_id: 'owner',
    })).rejects.toMatchObject({ name: 'RuntimeProcessTakeoverRequiredError' });

    expect(await fs.readFile(markerPath, 'utf8')).toBe('v0.6.10');
    expect(await fs.readFile(eventsPath, 'utf8').catch(() => '')).toBe('');
  });

  it('requires takeover confirmation when owner evidence is missing in a container', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, orphanPath, eventsPath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v0.6.10');
    await fs.writeFile(orphanPath, 'old-daemon-without-management-socket');
    const progressPhases: RuntimePlacementProgressPhase[] = [];

    await expect(ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
      desktop_owner_id: 'owner',
      on_progress: (progress) => {
        progressPhases.push(progress.phase);
      },
    })).rejects.toMatchObject({ name: 'RuntimeProcessTakeoverRequiredError' });

    expect(await fs.readFile(eventsPath, 'utf8').catch(() => '')).toBe('');
    expect(progressPhases).toEqual([
      'checking_container',
      'detecting_platform',
      'discovering_runtime_instances',
    ]);
  });

  it('waits through not-running status reports without converting them to restart maintenance', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, notRunningPath, eventsPath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v0.6.10');
    await fs.writeFile(notRunningPath, 'first-status-poll');
    const progressPhases: RuntimePlacementProgressPhase[] = [];

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
      desktop_owner_id: 'owner',
      on_progress: (progress) => {
        progressPhases.push(progress.phase);
      },
    });

    expect(ready.runtime_binary_path).toBe(MANAGED_RUNTIME_BINARY_PATH);
    expect(ready.probe.reported_release_tag).toBe('v0.6.10');
    expect(await fs.readFile(eventsPath, 'utf8')).toBe('run\nnot_running_status\n');
    expect(progressPhases).toContain('waiting_runtime_daemon');
  });

  it('waits past the previous daemon pid during replacement and accepts the new daemon pid', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, daemonPidSequencePath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v1.2.3');
    await fs.writeFile(daemonPidSequencePath, '1111\n2222');

    const ready = await ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
      previous_runtime_pid: 1111,
      require_new_daemon: true,
      timeout_ms: 1_500,
      desktop_owner_id: 'owner',
    });

    expect(ready.startup?.pid).toBe(2222);
    expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledTimes(2);
  });

  it('times out when replacement readiness keeps reporting the previous daemon pid', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, daemonPidSequencePath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v1.2.3');
    await fs.writeFile(daemonPidSequencePath, '1111');

    const readiness = ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
      previous_runtime_pid: 1111,
      require_new_daemon: true,
      timeout_ms: 50,
      desktop_owner_id: 'owner',
    });

    try {
      await readiness;
      throw new Error('expected readiness timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimePlacementReadinessTimeoutError);
      expect(error).toMatchObject({
        name: 'RuntimePlacementReadinessTimeoutError',
        message: expect.stringContaining('previous process pid 1111'),
      });
    }
  });

  it('times out when replacement readiness never reports a daemon pid', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath } = await installFakeDocker(tempDir);
    await fs.writeFile(markerPath, 'v1.2.3');

    const readiness = ensureRuntimePlacementReady({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://example.invalid/releases',
      asset_cache_root: tempDir,
      require_new_daemon: true,
      timeout_ms: 50,
      desktop_owner_id: 'owner',
    });

    try {
      await readiness;
      throw new Error('expected readiness timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimePlacementReadinessTimeoutError);
      expect(error).toMatchObject({
        name: 'RuntimePlacementReadinessTimeoutError',
        message: expect.stringContaining('did not include a process pid'),
      });
    }
  });

  it('installs an SSH container runtime through the same Desktop package cache path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-placement-manager-'));
    const { markerPath, uploadedArchivePath } = await installFakeDocker(tempDir);
    await installFakeSSH(tempDir);
    const progressPhases: RuntimePlacementProgressPhase[] = [];
    const sshTransportManager = new DefaultDesktopSSHTransportManager({
      readyPollMs: 1,
      dependencies: { tempRoot: tempDir },
    });

    try {
      const ready = await ensureRuntimePlacementReady({
        host_access: {
          kind: 'ssh_host',
          ssh: {
            ssh_destination: 'devbox',
            ssh_port: 2222,
            auth_mode: 'key_agent',
            connect_timeout_seconds: 1,
          },
        },
        placement: {
          kind: 'container_process',
          container_engine: 'docker',
          container_id: 'dev',
          container_ref: 'dev',
          container_label: 'dev',
          runtime_root: '/root/.redeven',
          bridge_strategy: 'exec_stream',
        },
        ssh_transport_manager: sshTransportManager,
        ssh_credential_scope: tempDir,
        runtime_release_tag: 'v1.2.3',
        release_base_url: 'https://example.invalid/releases',
        asset_cache_root: tempDir,
        desktop_owner_id: 'owner',
        on_progress: (progress) => {
          progressPhases.push(progress.phase);
        },
      });

      expect(ready.runtime_binary_path).toBe(MANAGED_RUNTIME_BINARY_PATH);
      expect(ready.probe.reported_release_tag).toBe('v1.2.3');
      expect(await fs.readFile(markerPath, 'utf8')).toBe('v1.2.3');
      expect(await fs.readFile(uploadedArchivePath, 'utf8')).toBe('redeven-archive');
      expect(uploadAssetMocks.prepareDesktopRuntimeUploadAsset).toHaveBeenCalledWith(expect.objectContaining({
        runtimeReleaseTag: 'v1.2.3',
        platform: expect.objectContaining({ platform_id: 'linux_amd64' }),
      }));
      expect(progressPhases).toEqual([
        'checking_host',
        'checking_container',
        'detecting_platform',
        'discovering_runtime_instances',
        'checking_runtime',
        'preparing_runtime_package',
        'installing_runtime',
        'starting_runtime_daemon',
        'waiting_runtime_daemon',
        'verifying_runtime_inventory',
        'runtime_ready',
      ]);
    } finally {
      await sshTransportManager.dispose();
    }
  }, 15_000);
});
