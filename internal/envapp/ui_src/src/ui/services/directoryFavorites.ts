import { createLocalizedFilesystemPickerCopy } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { envDirectoryFavorites } from './sessionHTTP';

/** Navigation metadata is shared without creating a directory navigation controller. */
export function useEnvDirectoryFavorites() {
  const i18n = useI18n();
  const copy = () => createLocalizedFilesystemPickerCopy({ t: (key, params) => i18n.t(key as EnvAppTranslationKey, params) });
  return {
    get copy() { return copy(); },
    get directoryFavorites() { return envDirectoryFavorites(() => copy().favoritesLoadFailed); },
  };
}
