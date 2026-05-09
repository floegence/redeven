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
const repoRoot = path.resolve(desktopDir, '..');
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

function resolveBundledRuntimeBinary() {
  const goos = resolveTargetGoos();
  const goarch = resolveTargetGoarch();
  const executableName = goos === 'windows' ? 'redeven.exe' : 'redeven';
  const candidate = path.join(desktopDir, '.bundle', `${goos}-${goarch}`, executableName);
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Bundled runtime binary not found at ${candidate}. Run npm run prepare:bundled-runtime or npm run package from the desktop workspace before invoking electron-builder directly.`,
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

const bundledRuntimeBinary = resolveBundledRuntimeBinary();
const { normalizeLinuxDesktopArtifactPaths } = loadReleaseArtifactHelpers();

export default {
  appId: 'com.floegence.redeven.desktop',
  productName: 'Redeven Desktop',
  artifactName: 'Redeven-Desktop-${version}-${os}-${arch}.${ext}',
  protocols: [
    {
      name: 'Redeven Control Plane Link',
      schemes: ['redeven'],
    },
  ],
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
      from: bundledRuntimeBinary,
      to: 'bin/redeven',
    },
    {
      from: path.join(repoRoot, 'LICENSE'),
      to: 'licenses/LICENSE',
    },
    {
      from: path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'),
      to: 'licenses/THIRD_PARTY_NOTICES.md',
    },
    {
      from: path.join(desktopDir, 'node_modules', 'electron', 'dist', 'LICENSE'),
      to: 'licenses/electron/LICENSE',
    },
    {
      from: path.join(desktopDir, 'node_modules', 'electron', 'dist', 'LICENSES.chromium.html'),
      to: 'licenses/electron/LICENSES.chromium.html',
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
