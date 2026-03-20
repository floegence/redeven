import fs from 'node:fs/promises';
import path from 'node:path';

const LINUX_DESKTOP_ARCH_ALIASES = new Map<string, string>([
  ['amd64', 'x64'],
  ['x86_64', 'x64'],
  ['aarch64', 'arm64'],
]);

export function normalizeLinuxDesktopArtifactName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension !== '.deb' && extension !== '.rpm') {
    return fileName;
  }

  const baseName = fileName.slice(0, -extension.length);
  const linuxMarker = '-linux-';
  const markerIndex = baseName.lastIndexOf(linuxMarker);
  if (markerIndex === -1) {
    return fileName;
  }

  const arch = baseName.slice(markerIndex + linuxMarker.length);
  const normalizedArch = LINUX_DESKTOP_ARCH_ALIASES.get(arch) ?? arch;
  if (normalizedArch === arch) {
    return fileName;
  }

  return `${baseName.slice(0, markerIndex + linuxMarker.length)}${normalizedArch}${extension}`;
}

export async function normalizeLinuxDesktopArtifactPaths(artifactPaths: readonly string[]): Promise<string[]> {
  const normalizedArtifactPaths: string[] = [];

  for (const artifactPath of artifactPaths) {
    const fileName = path.basename(artifactPath);
    const normalizedFileName = normalizeLinuxDesktopArtifactName(fileName);
    if (normalizedFileName === fileName) {
      normalizedArtifactPaths.push(artifactPath);
      continue;
    }

    const normalizedArtifactPath = path.join(path.dirname(artifactPath), normalizedFileName);
    await fs.rename(artifactPath, normalizedArtifactPath);
    normalizedArtifactPaths.push(normalizedArtifactPath);
  }

  return normalizedArtifactPaths;
}
