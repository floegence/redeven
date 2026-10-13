import type { DesktopTranslationKey } from './i18n/desktopI18n';

export type DesktopComponentTaskProgressStatus =
  | 'pending'
  | 'running'
  | 'failed'
  | 'canceled'
  | 'succeeded';

export type DesktopRuntimeTransferProgress = Readonly<{
  transfer_kind: 'upload' | 'download';
  transfer_percent?: number;
  completed_bytes?: number;
  total_bytes?: number;
}>;

export type DesktopComponentTaskProgress = Readonly<{
  id: 'gateway' | 'runtime';
  status: DesktopComponentTaskProgressStatus;
  phase: 'preparing' | 'transferring' | 'verifying' | 'ready';
  strategy: 'desktop_upload' | 'remote_install';
  completed_bytes?: number;
  total_bytes?: number;
  transfer_kind?: DesktopRuntimeTransferProgress['transfer_kind'];
  transfer_percent?: number;
  detail_key?: DesktopTranslationKey;
}>;
