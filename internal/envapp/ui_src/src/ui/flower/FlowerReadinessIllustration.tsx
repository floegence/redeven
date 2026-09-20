import { ShieldCheck } from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from '../../../../../flower_ui/src/icons/FlowerIcon';

export function FlowerReadinessIllustration() {
  return (
    <div class="flower-readiness-art" aria-hidden="true">
      <div class="flower-readiness-art__halo" />
      <div class="flower-readiness-art__orbit" />
      <div class="flower-readiness-art__page flower-readiness-art__page--back">
        <span /><span /><span />
      </div>
      <div class="flower-readiness-art__page flower-readiness-art__page--front">
        <span /><span /><span />
        <div class="flower-readiness-art__seal"><ShieldCheck /></div>
      </div>
      <div class="flower-readiness-art__bloom"><FlowerIcon /></div>
      <span class="flower-readiness-art__seed flower-readiness-art__seed--first" />
      <span class="flower-readiness-art__seed flower-readiness-art__seed--second" />
    </div>
  );
}
