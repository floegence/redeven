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

export async function installReDevPluginRuntimeFixture(
  root,
  { platform = process.platform, arch = process.arch } = {},
) {
  if (platform !== 'linux') return null;

  const runtimePath = path.join(root, 'redevplugin-runtime');
  await writeFile(runtimePath, createLinuxReDevPluginRuntimeFixture(arch), {
    flag: 'wx',
    mode: 0o500,
  });
  return runtimePath;
}
