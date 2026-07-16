import {
  readRendererScopedUIStorageJSON,
  writeRendererScopedUIStorageJSON,
} from '../services/uiStorage';

export const NETWORK_EXPOSURE_WARNING_PREFERENCE_STORAGE_KEY = 'redeven:network-exposure-warning-preference:v1';

type NetworkExposureWarningPreference = Readonly<{
  version: 1;
  suppressed: true;
}>;

export function readNetworkExposureWarningSuppressed(): boolean {
  const value = readRendererScopedUIStorageJSON<unknown>(
    NETWORK_EXPOSURE_WARNING_PREFERENCE_STORAGE_KEY,
    null,
  );
  if (!value || typeof value !== 'object') {
    return false;
  }
  const preference = value as Partial<NetworkExposureWarningPreference>;
  return preference.version === 1 && preference.suppressed === true;
}

export function suppressNetworkExposureWarning(): void {
  writeRendererScopedUIStorageJSON(
    NETWORK_EXPOSURE_WARNING_PREFERENCE_STORAGE_KEY,
    { version: 1, suppressed: true } satisfies NetworkExposureWarningPreference,
  );
}
