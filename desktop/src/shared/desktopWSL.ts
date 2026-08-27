export type DesktopWSLAvailability = 'ready' | 'wsl_missing' | 'no_distributions' | 'failed';
export type DesktopWSLDistributionState = 'running' | 'stopped';
export type DesktopWSLRegistrationStatus = 'eligible' | 'wsl1_unsupported' | 'version_unknown';

export type DesktopWSLDistribution = Readonly<{
  distribution_name: string;
  wsl_version: 1 | 2 | null;
  state: DesktopWSLDistributionState;
  registration_status: DesktopWSLRegistrationStatus;
}>;

export type DesktopWSLDiscoverySnapshot = Readonly<{
  availability: DesktopWSLAvailability;
  distributions: readonly DesktopWSLDistribution[];
  message?: string;
}>;

export type DesktopWSLDistributionProbe = Readonly<{
  distribution_name: string;
  linux_user: string;
  linux_home: string;
  architecture: 'amd64';
  missing_commands: readonly string[];
}>;

export const DESKTOP_WSL_REFRESH_CHANNEL = 'redeven-desktop:wsl-refresh';
export const DESKTOP_WSL_REGISTER_CHANNEL = 'redeven-desktop:wsl-register';
export const DESKTOP_WSL_SET_DEFAULT_CHANNEL = 'redeven-desktop:wsl-set-default';

export type DesktopWSLRegisterRequest = Readonly<{
  distribution_name: string;
}>;

export type DesktopWSLSetDefaultRequest = Readonly<{
  runtime_target_id: string | null;
}>;

export type DesktopWSLActionResponse = Readonly<{
  ok: boolean;
  message: string;
  message_key?: DesktopTranslationKey;
  message_params?: TranslationParams;
  runtime_target_id?: string;
}>;
import type { DesktopTranslationKey, TranslationParams } from './i18n/desktopI18n';
