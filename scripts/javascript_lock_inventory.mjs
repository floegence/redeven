function packageNameFromNpmPath(packagePath) {
  const parts = String(packagePath).split('node_modules/');
  return parts[parts.length - 1] ?? '';
}

export function packageCoordinate(name, version) {
  return `${name}@${version}`;
}

function normalizeLicense(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  if (!isRecord(lock) || String(lock.lockfileVersion) !== '9.0') {
    throw new Error(`unsupported pnpm lockfileVersion: ${lock?.lockfileVersion ?? 'missing'}`);
  }
  if (!Object.hasOwn(lock, 'packages') || !isRecord(lock.packages)) {
    throw new Error('pnpm v9 lock packages must be an object');
  }
  return Object.entries(lock.packages).map(([packageKey, meta]) => {
    if (!isRecord(meta)) {
      throw new Error(`pnpm v9 package metadata must be an object: ${packageKey}`);
    }
    return {
      ...parsePnpmPackageKey(packageKey),
      license: '',
      lockKind: 'pnpm',
      platformFiltered: Array.isArray(meta.os) || Array.isArray(meta.cpu),
    };
  });
}

export function resolvePackageLicense(pkg, options = {}) {
  const coordinate = packageCoordinate(pkg.name, pkg.version);
  const exactLicenses = Array.from(new Set((pkg.licenses ?? []).map(normalizeLicense).filter(Boolean))).sort();
  if (exactLicenses.length > 1) {
    throw new Error(`conflicting exact license metadata for ${coordinate}: ${exactLicenses.join(', ')}`);
  }

  const packageOverride = options.packageOverrides?.get(pkg.name);
  const coordinateOverride = options.coordinateOverrides?.get(coordinate);
  const normalizedPackageOverride = normalizeLicense(packageOverride?.license);
  const normalizedCoordinateOverride = normalizeLicense(coordinateOverride?.license);
  if (normalizedPackageOverride && normalizedCoordinateOverride
      && normalizedPackageOverride !== normalizedCoordinateOverride) {
    throw new Error(`conflicting audited license overrides for ${coordinate}: ${normalizedPackageOverride}, ${normalizedCoordinateOverride}`);
  }
  const override = coordinateOverride ?? packageOverride;
  const overrideLicense = normalizeLicense(override?.license);
  const exactLicense = exactLicenses[0];
  if (exactLicense && overrideLicense && exactLicense !== overrideLicense) {
    throw new Error(`audited license override conflicts with exact metadata for ${coordinate}: ${overrideLicense}, ${exactLicense}`);
  }
  return {
    license: exactLicense || overrideLicense || 'UNKNOWN',
    notes: override?.note ? [String(override.note)] : [],
  };
}

export function assertPlatformFilteredLicensesResolvable(inventory, options = {}) {
  const unresolved = [];
  for (const pkg of inventory) {
    if (!pkg.platformFiltered) continue;
    const resolution = resolvePackageLicense(pkg, options);
    if (resolution.license === 'UNKNOWN') {
      unresolved.push(packageCoordinate(pkg.name, pkg.version));
    }
  }
  if (unresolved.length > 0) {
    throw new Error(`platform-filtered packages require platform-independent exact license evidence: ${unresolved.join(', ')}`);
  }
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
          platformFiltered: Boolean(pkg.platformFiltered),
        });
        continue;
      }
      existing.scopes = Array.from(new Set([...existing.scopes, source.label])).sort();
      existing.lockKinds = Array.from(new Set([...existing.lockKinds, pkg.lockKind])).sort();
      existing.platformFiltered ||= Boolean(pkg.platformFiltered);
      if (pkg.license) {
        existing.licenses = Array.from(new Set([...existing.licenses, pkg.license])).sort();
      }
    }
  }
  return Array.from(inventory.values()).sort((a, b) => (
    packageCoordinate(a.name, a.version).localeCompare(packageCoordinate(b.name, b.version))
  ));
}
