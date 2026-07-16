import { Show } from 'solid-js';
import { Cloud, Cpu } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import type { BrowserEditorInstallMethod } from '../services/codeRuntimeApi';

export type BrowserEditorInstallMethodSelectorProps = Readonly<{
  installMethod: BrowserEditorInstallMethod;
  desktopTransferAvailable: boolean;
  locked?: boolean;
  onChange: (method: BrowserEditorInstallMethod) => void;
}>;

export function BrowserEditorInstallMethodSelector(props: BrowserEditorInstallMethodSelectorProps) {
  const i18n = useI18n();
  let desktopMethodButton: HTMLButtonElement | undefined;
  let remoteMethodButton: HTMLButtonElement | undefined;

  const selectInstallMethod = (method: BrowserEditorInstallMethod): void => {
    if (props.locked || (method === 'desktop_transfer' && !props.desktopTransferAvailable)) return;
    props.onChange(method);
  };

  const handleInstallMethodKeyDown = (event: KeyboardEvent): void => {
    if (props.locked) return;
    const availableMethods: BrowserEditorInstallMethod[] = props.desktopTransferAvailable
      ? ['desktop_transfer', 'remote_download']
      : ['remote_download'];
    const currentIndex = Math.max(0, availableMethods.indexOf(props.installMethod));
    let nextIndex = currentIndex;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % availableMethods.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + availableMethods.length) % availableMethods.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = availableMethods.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextMethod = availableMethods[nextIndex];
    selectInstallMethod(nextMethod);
    (nextMethod === 'desktop_transfer' ? desktopMethodButton : remoteMethodButton)?.focus();
  };

  const tabStopMethod = (): BrowserEditorInstallMethod => (
    props.installMethod === 'desktop_transfer' && props.desktopTransferAvailable
      ? 'desktop_transfer'
      : 'remote_download'
  );

  return (
    <div class="browser-editor-setup__method-section">
      <div class="browser-editor-setup__method-label">{i18n.t('codeRuntime.installMethod.label')}</div>
      <div
        class="browser-editor-setup__method-selector"
        role="radiogroup"
        aria-label={i18n.t('codeRuntime.installMethod.label')}
        aria-readonly={props.locked ? 'true' : undefined}
      >
        <button
          ref={(element) => { desktopMethodButton = element; }}
          type="button"
          class="browser-editor-setup__method-option"
          data-selected={props.installMethod === 'desktop_transfer' ? 'true' : undefined}
          role="radio"
          aria-checked={props.installMethod === 'desktop_transfer'}
          aria-disabled={!props.desktopTransferAvailable || props.locked ? 'true' : undefined}
          tabIndex={tabStopMethod() === 'desktop_transfer' ? 0 : -1}
          disabled={!props.desktopTransferAvailable || props.locked}
          onClick={() => selectInstallMethod('desktop_transfer')}
          onKeyDown={handleInstallMethodKeyDown}
        >
          <Cpu class="h-4 w-4" />
          <span>{i18n.t('codeRuntime.installMethod.desktopTransfer')}</span>
        </button>
        <button
          ref={(element) => { remoteMethodButton = element; }}
          type="button"
          class="browser-editor-setup__method-option"
          data-selected={props.installMethod === 'remote_download' ? 'true' : undefined}
          role="radio"
          aria-checked={props.installMethod === 'remote_download'}
          aria-disabled={props.locked ? 'true' : undefined}
          tabIndex={tabStopMethod() === 'remote_download' ? 0 : -1}
          disabled={props.locked}
          onClick={() => selectInstallMethod('remote_download')}
          onKeyDown={handleInstallMethodKeyDown}
        >
          <Cloud class="h-4 w-4" />
          <span>{i18n.t('codeRuntime.installMethod.remoteDownload')}</span>
        </button>
      </div>
      <div class="browser-editor-setup__data-path">
        {props.installMethod === 'desktop_transfer'
          ? i18n.t('codeRuntime.installMethod.desktopPath')
          : i18n.t('codeRuntime.installMethod.remotePath')}
      </div>
      <Show when={!props.desktopTransferAvailable}>
        <div class="browser-editor-setup__method-availability">
          {i18n.t('codeRuntime.installMethod.desktopUnavailable')}
        </div>
      </Show>
    </div>
  );
}
