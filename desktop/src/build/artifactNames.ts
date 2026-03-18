const LINUX_AMD64_SUFFIX = '-linux-x86_64.AppImage';
const LINUX_X64_SUFFIX = '-linux-x64.AppImage';

export function normalizeDesktopArtifactName(name: string): string {
  if (!name.endsWith(LINUX_AMD64_SUFFIX)) {
    return name;
  }

  return `${name.slice(0, -LINUX_AMD64_SUFFIX.length)}${LINUX_X64_SUFFIX}`;
}
