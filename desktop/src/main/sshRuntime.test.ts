import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MANAGED_SSH_RUNTIME_STAMP_FILENAME,
  buildManagedSSHRemoteInstallScript,
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHStartScript,
  buildManagedSSHStopScript,
  buildManagedSSHUploadedInstallScript,
  buildManagedSSHReportReadScript,
  describeManagedSSHRuntimeProbeResult,
  parseManagedSSHRuntimeProbeResult,
} from './sshRuntime';

function readSSHRuntimeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshRuntime.ts'), 'utf8');
}

describe('sshRuntime', () => {
  it('builds remote install, upload-install, runtime-probe, and report scripts around the managed install root', () => {
    expect(buildManagedSSHRemoteInstallScript()).toContain('REDEVEN_INSTALL_MODE=upgrade');
    expect(buildManagedSSHStartScript()).toContain('--state-root "$state_root"');
    expect(buildManagedSSHStartScript()).toContain('--mode desktop');
    expect(buildManagedSSHStartScript()).toContain('--startup-report-file "$report_path"');
    expect(buildManagedSSHStartScript()).not.toContain('REDEVEN_DESKTOP_AI_BROKER_TOKEN');
    expect(buildManagedSSHStartScript()).toContain('setsid "$binary" run');
    expect(buildManagedSSHStartScript()).toContain('nohup "$binary" run');
    expect(buildManagedSSHStartScript()).toContain('printf "%s\\n" "$!" > "${session_dir}/launcher.pid"');
    expect(buildManagedSSHStartScript()).not.toContain('exec "$binary" run');
    expect(buildManagedSSHStartScript()).not.toContain('trap cleanup');
    expect(buildManagedSSHStartScript()).toContain('local_environment_root="${install_root%/}/local-environment"');
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'status=%s\\n' \"$probe_status\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain(`stamp_path="${'${release_root}'}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`);
    expect(buildManagedSSHRuntimeProbeScript()).toContain('runtime_release_tag=$release_tag');
    expect(buildManagedSSHUploadedInstallScript()).toContain('archive_path="$3"');
    expect(buildManagedSSHUploadedInstallScript()).toContain('uploaded Redeven archive did not contain redeven');
    expect(buildManagedSSHUploadedInstallScript()).toContain('write_runtime_stamp "desktop_upload"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('if [ -z "$cache_base" ] && [ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ -w "$HOME" ]; then');
    expect(buildManagedSSHRemoteInstallScript()).toContain('install_root="${remote_tmp_dir%/}/redeven-desktop-runtime-${remote_user}"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('release_root="${install_root%/}/releases/${release_tag}"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('force_install="${4:-0}"');
    expect(buildManagedSSHRemoteInstallScript()).toContain('if [ "$force_install" = "1" ] || ! runtime_is_compatible; then');
    expect(buildManagedSSHRemoteInstallScript()).toContain('write_runtime_stamp "remote_install"');
    expect(buildManagedSSHReportReadScript()).toContain('local-environment/sessions/${session_token}/startup-report.json');
    expect(buildManagedSSHStopScript()).toContain('kill "$pid"');
    expect(buildManagedSSHStopScript()).toContain('kill -KILL "$pid"');
  });

  it('parses structured probe results and normalizes reported release tags', () => {
    expect(parseManagedSSHRuntimeProbeResult([
      'status=version_mismatch',
      'expected_release_tag=v1.2.3',
      'reported_release_tag=1.2.2',
      'binary_path=/tmp/redeven',
      'stamp_path=/tmp/desktop-runtime.stamp',
      'reason=managed runtime version does not match the requested Desktop release',
    ].join('\n'))).toEqual({
      status: 'version_mismatch',
      expected_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.2',
      binary_path: '/tmp/redeven',
      stamp_path: '/tmp/desktop-runtime.stamp',
      reason: 'managed runtime version does not match the requested Desktop release',
    });
  });

  it('describes missing or incompatible managed runtimes for diagnostics', () => {
    expect(describeManagedSSHRuntimeProbeResult({
      status: 'stamp_missing',
      expected_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.3',
      binary_path: '/opt/redeven/bin/redeven',
      stamp_path: '/opt/redeven/desktop-runtime.stamp',
      reason: 'managed runtime stamp is missing',
    })).toContain('Desktop stamp is missing');
    expect(describeManagedSSHRuntimeProbeResult({
      status: 'version_mismatch',
      expected_release_tag: 'v1.2.3',
      reported_release_tag: 'v1.2.2',
      binary_path: '/opt/redeven/bin/redeven',
      stamp_path: '/opt/redeven/desktop-runtime.stamp',
      reason: 'managed runtime version does not match the requested Desktop release',
    })).toContain('reports v1.2.2 instead of v1.2.3');
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
    expect(source).toContain('class DesktopSSHUploadAssetPreparationError extends Error');
    expect(source).toContain('fetchPolicy: releaseFetchPolicy,');
    expect(source).toContain("if (args.target.bootstrap_strategy === 'auto' && error instanceof DesktopSSHUploadAssetPreparationError)");
    expect(source).toContain('const uploadProbe = await probeRemoteRuntimeCompatibility(args);');
    expect(source).toMatch(/if \(args\.target\.bootstrap_strategy === 'auto'\) \{\s*break;\s*\}\s*continue;/);
    expect(source).toContain("path.join(sourceRoot, 'scripts', 'build_assets.sh')");
    expect(source).toContain('await buildSourceRuntimeAssets(sourceRoot);');
    expect(source).toContain('async function waitForForwardedLocalUIOpenable(');
    expect(source).toContain('managedSSHRuntimeAttachPolicy(');
    expect(source).toContain('DesktopSSHRuntimeMaintenanceRequiredError');
    expect(source).toContain('allowActiveWorkReplacement: args.forceRuntimeUpdate === true');
    expect(source).toContain('/_redeven_proxy/api/runtime/bindings/desktop-ai-broker');
    expect(source).toContain('Desktop is creating a private SSH bridge for local model calls.');
    expect(source).toContain('Desktop model bridge unavailable: ${message}');
    expect(source).toContain('let forwardedStartup = await waitForForwardedLocalUIOpenable(');
    expect(source).toContain('runtimeServiceIsOpenable(startup.runtime_service)');
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
    expect(source).toContain('async function stopRemoteRuntimeProcess(');
    expect(source).toContain('remoteRuntimePID = remoteStartup.pid ?? null;');
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
    expect(source).toContain('async function waitForForwardedLocalUIOpenable(url: string, timeoutMs: number, signal?: AbortSignal)');
    expect(source).toContain('async function createRemoteTempDir(args: Readonly<{');
    expect(source).toContain('async function installRemoteRuntimeViaDesktopUpload(args: Readonly<{');
    expect(source).toContain('const remoteTempDir = await createRemoteTempDir(args);');
    expect(source).toContain('await removeRemotePath({\n      ...args,\n      remotePath: remoteTempDir,\n    });');
    expect(source).toContain('await disconnect();');
    expect(source).toContain('if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {');
  });
});
