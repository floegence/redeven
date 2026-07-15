import type { BrowserEditorInstallMethod } from './codeRuntimeApi';

export type BrowserEditorSetupFailureSource =
  | 'desktop_release_lookup'
  | 'desktop_package_cache'
  | 'desktop_upload'
  | 'remote_catalog'
  | 'remote_download'
  | 'remote_source'
  | 'package_verification'
  | 'installation'
  | 'runtime_import'
  | 'runtime_status'
  | 'unknown';

export class BrowserEditorSetupError extends Error {
  readonly source: BrowserEditorSetupFailureSource;

  constructor(source: BrowserEditorSetupFailureSource, message: string) {
    super(message);
    this.name = 'BrowserEditorSetupError';
    this.source = source;
  }
}

export function browserEditorSetupError(
  source: BrowserEditorSetupFailureSource,
  error: unknown,
): BrowserEditorSetupError {
  if (error instanceof BrowserEditorSetupError) return error;
  const message = error instanceof Error
    ? error.message
    : String(error ?? '').trim() || 'Browser Editor setup did not finish successfully.';
  return new BrowserEditorSetupError(source, message);
}

export function browserEditorSetupFailureSource(error: unknown): BrowserEditorSetupFailureSource {
  return error instanceof BrowserEditorSetupError ? error.source : 'unknown';
}

export function browserEditorRuntimeFailureSource(
  errorCode: string | null | undefined,
  installMethod: BrowserEditorInstallMethod,
): BrowserEditorSetupFailureSource {
  const code = String(errorCode ?? '').trim();
  if (code.startsWith('catalog_')) return 'remote_catalog';
  if (code === 'package_source_rejected') return 'remote_source';
  if (code.startsWith('environment_download_')) return 'remote_download';
  if (code === 'artifact_validation_failed') return 'package_verification';
  if (code === 'artifact_install_failed' || code === 'finalize_failed') return 'installation';
  if (code.startsWith('transfer_') || installMethod === 'desktop_transfer') return 'desktop_upload';
  return 'unknown';
}
