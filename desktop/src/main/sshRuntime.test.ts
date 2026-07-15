import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MANAGED_SSH_RUNTIME_STAMP_FILENAME,
  MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION,
  buildManagedSSHActivatePreparedRuntimeScript,
  buildManagedSSHRemoteInstallScript,
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHRuntimeInventoryScript,
  buildManagedSSHRuntimeInventoryStopScript,
  buildManagedSSHStartScript,
  buildManagedSSHUploadedInstallScript,
  buildManagedSSHReportReadScript,
  describeManagedSSHRuntimeProbeResult,
  parseManagedSSHRuntimeProbeResult,
  probeManagedSSHRuntimeStatus,
} from './sshRuntime';

function readSSHRuntimeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshRuntime.ts'), 'utf8');
}

describe('sshRuntime', () => {
  it('returns a structured SSH connection failure without exposing stderr labels as the summary', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-ssh-runtime-test-'));
    const fakeSSH = path.join(tempDir, 'ssh.cjs');
    fs.writeFileSync(fakeSSH, [
      '#!/usr/bin/env node',
      'process.stderr.write("ssh: Could not resolve hostname dify: nodename nor servname provided\\n");',
      'process.exit(255);',
      '',
    ].join('\n'), 'utf8');
    fs.chmodSync(fakeSSH, 0o755);

    try {
      const probe = await probeManagedSSHRuntimeStatus({
        target: {
          ssh_destination: 'dify',
          ssh_port: null,
          auth_mode: 'key_agent',
          runtime_root: 'remote_default',
          bootstrap_strategy: 'auto',
          release_base_url: '',
          connect_timeout_seconds: 1,
        },
        runtimeReleaseTag: 'v1.2.3',
        sshBinary: fakeSSH,
        tempRoot: tempDir,
        connectTimeoutSeconds: 1,
      });

      expect(probe.status).toBe('failed');
      if (probe.status !== 'failed') {
        return;
      }
      expect(probe.message).toBe('SSH connection to "dify" failed.');
      expect(probe.failure.summary).toBe('SSH connection to "dify" failed.');
      expect(probe.failure.summary).not.toContain('control_stderr');
      expect(probe.failure.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          channel: 'control_stderr',
          label: 'SSH command stderr',
          text: expect.stringContaining('Could not resolve hostname dify'),
        }),
      ]));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds remote install, upload-install, runtime-probe, and report scripts around the unified runtime root', () => {
    expect(buildManagedSSHRemoteInstallScript()).toContain('REDEVEN_INSTALL_MODE=upgrade');
    expect(buildManagedSSHStartScript()).toContain('--state-root "$state_root"');
    expect(buildManagedSSHStartScript()).toContain('--mode desktop');
    expect(buildManagedSSHStartScript()).toContain('--presentation machine');
    expect(buildManagedSSHStartScript()).toContain('--startup-report-file "$report_path"');
    expect(buildManagedSSHStartScript()).not.toContain(['REDEVEN_DESKTOP', 'AI', 'BROKER_TOKEN'].join('_'));
    expect(buildManagedSSHStartScript()).toContain('setsid "$binary" run');
    expect(buildManagedSSHStartScript()).toContain('nohup "$binary" run');
    expect(buildManagedSSHStartScript()).toContain('printf "%s\\n" "$!" > "${session_dir}/launcher.pid"');
    expect(buildManagedSSHStartScript()).not.toContain('exec "$binary" run');
    expect(buildManagedSSHStartScript()).not.toContain('trap cleanup');
    expect(buildManagedSSHStartScript()).toContain('state_root_raw="${2:-}"');
    expect(buildManagedSSHStartScript()).toContain('target_release_tag="${3:-}"');
    expect(buildManagedSSHStartScript()).toContain('session_token="$4"');
    expect(buildManagedSSHStartScript()).toContain('session_dir="${state_root%/}/runtime/sessions/${session_token}"');
    expect(buildManagedSSHStartScript()).toContain('log_dir="${state_root%/}/runtime/logs"');
    expect(buildManagedSSHStartScript()).toContain('binary="${bin_dir}/redeven"');
    expect(buildManagedSSHStartScript()).toContain('managed_root="${runtime_root%/}/runtime/managed"');
    expect(buildManagedSSHStartScript()).not.toContain('runtime/releases/${target_release_tag}/bin/redeven');
    expect(buildManagedSSHStartScript()).not.toContain('runtime/releases/${release_tag}/bin/redeven');
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'status=%s\\n' \"$probe_status\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain(`stamp_path="${'${managed_root}'}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`);
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'slot_release_tag=%s\\n' \"$slot_release_tag\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'reported_release_tag=%s\\n' \"$reported_release_tag\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'target_release_tag=%s\\n' \"$target_release_tag\"");
    expect(buildManagedSSHUploadedInstallScript()).toContain('archive_path="$3"');
    expect(buildManagedSSHUploadedInstallScript()).toContain('uploaded Redeven archive did not contain redeven');
    expect(buildManagedSSHUploadedInstallScript()).toContain('write_runtime_stamp "desktop_upload" "$target_release_tag"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('runtime_root="${HOME%/}/.redeven"');
    expect(buildManagedSSHStartScript()).toContain('state_root="${HOME%/}/.redeven/${state_root#remote_default/}"');
    expect(buildManagedSSHStartScript()).toContain('setsid "$binary" run --state-root "$state_root"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('managed_root="${runtime_root%/}/runtime/managed"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('binary="${bin_dir}/redeven"');
    expect(buildManagedSSHRemoteInstallScript()).not.toContain('release_root="${runtime_root%/}/runtime/releases/${release_tag}"');
    expect(buildManagedSSHRemoteInstallScript()).not.toContain(['redeven', 'desktop', 'runtime'].join('-'));
    expect(buildManagedSSHRemoteInstallScript()).toContain('write_runtime_stamp "remote_install" "$target_release_tag"');
    expect(buildManagedSSHReportReadScript()).toContain('state_root_raw="${2:-}"');
    expect(buildManagedSSHReportReadScript()).toContain('session_token="$3"');
    expect(buildManagedSSHReportReadScript()).toContain('report_path="${state_root%/}/runtime/sessions/${session_token}/startup-report.json"');
    expect(buildManagedSSHRuntimeInventoryScript()).toContain('desktop-runtime-inventory');
    expect(buildManagedSSHRuntimeInventoryScript()).toContain('--include-known-legacy');
    expect(buildManagedSSHRuntimeInventoryScript()).toContain('--desktop-owner-id "$desktop_owner_id"');
    expect(buildManagedSSHRuntimeInventoryStopScript()).toContain('desktop-runtime-stop');
    expect(buildManagedSSHRuntimeInventoryStopScript()).toContain('--all-matching');
    expect(buildManagedSSHRuntimeInventoryStopScript()).toContain('--expected-inventory-digest "$inventory_digest"');
    expect(buildManagedSSHRuntimeInventoryStopScript()).not.toContain('kill "$pid"');
  });

  it('parses structured probe results and normalizes reported release tags', () => {
    expect(parseManagedSSHRuntimeProbeResult([
      'status=slot_version_mismatch',
      'slot_release_tag=v1.2.3',
      'reported_release_tag=1.2.2',
      'target_release_tag=v1.2.4',
      'binary_path=/tmp/redeven',
      'stamp_path=/tmp/managed-runtime.stamp',
      'reason=managed runtime stamp release does not match the installed binary',
    ].join('\n'))).toEqual({
      status: 'slot_version_mismatch',
      slot_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.2',
      target_release_tag: 'v1.2.4',
      binary_path: '/tmp/redeven',
      stamp_path: '/tmp/managed-runtime.stamp',
      reason: 'managed runtime stamp release does not match the installed binary',
    });
  });

  it('describes managed SSH version and stamp mismatches with actionable paths', () => {
    const cases = [
      {
        status: 'slot_version_mismatch' as const,
        expected: 'reports v1.2.2, but its Desktop stamp records v1.2.3',
      },
      {
        status: 'stamp_missing' as const,
        expected: 'Managed runtime stamp is missing at /opt/redeven/managed-runtime.stamp',
      },
      {
        status: 'stamp_invalid' as const,
        expected: 'Managed runtime stamp at /opt/redeven/managed-runtime.stamp is invalid',
      },
    ];

    for (const item of cases) {
      const description = describeManagedSSHRuntimeProbeResult({
        status: item.status,
        slot_release_tag: 'v1.2.3',
        reported_release_tag: 'v1.2.2',
        target_release_tag: 'v1.2.4',
        binary_path: '/opt/redeven/bin/redeven',
        stamp_path: '/opt/redeven/managed-runtime.stamp',
        reason: 'probe reason',
      });
      expect(description.toLowerCase()).toContain(item.expected.toLowerCase());
    }
  });

  it('probe shell validates binary version before trusting the managed stamp', () => {
    const script = buildManagedSSHRuntimeProbeScript();
    const versionProbeIndex = script.indexOf('version_output="$("$binary" version 2>/dev/null)"');
    const reportedVersionIndex = script.indexOf('reported_release_tag="$2"', versionProbeIndex);
    const stampExistsIndex = script.indexOf('if [ ! -f "$stamp_path" ]; then');
    const stampSchemaIndex = script.indexOf(`schema_version=${MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION}`, stampExistsIndex);

    expect(versionProbeIndex).toBeGreaterThanOrEqual(0);
    expect(reportedVersionIndex).toBeGreaterThan(versionProbeIndex);
    expect(stampExistsIndex).toBeGreaterThan(reportedVersionIndex);
    expect(stampSchemaIndex).toBeGreaterThan(stampExistsIndex);
    expect(script).toContain("printf 'reported_release_tag=%s\\n' \"$reported_release_tag\"");
  });

  it('writes schema v2 stamps and stages verified replacements before updating the managed slot', () => {
    const remoteInstallScript = buildManagedSSHRemoteInstallScript();
    const uploadedInstallScript = buildManagedSSHUploadedInstallScript();
    const activateScript = buildManagedSSHActivatePreparedRuntimeScript();
    const probeScript = buildManagedSSHRuntimeProbeScript();

    for (const script of [remoteInstallScript, uploadedInstallScript, probeScript]) {
      expect(script).toContain(`schema_version=${MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION}`);
      expect(script).toContain('slot_release_tag=');
      expect(script).toContain('installed_at_unix_ms=');
    }

    expect(remoteInstallScript).toContain('staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"');
    expect(remoteInstallScript).toContain('REDEVEN_INSTALL_DIR="$staging_bin_dir"');
    expect(remoteInstallScript).toContain('staged_binary="${staging_bin_dir}/redeven"');
    expect(remoteInstallScript).toContain('if [ "$staged_release_tag" != "$target_release_tag" ]; then');
    expect(remoteInstallScript).toContain('printf "%s\\n" "$staging_root"');
    expect(remoteInstallScript).not.toContain('switch_staged_runtime');
    expect(remoteInstallScript).not.toContain('cleanup_legacy_releases');
    expect(remoteInstallScript).not.toContain('mv "$temp_binary" "$binary"');

    expect(uploadedInstallScript).toContain('staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"');
    expect(uploadedInstallScript).toContain('mv "$binary_path" "${staging_root}/bin/redeven"');
    expect(uploadedInstallScript).toContain('if [ "$staged_release_tag" != "$target_release_tag" ]; then');
    expect(uploadedInstallScript).toContain('printf "%s\\n" "$staging_root"');
    expect(uploadedInstallScript).not.toContain('switch_staged_runtime');
    expect(uploadedInstallScript).not.toContain('cleanup_legacy_releases');
    expect(uploadedInstallScript).not.toContain('mv "$temp_binary" "$binary"');

    expect(activateScript).toContain('"${managed_root}.staging."*)');
    expect(activateScript).toContain('staged_stamp="${staging_root}/managed-runtime.stamp"');
    expect(activateScript).toContain('switch_staged_runtime');
    expect(activateScript).toContain('mv "$managed_root" "$previous_managed_root"');
    expect(activateScript).toContain('if mv "$staging_root" "$managed_root"; then');
    expect(activateScript).toContain('cleanup_legacy_releases');
  });

  it('checks the SSH master socket, probes remote platform, and keeps auto fallback limited to local asset preparation failures', () => {
    const source = readSSHRuntimeSource();

    expect(source).toContain("'-O', 'check',");
    expect(source).toContain("authMode === 'key_agent'");
    expect(source).toContain("'BatchMode=yes'");
    expect(source).toContain("'BatchMode=no'");
    expect(source).toContain("'-T'");
    expect(source).toContain("'-x'");
    expect(source).toContain("'ForwardX11=no'");
    expect(source).toContain("'RequestTTY=no'");
    expect(source).toContain('SSH_ASKPASS_REQUIRE');
    expect(source).toContain("'force'");
    expect(source).toContain('createSSHAskPassScript(tempDir, target.auth_mode)');
    expect(source).toContain('async function probeRemoteRuntimeCompatibility(');
    expect(source).toContain('async function probeRemotePlatform(');
    expect(source).toContain('function resolveDesktopSSHReleaseFetchPolicy(');
    expect(source).toContain("return ['desktop_upload', 'remote_install'];");
    expect(source).toContain('class DesktopSSHUploadAssetPreparationError extends DesktopOperationFailureError');
    expect(source).toContain("runtimeLifecycleStepID: 'preparing_runtime_package'");
    expect(source).toContain('fetchPolicy: releaseFetchPolicy,');
    expect(source).toContain("if (args.target.bootstrap_strategy === 'auto' && error instanceof DesktopSSHUploadAssetPreparationError)");
    expect(source).toContain('allowLegacyMigration: false,');
    expect(source).toContain('return prepared;');
    expect(source).toContain("from './runtimePackageCache'");
    expect(source).toContain('prepareDesktopRuntimeUploadAsset({');
    expect(source).toContain("asset.source === 'source_build_cache'");
    expect(source).toContain('Using cached local runtime package');
    expect(source).toContain('package built from this Desktop session');
    expect(source).toContain('async function waitForForwardedLocalUIOpenable(');
    expect(source).toContain('DEFAULT_RUNTIME_PROBE_TIMEOUT_MS');
    expect(source).toContain('Math.min(DEFAULT_RUNTIME_PROBE_TIMEOUT_MS, remainingDeadlineMs)');
    expect(source).toContain('Math.min(DEFAULT_SSH_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now()))');
    expect(source).toContain('class SSHLocalForwardHandle');
    expect(source).toContain('managedSSHRuntimeAttachPolicy(');
    expect(source).toContain('DesktopSSHRuntimeMaintenanceRequiredError');
    expect(source).toContain('allowActiveWorkReplacement?: boolean;');
    expect(source).toContain('allowActiveWorkReplacement: args.allowActiveWorkReplacement === true');
    expect(source).toContain('requireDesktopModelSource: boolean;');
    expect(source).toContain('const modelSourceUnsupported = args.requireDesktopModelSource');
    expect(source).toContain('runtimeServiceSupportsDesktopModelSource(runtimeService)');
    expect(source).toContain("'desktop_model_source_requires_runtime_update'");
    expect(source).not.toContain('/_redeven_proxy/api/runtime/bindings/');
    expect(source).toContain('const forwarded = await openSSHForwardedRuntime({');
    expect(source).toContain('ready: ManagedSSHRuntimeReady;');
    expect(source).toContain('return await startManagedSSHRuntimeInternal(args, false) as ManagedSSHRuntimeReady;');
    expect(source).toContain('const remoteStartup = args.ready.startup;');
    expect(source).toContain('runtimeServiceIsOpenable(result.value.runtime_service)');
    expect(source).not.toContain('Desktop reached the forwarded Redeven Local UI, but the runtime is not ready to open yet');
    expect(source).toContain('runtime_service: forwardedStartup.runtime_service ?? remoteStartup.runtime_service');
    expect(source).toContain('onProgress?: (progress: DesktopSSHRuntimeProgress) => void;');
    expect(source).toContain("'ssh_connecting'");
    expect(source).toContain("'ssh_uploading_archive'");
    expect(source).toContain("'ssh_waiting_report'");
    expect(source).toContain("'ssh_verifying_tunnel'");
    expect(source).toContain('const result = await runSSHOnce(');
    expect(source).toContain('parseLaunchReport(result.stdout)');
    expect(source).toContain('formatBlockedLaunchDiagnostics(launchReport)');
    expect(source).toContain('const replacementInventory = await inspectManagedSSHRuntimeProcesses(');
    expect(source).toContain('await stopManagedSSHRuntimeProcesses(replacementProcessArgs, replacementInventory, stopTimeoutMs);');
    expect(source).toContain('preparedRuntimePackage = await prepareRemoteRuntimePackage(packageArgs);');
    expect(source).toContain('await stopManagedSSHRuntimeProcesses(processArgs, processInventory, stopTimeoutMs);');
    expect(source).toContain('await activatePreparedRemoteRuntimePackage({');
    expect(source.indexOf('preparedRuntimePackage = await prepareRemoteRuntimePackage(packageArgs);')).toBeLessThan(
      source.indexOf('await stopManagedSSHRuntimeProcesses(processArgs, processInventory, stopTimeoutMs);'),
    );
    expect(source.indexOf('await stopManagedSSHRuntimeProcesses(processArgs, processInventory, stopTimeoutMs);')).toBeLessThan(
      source.indexOf('await activatePreparedRemoteRuntimePackage({'),
    );
    expect(source).not.toContain('kill "$pid"');
    expect(source).toContain('Remote Redeven launcher failed before reporting readiness (${exitReason}).');
  });

  it('threads AbortSignal through SSH child processes, polling loops, and upload cleanup', () => {
    const source = readSSHRuntimeSource();

    expect(source).toContain('export class DesktopSSHRuntimeCanceledError extends Error');
    expect(source).toContain('signal?: AbortSignal;');
    expect(source).toContain('function throwIfSSHRuntimeCanceled(signal: AbortSignal | undefined): void');
    expect(source).toContain('throwIfSSHRuntimeCanceled(signal);');
    expect(source).toContain('signal,');
    expect(source).toContain('reject(new DesktopSSHRuntimeCanceledError());');
    expect(source).toContain('async function waitForForwardedLocalUIOpenable(args: Readonly<{');
    expect(source).toContain('signal: readinessController.signal');
    expect(source).toContain('async function createRemoteTempDir(args: Readonly<{');
    expect(source).toContain('async function prepareRemoteRuntimeViaDesktopUpload(args: Readonly<{');
    expect(source).toContain('const remoteTempDir = await createRemoteTempDir(args);');
    expect(source).toContain('await removeRemotePath({\n      ...args,\n      remotePath: remoteTempDir,\n    });');
    expect(source).toContain('await disconnect();');
    expect(source).toContain('if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {');
  });
});
