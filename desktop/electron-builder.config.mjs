import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopVersion = String(process.env.REDEVEN_DESKTOP_VERSION ?? '').trim() || '0.1.0';
const macIdentity = String(process.env.REDEVEN_DESKTOP_MAC_IDENTITY ?? '')
  .trim()
  .replace(/^Developer ID Application:\s*/u, '')
  .trim();
const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const buildResourcesDir = path.join(desktopDir, 'build');
const require = createRequire(import.meta.url);

function resolveTargetGoos(platform = process.platform) {
  if (platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new Error(`Unsupported desktop packaging platform: ${platform}`);
}

function resolveTargetGoarch(arch = process.arch) {
  switch (arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    default:
      throw new Error(`Unsupported desktop packaging architecture: ${arch}`);
  }
}

function resolveBundledAgentBinary() {
  const goos = resolveTargetGoos();
  const goarch = resolveTargetGoarch();
  const executableName = goos === 'windows' ? 'redeven.exe' : 'redeven';
  const candidate = path.join(desktopDir, '.bundle', `${goos}-${goarch}`, executableName);
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Bundled agent binary not found at ${candidate}. Run npm run prepare:bundled-agent or npm run package from the desktop workspace before invoking electron-builder directly.`,
    );
  }
  return candidate;
}

function loadReleaseArtifactHelpers() {
  const helperPath = path.join(desktopDir, 'dist', 'shared', 'releaseArtifactNames.js');
  try {
    return require(helperPath);
  } catch (error) {
    throw new Error(
      `Desktop release artifact helpers not found at ${helperPath}. Run npm run build before packaging.`,
      { cause: error },
    );
  }
}

const bundledAgentBinary = resolveBundledAgentBinary();
const { normalizeLinuxDesktopArtifactPaths } = loadReleaseArtifactHelpers();

export default {
  appId: 'com.floegence.redeven.desktop',
  productName: 'Redeven Desktop',
  artifactName: 'Redeven-Desktop-${version}-${os}-${arch}.${ext}',
  afterAllArtifactBuild: async (buildResult) => {
    const artifactPaths = await normalizeLinuxDesktopArtifactPaths(buildResult.artifactPaths);
    buildResult.artifactPaths.splice(0, buildResult.artifactPaths.length, ...artifactPaths);
    return [];
  },
  asar: true,
  npmRebuild: false,
  directories: {
    output: 'release',
    buildResources: buildResourcesDir,
  },
  files: [
    'dist/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: bundledAgentBinary,
      to: 'bin/redeven',
    },
  ],
  extraMetadata: {
    main: 'dist/main/main.js',
    version: desktopVersion,
  },
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg'],
    forceCodeSigning: true,
    identity: macIdentity || undefined,
    icon: path.join(buildResourcesDir, 'icon.icns'),
  },
  linux: {
    category: 'Development',
    maintainer: 'Floegence',
    vendor: 'Floegence',
    executableName: 'redeven-desktop',
    synopsis: 'Redeven Desktop shell',
    description: 'Public Electron desktop shell that bundles the matching redeven runtime.',
    icon: path.join(buildResourcesDir, 'icon.png'),
    target: ['deb', 'rpm'],
  },
  deb: {
    packageName: 'redeven-desktop',
  },
  rpm: {
    packageName: 'redeven-desktop',
  },
};
