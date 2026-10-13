import fs from 'node:fs';
import path from 'node:path';
import { sha256, verifyBundledIconIntegrity } from './terminal_agent_icon_integrity.mjs';

const revision = '8731f4b62fea303b022e4aa0125783aeb42c3ea5';
const repository = 'https://github.com/glincker/thesvg';
const assetRoot = 'desktop/src/welcome/assets/environment-platform-icons';
const approved = [
  ['macos', 'Apple (light theme)', 'apple.svg', 'public/icons/apple/light.svg', 'CC0-1.0'],
  ['macos_dark', 'Apple (dark theme)', 'apple-dark.svg', 'public/icons/apple/dark.svg', 'CC0-1.0'],
  ['linux', 'Linux', 'linux.svg', 'public/icons/linux/default.svg', 'CC0-1.0'],
  ['windows', 'Windows', 'windows.svg', 'public/icons/windows/default.svg', 'MIT'],
  ['unknown', 'Virtual Machine (default device)', 'default-device.svg', 'public/icons/azure-virtual-machine/default.svg', 'MIT'],
  ["linux_ubuntu", "Ubuntu", "ubuntu.svg", "public/icons/ubuntu/default.svg", "CC0-1.0"],
  ["linux_debian", "Debian", "debian.svg", "public/icons/debian/default.svg", "CC-BY-SA-3.0"],
  ["linux_fedora", "Fedora", "fedora.svg", "public/icons/fedora/default.svg", "Custom"],
  ["linux_arch", "Arch Linux", "arch-linux.svg", "public/icons/arch-linux/default.svg", "CC0-1.0"],
  ["linux_alpine", "Alpine Linux", "alpine-linux.svg", "public/icons/alpine-linux/default.svg", "CC0-1.0"],
  ["linux_centos", "CentOS", "centos.svg", "public/icons/centos/default.svg", "CC0-1.0"],
  ["linux_almalinux", "AlmaLinux", "almalinux.svg", "public/icons/almalinux/default.svg", "CC0-1.0"],
  ["linux_rocky", "Rocky Linux", "rocky-linux.svg", "public/icons/rocky-linux/default.svg", "CC-BY-SA-4.0"],
  ["linux_rhel", "Red Hat", "red-hat.svg", "public/icons/red-hat/default.svg", "CC0-1.0"],
  ["linux_linuxmint", "Linux Mint", "linux-mint.svg", "public/icons/linux-mint/default.svg", "CC0-1.0"],
  ["linux_manjaro", "Manjaro", "manjaro.svg", "public/icons/manjaro/default.svg", "CC0-1.0"],
  ["linux_nixos", "NixOS", "nixos.svg", "public/icons/nixos/default.svg", "CC0-1.0"],
  ["linux_opensuse", "openSUSE", "opensuse.svg", "public/icons/opensuse/default.svg", "CC0-1.0"],
  ["linux_sles", "SUSE", "suse.svg", "public/icons/suse/default.svg", "CC0-1.0"],
  ["linux_kali", "Kali Linux", "kali-linux.svg", "public/icons/kali-linux/default.svg", "CC0-1.0"],
  ["linux_gentoo", "Gentoo", "gentoo.svg", "public/icons/gentoo/default.svg", "CC-BY-SA-2.5"],
  ["linux_pop", "Pop!_OS", "pop-os.svg", "public/icons/pop-os/default.svg", "CC0-1.0"],
  ["linux_raspbian", "Raspberry Pi", "raspberry-pi.svg", "public/icons/raspberry-pi/default.svg", "CC0-1.0"],
];
const licenses = {
  'CC-BY-SA-2.5': { file: 'assets/licenses/CC-BY-SA-2.5.txt', hash: '1657ac29ba00af9681d9728226185783b93cd3ccd6232a22eb8f530bf52b5b2c', url: 'https://creativecommons.org/licenses/by-sa/2.5/' },
  'CC-BY-SA-4.0': { file: 'assets/licenses/CC-BY-SA-4.0.txt', hash: '23ee78c8bae49cf08ea2f0c84945c66b987ebe4520881fb51b3dad4fb43d07c2', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'Custom': { file: 'assets/licenses/fedora-trademark-guidelines.txt', hash: '78bf48194a76094d808bde27e06fe14b38cfaa1750c47f5238168f2c09377ebb', url: 'https://docs.fedoraproject.org/en-US/legal/trademarks/' },
  'CC-BY-SA-3.0': { file: 'assets/licenses/CC-BY-SA-3.0.txt', hash: '3f941b3b89cf7b8370ceb83cc76d2120d471b58735d8ca60238a751a48d7f72f', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  'CC0-1.0': { file: 'assets/licenses/CC0-1.0.txt', hash: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  MIT: { file: 'assets/licenses/thesvg-MIT.txt', hash: '7a679e60d78db32455aea3b4613d2d3f3bec929edf8cbb608ccc40b37c663aed', url: 'https://opensource.org/license/mit' },
};

export function collectEnvironmentPlatformIconAssets(repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'assets/environment_platform_icons.json'), 'utf8'));
  const source = manifest.source ?? {};
  if (manifest.schema_version !== 1 || source.repository !== repository || source.revision !== revision
    || source.license_file !== licenses.MIT.file || source.license_metadata_path !== 'src/data/icons.json'
    || source.license_metadata_url !== `${repository}/blob/${revision}/src/data/icons.json`) {
    throw new Error('environment platform icons must use the reviewed pinned theSVG source and license metadata');
  }
  if (JSON.stringify(manifest.assets?.map(asset => asset.identity)) !== JSON.stringify(approved.map(row => row[0]))) {
    throw new Error('environment platform icons must exactly declare the reviewed OS, distribution and default device assets');
  }
  const licenseNotices = Object.entries(licenses).map(([license, details]) => {
    const bytes = fs.readFileSync(path.join(repoRoot, details.file));
    if (sha256(bytes) !== details.hash) throw new Error(`environment platform icon license hash mismatch: ${details.file}`);
    return { label: license === 'MIT' ? 'theSVG' : license === 'Custom' ? 'Fedora Project' : 'Creative Commons', license, text: bytes.toString('utf8').trim() };
  });
  const rows = manifest.assets.map((asset, index) => {
    const [identity, label, file, sourcePath, license] = approved[index];
    if (asset.identity !== identity || asset.label !== label || asset.file !== file || asset.source_path !== sourcePath
      || asset.license !== license || asset.license_file !== licenses[license].file
      || asset.license_url !== licenses[license].url || asset.modified !== false) {
      throw new Error(`environment platform icon differs from its reviewed asset and license: ${identity}`);
    }
    verifyBundledIconIntegrity({ filePath: path.join(repoRoot, assetRoot, file), bundledSha256: asset.sha256,
      upstreamSha256: asset.upstream_sha256, modified: asset.modified });
    return { label, license, source: `[${sourcePath}](${repository}/blob/${revision}/${sourcePath})`
        + (asset.brand_source_url ? `; [original brand source](${asset.brand_source_url})` : ''),
      file: `\`${assetRoot}/${file}\``, modified: 'No' };
  });
  if (JSON.stringify(fs.readdirSync(path.join(repoRoot, assetRoot)).sort()) !== JSON.stringify(approved.map(row => row[2]).sort())) {
    throw new Error('bundled environment platform icon files must exactly match the audited manifest');
  }
  return { rows, revision, metadataURL: source.license_metadata_url, licenseNotices };
}
