import path from 'node:path';

const desktopVersion = String(process.env.REDEVEN_DESKTOP_VERSION ?? '').trim() || '0.1.0';
const bundledAgentBinary = String(process.env.REDEVEN_DESKTOP_AGENT_BINARY ?? '').trim();
const macIdentity = String(process.env.REDEVEN_DESKTOP_MAC_IDENTITY ?? '').trim();

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
    identity: macIdentity || undefined,
  },
  linux: {
    category: 'Development',
    target: ['AppImage'],
  },
};
