function packageNameFromNpmPath(packagePath) {
  const parts = String(packagePath).split('node_modules/');
  return parts[parts.length - 1] ?? '';
}

export function packageCoordinate(name, version) {
  return `${name}@${version}`;
}

export function parseNpmPackageLock(lock) {
  const packages = [];
  for (const [packagePath, meta] of Object.entries(lock?.packages ?? {})) {
    if (!packagePath.includes('node_modules/')) continue;
    const name = packageNameFromNpmPath(packagePath);
    const version = String(meta?.version ?? '').trim();
    if (!name || !version) continue;
    packages.push({
      name,
      version,
      license: String(meta?.license ?? '').trim(),
      lockKind: 'npm',
    });
  }
  return packages;
}

export function parsePnpmPackageKey(packageKey) {
  const withoutPeerContext = String(packageKey).replace(/\(.+$/u, '');
  const versionSeparator = withoutPeerContext.lastIndexOf('@');
  if (versionSeparator <= 0 || versionSeparator === withoutPeerContext.length - 1) {
    throw new Error(`unsupported pnpm package key: ${packageKey}`);
  }
  return {
    name: withoutPeerContext.slice(0, versionSeparator),
    version: withoutPeerContext.slice(versionSeparator + 1),
  };
}

export function parsePnpmLock(lock) {
  return Object.keys(lock?.packages ?? {}).map((packageKey) => ({
    ...parsePnpmPackageKey(packageKey),
    license: '',
    lockKind: 'pnpm',
  }));
}

export function collectJavaScriptLockInventory(sources) {
  const inventory = new Map();
  for (const source of sources) {
    const packages = [
      ...(source.packageLock ? parseNpmPackageLock(source.packageLock) : []),
      ...(source.pnpmLock ? parsePnpmLock(source.pnpmLock) : []),
    ];
    for (const pkg of packages) {
      const coordinate = packageCoordinate(pkg.name, pkg.version);
      const existing = inventory.get(coordinate);
      if (!existing) {
        inventory.set(coordinate, {
          name: pkg.name,
          version: pkg.version,
          licenses: pkg.license ? [pkg.license] : [],
          scopes: [source.label],
          lockKinds: [pkg.lockKind],
        });
        continue;
      }
      existing.scopes = Array.from(new Set([...existing.scopes, source.label])).sort();
      existing.lockKinds = Array.from(new Set([...existing.lockKinds, pkg.lockKind])).sort();
      if (pkg.license) {
        existing.licenses = Array.from(new Set([...existing.licenses, pkg.license])).sort();
      }
    }
  }
  return Array.from(inventory.values()).sort((a, b) => (
    packageCoordinate(a.name, a.version).localeCompare(packageCoordinate(b.name, b.version))
  ));
}
