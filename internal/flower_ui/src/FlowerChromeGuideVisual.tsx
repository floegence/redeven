import { Show } from 'solid-js';
import { ArrowRight, Folder } from '@floegence/floe-webapp-core/icons';
import type { FlowerComputerCopy } from './computerUseCopy';
import { FlowerComputerBrandIcon } from './FlowerComputerIdentity';
import { FlowerIcon } from './icons/FlowerIcon';

// Illustrations are deliberately noninteractive: browser controls still belong
// to the browser, and only the explicit action buttons open external surfaces.
export function FlowerChromeGuideVisual(props: {
  mode: 'intro' | 'install' | 'connect'; copy: FlowerComputerCopy; chromium?: boolean;
}) {
  return <div class="flower-chrome-guide-visual" data-guide-visual={props.mode} aria-hidden="true">
    <Show when={props.mode === 'install'} fallback={<div class="flower-chrome-guide-link">
      <span class="flower-chrome-guide-app"><FlowerIcon /></span>
      <span class="flower-chrome-guide-link-line"><ArrowRight /></span>
      <span class="flower-chrome-guide-app"><FlowerComputerBrandIcon kind={props.chromium ? 'chromium' : 'chrome'} /></span>
    </div>}>
      <div class="flower-chrome-guide-window">
        <div class="flower-chrome-guide-toolbar"><FlowerComputerBrandIcon kind={props.chromium ? 'chromium' : 'chrome'} /><span>{props.copy.setupExtensionsLabel}</span><span class="flower-chrome-guide-mode"><span class="flower-chrome-guide-number">1</span>{props.copy.setupDeveloperLabel}<span class="flower-chrome-guide-toggle" /></span></div>
        <div class="flower-chrome-guide-drop">
          <div class="flower-chrome-guide-folder"><Folder /><FlowerIcon /></div>
          <ArrowRight class="flower-chrome-guide-drag-arrow" />
          <div class="flower-chrome-guide-target"><FlowerIcon /><span>{props.copy.setupDropLabel}</span></div>
        </div>
      </div>
    </Show>
  </div>;
}
