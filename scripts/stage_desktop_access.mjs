import { copyFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const privacyCopy = JSON.parse(readFileSync(new URL('../desktop/native/computer-host/Resources/Privacy.json', import.meta.url), 'utf8'));

export function desktopAccessIdentity(development) {
  return { name: development ? 'Redeven Desktop Access Dev' : 'Redeven Desktop Access',
    identifier: `com.floegence.redeven.desktop-access${development ? '.dev' : ''}` };
}

export function desktopAccessInfo(development, version = '0.1.0') {
  const { name, identifier } = desktopAccessIdentity(development);
  return { CFBundleIdentifier: identifier, CFBundleName: name, CFBundleDisplayName: name,
    CFBundleExecutable: 'redeven-computer-host', CFBundlePackageType: 'APPL',
    CFBundleVersion: version, CFBundleShortVersionString: version, LSUIElement: true,
    LSMinimumSystemVersion: '13.0', CFBundleIconFile: 'desktop-access.icns',
    NSScreenCaptureUsageDescription: privacyCopy['en-US'], CFBundleDevelopmentRegion: 'en', NSHighResolutionCapable: true };
}

export function stageDesktopAccess({ binary, destination, icon, development = true, version = (process.env.REDEVEN_DESKTOP_VERSION || '0.1.0').replace(/^v/u, '').split('-')[0], identity = process.env.REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY || process.env.REDEVEN_DESKTOP_MAC_IDENTITY }) {
  if (![binary, destination, icon].every(path.isAbsolute) || existsSync(destination)) throw new Error('Desktop access requires absolute source paths and a new destination.');
  if (!identity || identity === '-') throw new Error('Set REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY to an Apple Development or Developer ID Application identity. Ad-hoc signing cannot preserve desktop access permissions.');
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('Desktop access requires a numeric application version.');
  const contents = path.join(destination, 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  mkdirSync(path.join(contents, 'Resources'));
  copyFileSync(binary, path.join(contents, 'MacOS/redeven-computer-host'));
  copyFileSync(icon, path.join(contents, 'Resources/desktop-access.icns'));
  for (const [locale, text] of Object.entries(privacyCopy)) {
    const folder = path.join(contents, 'Resources', `${locale}.lproj`);
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'InfoPlist.strings'), `"NSScreenCaptureUsageDescription" = ${JSON.stringify(text)};\n`);
  }
  const info = path.join(contents, 'Info.plist');
  writeFileSync(info, JSON.stringify(desktopAccessInfo(development, version)));
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', info]);
  execFileSync('/usr/bin/codesign', ['--force', '--options', 'runtime', '--sign', identity, destination], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', destination]);
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageDesktopAccess({ binary: path.resolve(process.argv[2]), destination: path.resolve(process.argv[3]),
    icon: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../desktop/build/desktop-access.icns') });
}
