import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_REDEVEN_RELEASE_BASE_URL = 'https://github.com/floegence/redeven/releases';

export type DesktopSSHRemotePlatform = Readonly<{
  goos: 'linux' | 'darwin';
  goarch: 'amd64' | 'arm64' | 'arm' | '386';
  platform_id: 'linux_amd64' | 'linux_arm64' | 'linux_arm' | 'linux_386' | 'darwin_amd64' | 'darwin_arm64';
  release_package_name: string;
  platform_label: string;
}>;

export type DesktopSSHResolvedReleaseAsset = Readonly<{
  release_tag: string;
  release_base_url: string;
  platform: DesktopSSHRemotePlatform;
  archive_path: string;
  sha256: string;
}>;

type EnsureDesktopSSHReleaseAssetArgs = Readonly<{
  releaseTag: string;
  releaseBaseURL: string;
  platform: DesktopSSHRemotePlatform;
  cacheRoot: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function releaseBaseURL(rawURL: string): string {
  const clean = compact(rawURL);
  return clean === '' ? PUBLIC_REDEVEN_RELEASE_BASE_URL : clean;
}

function parseRemoteUnameOS(rawOS: string): 'linux' | 'darwin' {
  const clean = compact(rawOS).toLowerCase();
  if (clean.startsWith('linux')) {
    return 'linux';
  }
  if (clean.startsWith('darwin')) {
    return 'darwin';
  }
  throw new Error(`Unsupported remote operating system for SSH bootstrap: ${rawOS}`);
}

function parseRemoteUnameArch(rawArch: string): 'amd64' | 'arm64' | 'arm' | '386' {
  const clean = compact(rawArch).toLowerCase();
  switch (clean) {
    case 'x86_64':
    case 'amd64':
      return 'amd64';
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    case 'armv7l':
    case 'armv6l':
      return 'arm';
    case 'i386':
    case 'i686':
      return '386';
    default:
      throw new Error(`Unsupported remote architecture for SSH bootstrap: ${rawArch}`);
  }
}

export function resolveDesktopSSHRemotePlatform(rawOS: string, rawArch: string): DesktopSSHRemotePlatform {
  const goos = parseRemoteUnameOS(rawOS);
  const goarch = parseRemoteUnameArch(rawArch);
  const platformID = `${goos}_${goarch}` as DesktopSSHRemotePlatform['platform_id'];
  return {
    goos,
    goarch,
    platform_id: platformID,
    release_package_name: `redeven_${goos}_${goarch}.tar.gz`,
    platform_label: `${goos}/${goarch}`,
  };
}

export function buildDesktopSSHReleaseAssetURL(
  rawReleaseBaseURL: string,
  releaseTag: string,
  assetName: string,
): string {
  return `${releaseBaseURL(rawReleaseBaseURL)}/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
}

export function parseDesktopSSHReleaseSHA256(
  sumsText: string,
  assetName: string,
): string {
  for (const rawLine of String(sumsText ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    if (match[2] === assetName) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`SHA256SUMS did not include ${assetName}.`);
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.readFile(filePath);
  hash.update(file);
  return hash.digest('hex');
}

export async function verifyDesktopSSHReleaseAsset(
  filePath: string,
  expectedSHA256: string,
): Promise<void> {
  const actual = await sha256File(filePath);
  if (actual !== expectedSHA256.toLowerCase()) {
    throw new Error(`Release asset checksum mismatch for ${path.basename(filePath)}.`);
  }
}

async function downloadURLToPath(sourceURL: string, targetPath: string): Promise<void> {
  const response = await fetch(sourceURL);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${sourceURL}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, data);
}

async function downloadText(sourceURL: string): Promise<string> {
  const response = await fetch(sourceURL);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${sourceURL}`);
  }
  return response.text();
}

export async function ensureDesktopSSHReleaseAsset(
  args: EnsureDesktopSSHReleaseAssetArgs,
): Promise<DesktopSSHResolvedReleaseAsset> {
  const baseURL = releaseBaseURL(args.releaseBaseURL);
  const cacheDir = path.join(args.cacheRoot, args.releaseTag, args.platform.platform_id);
  const archivePath = path.join(cacheDir, args.platform.release_package_name);
  const sumsPath = path.join(cacheDir, 'SHA256SUMS');

  await fs.mkdir(cacheDir, { recursive: true });

  let sumsText = '';
  try {
    sumsText = await fs.readFile(sumsPath, 'utf8');
  } catch {
    sumsText = await downloadText(buildDesktopSSHReleaseAssetURL(baseURL, args.releaseTag, 'SHA256SUMS'));
    await fs.writeFile(sumsPath, sumsText, 'utf8');
  }

  const sha256 = parseDesktopSSHReleaseSHA256(sumsText, args.platform.release_package_name);

  try {
    await verifyDesktopSSHReleaseAsset(archivePath, sha256);
  } catch {
    await downloadURLToPath(
      buildDesktopSSHReleaseAssetURL(baseURL, args.releaseTag, args.platform.release_package_name),
      archivePath,
    );
    await verifyDesktopSSHReleaseAsset(archivePath, sha256);
  }

  return {
    release_tag: args.releaseTag,
    release_base_url: baseURL,
    platform: args.platform,
    archive_path: archivePath,
    sha256,
  };
}
