import { ChevronUp } from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from './icons/FlowerIcon';

/** Compact presentation only; readiness and placement remain with their owners. */
export function FlowerCompanionReadiness(props: Readonly<{
  label: string;
  busy: boolean;
  regionID?: string;
  ref?: (element: HTMLButtonElement) => void;
  onOpen: () => void;
}>) {
  return (
    <button ref={props.ref} type="button" class="flower-companion-readiness" data-busy={props.busy ? 'true' : 'false'}
      aria-expanded="false" aria-controls={props.regionID} title={props.label} onClick={props.onOpen}>
      <span class="flower-companion-readiness__icon" aria-hidden="true"><FlowerIcon /></span>
      <span class="flower-companion-readiness__label" role="status" aria-live="polite">{props.label}</span>
      <ChevronUp class="flower-companion-readiness__expand" aria-hidden="true" />
    </button>
  );
}
