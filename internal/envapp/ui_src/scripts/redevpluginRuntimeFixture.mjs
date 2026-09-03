import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const linuxELFMachines = new Map([
  ['x64', 62],
  ['arm64', 183],
]);

export function createLinuxReDevPluginRuntimeFixture(arch) {
  const machine = linuxELFMachines.get(arch);
  if (machine == null) throw new Error(`unsupported ReDevPlugin test runtime architecture: ${arch}`);

  const header = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(header);
  header.writeUInt16LE(3, 16);
  header.writeUInt16LE(machine, 18);
  header.writeUInt32LE(1, 20);
  header.writeUInt16LE(64, 52);
  header.writeUInt16LE(56, 54);
  header.writeUInt16LE(64, 58);
  return header;
}

export function createDarwinReDevPluginRuntimeFixture(arch) {
  const cpu = arch === 'x64' ? 0x01000007 : arch === 'arm64' ? 0x0100000c : null;
  if (cpu == null) throw new Error(`unsupported ReDevPlugin test runtime architecture: ${arch}`);

  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpu, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  return header;
}

export async function installReDevPluginRuntimeFixture(
  root,
  { platform = process.platform, arch = process.arch } = {},
) {
  if (platform !== 'linux' && platform !== 'darwin') return null;

  const runtimePath = path.join(root, 'redevplugin-runtime');
  const runtime = platform === 'linux'
    ? createLinuxReDevPluginRuntimeFixture(arch)
    : createDarwinReDevPluginRuntimeFixture(arch);
  await writeFile(runtimePath, runtime, {
    flag: 'wx',
    mode: 0o500,
  });
  const targetArch = arch === 'x64' ? 'amd64' : arch;
  const platformVersion = execFileSync(
    'go',
    ['list', '-m', '-f', '{{.Version}}', 'github.com/floegence/redevplugin/v3'],
    { cwd: path.resolve(import.meta.dirname, '../../../..'), encoding: 'utf8' },
  ).trim().replace(/^v/u, '');
  const marker = {
    schema_version: 'redeven.redevplugin_runtime_build.v1',
    platform_release: { platform_version: platformVersion },
    runtime: {
      target: `${platform}/${targetArch}`,
      binary: {
        path: 'redevplugin-runtime',
        sha256: createHash('sha256').update(runtime).digest('hex'),
        size: runtime.length,
      },
    },
  };
  await writeFile(
    path.join(root, '.redevplugin-release-artifacts-verified.json'),
    `${JSON.stringify(marker)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return runtimePath;
}
