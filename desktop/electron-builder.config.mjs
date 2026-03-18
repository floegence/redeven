import path from 'node:path';

const desktopVersion = String(process.env.REDEVEN_DESKTOP_VERSION ?? '').trim() || '0.1.0';
const bundledAgentBinary = String(process.env.REDEVEN_DESKTOP_AGENT_BINARY ?? '').trim();
const macIdentity = String(process.env.REDEVEN_DESKTOP_MAC_IDENTITY ?? '').trim();
const buildResourcesDir = path.resolve('build');

if (!bundledAgentBinary) {
  throw new Error('REDEVEN_DESKTOP_AGENT_BINARY is required for desktop packaging.');
}

export default {
  appId: 'com.floegence.redeven.desktop',
  productName: 'Redeven Desktop',
  artifactName: 'Redeven-Desktop-${version}-${os}-${arch}.${ext}',
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
      from: path.resolve(bundledAgentBinary),
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
    synopsis: 'Redeven Desktop shell',
    description: 'Public Electron desktop shell that bundles the matching redeven runtime.',
    icon: path.join(buildResourcesDir, 'icon.png'),
    target: ['deb', 'rpm'],
  },
};
