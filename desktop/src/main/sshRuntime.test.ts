import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildManagedSSHActivatePreparedRuntimeScript,
  buildManagedSSHRemoteInstallScript,
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHStartScript,
  buildManagedSSHUploadedInstallScript,
  buildManagedSSHReportReadScript,
  describeManagedSSHRuntimeProbeResult,
  parseManagedSSHRuntimeProbeResult,
  probeManagedSSHRuntimeStatus,
} from './sshRuntime';
import {
  MANAGED_RUNTIME_STAMP_FILENAME,
  MANAGED_RUNTIME_STAMP_SCHEMA_VERSION,
} from './managedRuntimeSlot';
import { DefaultDesktopSSHTransportManager } from './sshTransportManager';

function readSSHRuntimeSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshRuntime.ts'), 'utf8');
}

function readSSHTransportManagerSource(): string {
  return fs.readFileSync(path.join(__dirname, 'sshTransportManager.ts'), 'utf8');
}

function fileMode(filename: string): number {
  return fs.statSync(filename).mode & 0o777;
}

function createRuntimeArchive(root: string): string {
  const source = path.join(root, 'archive');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'redeven'), '#!/bin/sh\necho redeven v1 abc\n');
  fs.chmodSync(path.join(source, 'redeven'), 0o755);
  for (const companion of [
    '.redevplugin-release-artifacts-verified.json',
    'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
    'REDEVPLUGIN_RUNTIME.spdx.json',
    'redevplugin-runtime.provenance.json',
    'redevplugin-runtime.sig',
    'redevplugin-runtime.pem',
    'redevplugin-runtime',
  ]) {
    fs.writeFileSync(path.join(source, companion), companion === 'redevplugin-runtime' ? '#!/bin/sh\n' : '{}');
  }
  fs.chmodSync(path.join(source, 'redevplugin-runtime'), 0o755);
  const archive = path.join(root, 'redeven.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);
  return archive;
}

describe('sshRuntime', () => {
  it('uses the shared ten-second default for SSH connection establishment', () => {
    const source = readSSHRuntimeSource();
    expect(source).toContain('const DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS = 10;');
    expect(source).toContain('readyTimeoutMs: Math.max(1_000, connectTimeoutSeconds * 1_000)');
    expect(source).not.toContain('readyTimeoutMs: startupTimeoutMs');
  });

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
    const transportManager = new DefaultDesktopSSHTransportManager({
      readyPollMs: 1,
      dependencies: { tempRoot: tempDir },
    });

    try {
      const probe = await probeManagedSSHRuntimeStatus({
        sshTransportManager: transportManager,
        sshCredentialScope: tempDir,
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
          channel: 'master_stderr',
          label: 'SSH control connection stderr',
          text: expect.stringContaining('Could not resolve hostname dify'),
        }),
      ]));
    } finally {
      await transportManager.dispose();
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
    expect(buildManagedSSHRuntimeProbeScript()).toContain(`stamp_path="${'${managed_root}'}/${MANAGED_RUNTIME_STAMP_FILENAME}"`);
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'slot_release_tag=%s\\n' \"$slot_release_tag\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'reported_release_tag=%s\\n' \"$reported_release_tag\"");
    expect(buildManagedSSHRuntimeProbeScript()).toContain("printf 'target_release_tag=%s\\n' \"$target_release_tag\"");
    expect(buildManagedSSHUploadedInstallScript()).toContain('archive_path="$3"');
    expect(buildManagedSSHUploadedInstallScript()).toContain('uploaded Redeven archive did not contain redeven');
    expect(buildManagedSSHUploadedInstallScript()).toContain('uploaded Runtime archive is missing $companion');
    expect(buildManagedSSHUploadedInstallScript()).toContain('cp "${extract_dir}/$companion" "${staging_root}/bin/$companion"');
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
    const source = readSSHRuntimeSource();
    expect(source).toContain("'redeven-ssh-runtime-process-helper'");
    expect(source).toContain('desktop-runtime-inventory --runtime-root "$runtime_root"');
    expect(source).toContain('desktop-runtime-stop --runtime-root "$runtime_root"');
    expect(source).toContain('--expected-inventory-digest "$inventory_digest"');
    expect(source).not.toContain('--process-contract-version');
    expect(source).not.toContain('--include-known-legacy');
    expect(source).not.toContain('runtimeProcessCommandNeedsUploadedHelper');
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
    const stampSchemaIndex = script.indexOf(`schema_version=${MANAGED_RUNTIME_STAMP_SCHEMA_VERSION}`, stampExistsIndex);

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
      expect(script).toContain(`schema_version=${MANAGED_RUNTIME_STAMP_SCHEMA_VERSION}`);
      expect(script).toContain('slot_release_tag=');
      expect(script).toContain('installed_at_unix_ms=');
    }

    expect(remoteInstallScript).toContain('staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"');
    expect(remoteInstallScript).toContain('REDEVEN_INSTALL_DIR="$staging_bin_dir"');
    expect(remoteInstallScript).toContain('staged_binary="${staging_bin_dir}/redeven"');
    expect(remoteInstallScript).toContain('if [ "$staged_release_tag" != "$target_release_tag" ]; then');
    expect(remoteInstallScript).toContain('umask 077');
    expect(remoteInstallScript).toContain('normalize_managed_runtime_metadata');
    expect(remoteInstallScript).toContain('printf "%s\\n" "$staging_root"');
    expect(remoteInstallScript).not.toContain('switch_staged_runtime');
    expect(remoteInstallScript).not.toContain('cleanup_legacy_releases');
    expect(remoteInstallScript).not.toContain('mv "$temp_binary" "$binary"');

    expect(uploadedInstallScript).toContain('staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"');
    expect(uploadedInstallScript).toContain('mv "$binary_path" "${staging_root}/bin/redeven"');
    expect(uploadedInstallScript).toContain('if [ "$staged_release_tag" != "$target_release_tag" ]; then');
    expect(uploadedInstallScript).toContain('umask 077');
    expect(uploadedInstallScript).toContain('normalize_managed_runtime_metadata');
    expect(uploadedInstallScript).toContain('printf "%s\\n" "$staging_root"');
    expect(uploadedInstallScript).not.toContain('chmod +x');
    expect(uploadedInstallScript).not.toContain('switch_staged_runtime');
    expect(uploadedInstallScript).not.toContain('cleanup_legacy_releases');
    expect(uploadedInstallScript).not.toContain('mv "$temp_binary" "$binary"');

    expect(activateScript).toContain('"${managed_root}.staging."*)');
    expect(activateScript).toContain('staged_stamp="${staging_root}/managed-runtime.stamp"');
    expect(activateScript).toContain('switch_staged_runtime');
    expect(activateScript).toContain('mv "$managed_root" "$previous_managed_root"');
    expect(activateScript).toContain('if mv "$staging_root" "$managed_root"; then');
    expect(activateScript).not.toContain('cleanup_legacy_releases');
  });

  it('stages a private managed Runtime slot even when the target umask is group-writable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-managed-runtime-mode-'));
    try {
      const targetRoot = path.join(root, 'target');
      const uploadDir = path.join(root, 'upload');
      fs.mkdirSync(path.join(targetRoot, 'runtime'), { recursive: true });
      fs.chmodSync(path.join(targetRoot, 'runtime'), 0o775);
      fs.mkdirSync(uploadDir, { recursive: true });
      const archive = createRuntimeArchive(root);
      const archiveCopy = path.join(uploadDir, 'redeven.tar.gz');
      fs.copyFileSync(archive, archiveCopy);
      const scriptPath = path.join(root, 'install.sh');
      fs.writeFileSync(scriptPath, buildManagedSSHUploadedInstallScript());

      const stagingRoot = execFileSync('sh', [
        '-c',
        'umask 0002\nexec sh "$1" "$2" "$3" "$4" "$5"',
        'redeven-managed-runtime-mode-test',
        scriptPath,
        targetRoot,
        'v1',
        archiveCopy,
        uploadDir,
      ], { encoding: 'utf8' }).trim();

      expect(fileMode(stagingRoot)).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, 'bin'))).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, 'bin', 'redeven'))).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, 'bin', 'redevplugin-runtime'))).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, MANAGED_RUNTIME_STAMP_FILENAME))).toBe(0o600);
      expect(fileMode(path.join(stagingRoot, 'bin', 'redevplugin-runtime.provenance.json'))).toBe(0o600);

      const activateScriptPath = path.join(root, 'activate.sh');
      fs.writeFileSync(activateScriptPath, buildManagedSSHActivatePreparedRuntimeScript());
      execFileSync('sh', [activateScriptPath, targetRoot, 'v1', stagingRoot]);
      expect(fileMode(path.join(targetRoot, 'runtime'))).toBe(0o700);
      expect(fileMode(path.join(targetRoot, 'runtime', 'managed'))).toBe(0o700);
      expect(fileMode(path.join(targetRoot, 'runtime', 'managed', 'bin'))).toBe(0o700);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes remote-install Runtime metadata independently of the target umask', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-remote-runtime-mode-'));
    try {
      const targetRoot = path.join(root, 'target');
      const fakeBin = path.join(root, 'bin');
      fs.mkdirSync(fakeBin, { recursive: true });
      const curlPath = path.join(fakeBin, 'curl');
      fs.writeFileSync(curlPath, [
        '#!/bin/sh',
        'set -eu',
        'output=""',
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "-o" ]; then output="$2"; shift 2; else shift; fi',
        'done',
        'cat > "$output" <<\'INSTALL\'',
        '#!/bin/sh',
        'set -eu',
        'mkdir -p "$REDEVEN_INSTALL_DIR"',
        'printf \'#!/bin/sh\\necho redeven v1 abc\\n\' > "$REDEVEN_INSTALL_DIR/redeven"',
        'chmod 775 "$REDEVEN_INSTALL_DIR/redeven"',
        'INSTALL',
        'chmod 775 "$output"',
        '',
      ].join('\n'));
      fs.chmodSync(curlPath, 0o755);
      const scriptPath = path.join(root, 'remote-install.sh');
      fs.writeFileSync(scriptPath, buildManagedSSHRemoteInstallScript());

      const stagingRoot = execFileSync('sh', [
        '-c',
        'umask 0002\nexec sh "$1" "$2" "$3" "$4"',
        'redeven-remote-runtime-mode-test',
        scriptPath,
        targetRoot,
        'v1',
        'https://example.invalid/install.sh',
      ], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      }).trim();

      expect(fileMode(stagingRoot)).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, 'bin'))).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, 'bin', 'redeven'))).toBe(0o700);
      expect(fileMode(path.join(stagingRoot, MANAGED_RUNTIME_STAMP_FILENAME))).toBe(0o600);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not replace the managed Runtime when the private parent metadata cannot be committed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-managed-runtime-mode-failure-'));
    try {
      const targetRoot = path.join(root, 'target');
      const uploadDir = path.join(root, 'upload');
      const fakeBin = path.join(root, 'bin');
      fs.mkdirSync(path.join(targetRoot, 'runtime', 'managed'), { recursive: true });
      fs.writeFileSync(path.join(targetRoot, 'runtime', 'managed', 'sentinel'), 'unchanged');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.mkdirSync(fakeBin, { recursive: true });
      const archive = createRuntimeArchive(root);
      const archiveCopy = path.join(uploadDir, 'redeven.tar.gz');
      fs.copyFileSync(archive, archiveCopy);
      const scriptPath = path.join(root, 'install.sh');
      fs.writeFileSync(scriptPath, buildManagedSSHUploadedInstallScript());
      const stagingRoot = execFileSync('sh', [
        scriptPath,
        targetRoot,
        'v1',
        archiveCopy,
        uploadDir,
      ], { encoding: 'utf8' }).trim();
      const chmodPath = path.join(fakeBin, 'chmod');
      fs.writeFileSync(chmodPath, '#!/bin/sh\nexit 73\n');
      fs.chmodSync(chmodPath, 0o755);
      const activateScriptPath = path.join(root, 'activate.sh');
      fs.writeFileSync(activateScriptPath, buildManagedSSHActivatePreparedRuntimeScript());

      expect(() => execFileSync('sh', [
        activateScriptPath,
        targetRoot,
        'v1',
        stagingRoot,
      ], {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
        stdio: 'pipe',
      })).toThrow();
      expect(fs.readFileSync(path.join(targetRoot, 'runtime', 'managed', 'sentinel'), 'utf8')).toBe('unchanged');
      expect(fs.existsSync(stagingRoot)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks the SSH master socket, probes remote platform, and keeps bootstrap strategy explicit', () => {
    const source = readSSHRuntimeSource();
    const transportSource = readSSHTransportManagerSource();

    expect(transportSource).toContain("'-O', 'check',");
    expect(transportSource).toContain("target.auth_mode === 'key_agent'");
    expect(transportSource).toContain("'BatchMode=yes'");
    expect(transportSource).toContain("'BatchMode=no'");
    expect(transportSource).toContain("'-T'");
    expect(transportSource).toContain("'-x'");
    expect(transportSource).toContain("'ForwardX11=no'");
    expect(transportSource).toContain("'RequestTTY=no'");
    expect(transportSource).toContain('SSH_ASKPASS_REQUIRE');
    expect(transportSource).toContain("'force'");
    expect(source).toContain('sshTransportManager: DesktopSSHTransportManager;');
    expect(source).toContain('transportLease?: DesktopSSHTransportLease;');
    expect(source).toContain('async function probeRemoteRuntimeCompatibility(');
    expect(source).toContain('async function probeRemotePlatform(');
    expect(source).toContain('function resolveDesktopSSHReleaseFetchPolicy(');
    expect(source).not.toContain('function installStrategyOrder(');
    expect(source).not.toContain('DesktopSSHUploadAssetPreparationError');
    expect(source).toContain('fetchPolicy: releaseFetchPolicy,');
    expect(source).toContain("if (args.session.target.bootstrap_strategy === 'remote_install')");
    expect(source).toContain('return prepareRemoteRuntimeViaRemoteInstall(args);');
    expect(source).not.toContain('allowLegacyMigration');
    expect(source).toContain("from './runtimePackageCache'");
    expect(source).toContain('prepareDesktopRuntimeUploadAsset({');
    expect(source).toContain("asset.source === 'source_build_cache'");
    expect(source).toContain('Using cached local runtime package');
    expect(source).toContain('package built from this Desktop session');
    expect(source).not.toContain('ExitOnForwardFailure');
    expect(source).not.toContain("'-L'");
    expect(source).toContain('managedSSHRuntimeAttachPolicy(');
    expect(source).toContain('DesktopSSHRuntimeMaintenanceRequiredError');
    expect(source).toContain('allowActiveWorkReplacement?: boolean;');
    expect(source).toContain('allowActiveWorkReplacement: args.allowActiveWorkReplacement === true');
    expect(source).not.toContain('/_redeven_proxy/api/runtime/bindings/');
    expect(source).toContain('export async function ensureManagedSSHRuntimeReady(');
    expect(source).toContain('onProgress?: (progress: DesktopSSHRuntimeProgress) => void;');
    expect(source).toContain("'ssh_connecting'");
    expect(source).toContain("'ssh_uploading_archive'");
    expect(source).toContain("'ssh_waiting_report'");
    expect(source).toContain('type SSHControlSessionContext = Readonly<{');
    expect(source).toContain('async function runSSHControlCommand(');
    expect(source).toContain('const result = await runSSHControlCommand(');
    expect(source).toContain("code: 'ssh_connection_interrupted'");
    expect(source).toContain('recordSSHControlCheckFailure(session, error);');
    expect(source).toContain('parseLaunchReport(result.stdout)');
    expect(source).not.toContain('formatBlockedLaunchDiagnostics(launchReport)');
    expect(source).toContain('const replacementInventory = await processSession.inspect();');
    expect(source).toContain('await processSession.stop(replacementInventory, stopTimeoutMs);');
    expect(source).toContain('[preparedRuntimePackage, processSession] = await Promise.all([');
    expect(source).toContain('prepareRemoteRuntimePackage(packageArgs).then((prepared) => {');
    expect(source).toContain('const updateProcessSessionTask');
    expect(source).toContain('onProgress: undefined,');
    expect(source).toContain('await processSession.stop(processInventory, stopTimeoutMs);');
    expect(source).toContain('await activatePreparedRemoteRuntimePackage({');
    expect(source.indexOf('prepareRemoteRuntimePackage(packageArgs).then((prepared) => {')).toBeLessThan(
      source.indexOf('await processSession.stop(processInventory, stopTimeoutMs);'),
    );
    expect(source.indexOf('await processSession.stop(processInventory, stopTimeoutMs);')).toBeLessThan(
      source.indexOf('await activatePreparedRemoteRuntimePackage({'),
    );
    expect(source).not.toContain('runManagedSSHRuntimeProcessCommand');
    expect(source).not.toContain('kill "$pid"');
    expect(source).toContain('Remote Redeven launcher failed before reporting readiness (${exitReason}).');
  });

  it('threads AbortSignal through SSH child processes and upload cleanup', () => {
    const source = readSSHRuntimeSource();

    expect(source).toContain('export class DesktopSSHRuntimeCanceledError extends Error');
    expect(source).toContain('signal?: AbortSignal;');
    expect(source).toContain('function throwIfSSHRuntimeCanceled(signal: AbortSignal | undefined): void');
    expect(source).toContain('throwIfSSHRuntimeCanceled(args.signal);');
    expect(source).toContain('signal: args.signal,');
    expect(source).toContain('throw new DesktopSSHRuntimeCanceledError();');
    expect(source).toContain('async function createRemoteTempDir(args: Readonly<{');
    expect(source).toContain('async function prepareRemoteRuntimeViaDesktopUpload(args: Readonly<{');
    expect(source).toContain('const remoteTempDir = await createRemoteTempDir(args);');
    expect(source).toContain('await removeRemotePath({\n      session: args.session,\n      remotePath: remoteTempDir,\n    });');
    expect(source).toContain('await disconnect();');
    expect(source).toContain('if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {');
  });
});
