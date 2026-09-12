import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopVersion = String(process.env.REDEVEN_DESKTOP_VERSION ?? '').trim() || '0.1.0';
const desktopUpdateBaseURL = String(process.env.REDEVEN_DESKTOP_UPDATE_BASE_URL ?? '').trim().replace(/\/+$/u, '');
const sparklePublicKey = String(process.env.REDEVEN_SPARKLE_PUBLIC_ED_KEY ?? '').trim();
const requireUpdateConfig = String(process.env.REDEVEN_DESKTOP_REQUIRE_UPDATE_CONFIG ?? '').trim() === '1';
const macIdentity = String(process.env.REDEVEN_DESKTOP_MAC_IDENTITY ?? '')
  .trim()
  .replace(/^Developer ID Application:\s*/u, '')
  .trim();
const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopDir, '..');
const buildResourcesDir = path.join(desktopDir, 'build');
const require = createRequire(import.meta.url);

function requireHTTPSURL(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a credential-free HTTPS URL.`);
  }
  return parsed.toString().replace(/\/$/u, '');
}

function validateSparklePublicKey(value) {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value) || Buffer.from(value, 'base64').length !== 32) {
    throw new Error('REDEVEN_SPARKLE_PUBLIC_ED_KEY must be one base64-encoded Ed25519 public key.');
  }
  return value;
}

function resolveTargetGoos(platform = process.platform) {
  if (platform === 'darwin' || platform === 'linux') return platform;
  if (platform === 'win32') return 'windows';
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

function bundledBinaryCandidate(name) {
  const goos = resolveTargetGoos();
  const goarch = resolveTargetGoarch();
  const candidate = path.join(desktopDir, '.bundle', `${goos}-${goarch}`, name);
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Bundled binary not found at ${candidate}. Run npm run prepare:bundled-runtime or npm run package from the desktop workspace before invoking electron-builder directly.`,
    );
  }
  const candidateStat = fs.lstatSync(candidate);
  if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
    throw new Error(`Bundled artifact must be a regular non-symlink file: ${candidate}`);
  }
  return candidate;
}

function resolveBundledRuntimeArtifact() {
  const goos = resolveTargetGoos();
  return bundledBinaryCandidate(goos === 'windows' ? 'redeven_linux_amd64.tar.gz' : 'redeven');
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

const bundledRuntimeArtifact = resolveBundledRuntimeArtifact();
const bundledDesktopManifest = bundledBinaryCandidate('desktop-bundle-manifest.json');
const computerHostScript = path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'scripts', 'redevenComputerHost.mjs');
const computerHostNodeModules = path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'node_modules');
if (!fs.existsSync(computerHostScript)) {
  throw new Error(`Computer host helper source is missing: ${computerHostScript}`);
}
const computerHostDependencyResources = fs.existsSync(path.join(computerHostNodeModules, 'playwright'))
  ? [
      { from: path.join(computerHostNodeModules, 'playwright'), to: 'computer/node_modules/playwright' },
      ...(fs.existsSync(path.join(computerHostNodeModules, 'playwright-core'))
        ? [{ from: path.join(computerHostNodeModules, 'playwright-core'), to: 'computer/node_modules/playwright-core' }]
        : []),
    ]
  : [];
const bundledReDevPluginResources = resolveTargetGoos() !== 'windows'
  ? [
      'redevplugin-runtime',
      'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
      'REDEVPLUGIN_RUNTIME.spdx.json',
      'redevplugin-runtime.provenance.json',
      'redevplugin-runtime.sig',
      'redevplugin-runtime.pem',
      '.redevplugin-release-artifacts-verified.json',
    ].map((name) => ({ from: bundledBinaryCandidate(name), to: `bin/${name}` }))
  : [];
const { normalizeLinuxDesktopArtifactPaths } = loadReleaseArtifactHelpers();
const resolvedUpdateBaseURL = desktopUpdateBaseURL
  ? requireHTTPSURL(desktopUpdateBaseURL, 'REDEVEN_DESKTOP_UPDATE_BASE_URL')
  : '';
if (requireUpdateConfig && !resolvedUpdateBaseURL) {
  throw new Error('REDEVEN_DESKTOP_UPDATE_BASE_URL is required for release packaging.');
}
const macUpdaterInfo = resolveTargetGoos() === 'darwin' && resolvedUpdateBaseURL && sparklePublicKey
  ? {
      SUFeedURL: `${resolvedUpdateBaseURL}/appcast-mac-${process.arch}.xml`,
      SUPublicEDKey: validateSparklePublicKey(sparklePublicKey),
      SURequireSignedFeed: true,
      SUVerifyUpdateBeforeExtraction: true,
      SUEnableSystemProfiling: false,
      SUEnableAutomaticChecks: true,
      SUScheduledCheckInterval: 86400,
      SUAutomaticallyUpdate: false,
      SUAllowsAutomaticUpdates: false,
    }
  : {};
if (requireUpdateConfig && resolveTargetGoos() === 'darwin' && Object.keys(macUpdaterInfo).length === 0) {
  throw new Error('REDEVEN_SPARKLE_PUBLIC_ED_KEY is required for macOS release packaging.');
}

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
  afterPack: async (context) => {
    const goos = resolveTargetGoos();
    const goarch = resolveTargetGoarch();
    if (goos === 'darwin') {
      const appContents = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents');
      const updaterStage = path.join(desktopDir, '.bundle', 'macos-updater');
      const stagedFramework = path.join(updaterStage, 'Sparkle.framework');
      const stagedAddon = path.join(updaterStage, 'native', 'redeven_sparkle.node');
      if (!fs.existsSync(stagedFramework) || !fs.existsSync(stagedAddon)) {
        throw new Error('Prepared Sparkle framework or native bridge is missing. Run npm run prepare:macos-updater.');
      }
      const frameworkDestination = path.join(appContents, 'Frameworks', 'Sparkle.framework');
      const addonDestination = path.join(appContents, 'Resources', 'native', 'redeven_sparkle.node');
      fs.mkdirSync(path.dirname(frameworkDestination), { recursive: true });
      fs.mkdirSync(path.dirname(addonDestination), { recursive: true });
      execFileSync('/usr/bin/ditto', [stagedFramework, frameworkDestination]);
      fs.copyFileSync(stagedAddon, addonDestination);
    }
    const resourcesDir = goos === 'darwin'
      ? path.join(context.appOutDir, 'Redeven Desktop.app', 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
    if (goos !== 'windows') {
      execFileSync(
        path.join(repoRoot, 'scripts', 'check_redevplugin_consumption_gate.sh'),
        ['--scan-root', path.join(resourcesDir, 'bin'), '--runtime-target', `${goos}/${goarch}`],
        { stdio: 'inherit' },
      );
    }
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
      from: bundledRuntimeArtifact,
      to: resolveTargetGoos() === 'windows' ? 'bin/redeven_linux_amd64.tar.gz' : 'bin/redeven',
    },
    {
      from: bundledDesktopManifest,
      to: 'bin/desktop-bundle-manifest.json',
    },
    ...bundledReDevPluginResources,
    ...(resolveTargetGoos() === 'windows' ? [{
      from: path.join(desktopDir, '.bundle', 'windows-ssh', 'redeven-ssh-askpass.exe'),
      to: 'native/redeven-ssh-askpass.exe',
    }] : []),
    {
      from: computerHostScript,
      to: 'computer/redevenComputerHost.mjs',
    },
    ...computerHostDependencyResources,
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
    signIgnore: ['**/Contents/Resources/bin/redevplugin-runtime'],
    icon: path.join(buildResourcesDir, 'icon.icns'),
    extendInfo: macUpdaterInfo,
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
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Redeven-Desktop-Internal-${version}-win-${arch}.${ext}',
    icon: path.join(buildResourcesDir, 'icon.png'),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
  },
  deb: {
    packageName: 'redeven-desktop',
  },
  rpm: {
    packageName: 'redeven-desktop',
  },
  ...(resolveTargetGoos() === 'linux' && resolvedUpdateBaseURL
    ? { publish: [{ provider: 'generic', url: resolvedUpdateBaseURL, channel: 'latest' }] }
    : {}),
};
