export const MANAGED_RUNTIME_STAMP_FILENAME = 'managed-runtime.stamp';
export const MANAGED_RUNTIME_STAMP_SCHEMA_VERSION = 2;

export const MANAGED_RUNTIME_DIRECTORY_MODE = '700';
export const MANAGED_RUNTIME_EXECUTABLE_MODE = '700';
export const MANAGED_RUNTIME_METADATA_MODE = '600';

export const MANAGED_RUNTIME_EVIDENCE_FILENAMES = [
  '.redevplugin-release-artifacts-verified.json',
  'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
  'REDEVPLUGIN_RUNTIME.spdx.json',
  'redevplugin-runtime.provenance.json',
  'redevplugin-runtime.sig',
  'redevplugin-runtime.pem',
] as const;

export const MANAGED_RUNTIME_COMPANION_FILENAMES = [
  ...MANAGED_RUNTIME_EVIDENCE_FILENAMES,
  'redevplugin-runtime',
] as const;
