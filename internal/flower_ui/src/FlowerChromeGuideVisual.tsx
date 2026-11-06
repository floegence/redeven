import { ArrowRight } from '@floegence/floe-webapp-core/icons';
import { FlowerComputerBrandIcon } from './FlowerComputerIdentity';
import { FlowerIcon } from './icons/FlowerIcon';

// Brand identity only. Installation controls belong to the real browser.
export function FlowerChromeGuideVisual(props: { chromium?: boolean }) {
  return <div class="flower-chrome-guide-visual" aria-hidden="true">
    <div class="flower-chrome-guide-link">
      <span class="flower-chrome-guide-app"><FlowerIcon /></span>
      <span class="flower-chrome-guide-link-line"><ArrowRight /></span>
      <span class="flower-chrome-guide-app"><FlowerComputerBrandIcon kind={props.chromium ? 'chromium' : 'chrome'} /></span>
    </div>
  </div>;
}
