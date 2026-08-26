import type { DesktopTranslationKey } from './i18n/desktopI18n';

export type DesktopComponentTaskProgressStatus =
  | 'pending'
  | 'running'
  | 'failed'
  | 'canceled'
  | 'succeeded';

export type DesktopComponentTaskProgress = Readonly<{
  id: 'gateway' | 'runtime';
  status: DesktopComponentTaskProgressStatus;
  phase: 'preparing' | 'transferring' | 'verifying' | 'ready';
  strategy: 'desktop_upload' | 'remote_install';
  completed_bytes?: number;
  total_bytes?: number;
  detail_key?: DesktopTranslationKey;
}>;
