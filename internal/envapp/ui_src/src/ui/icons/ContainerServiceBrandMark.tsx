import { Show } from 'solid-js';
import { ExternalLink } from '@floegence/floe-webapp-core/icons';
import type { ContainerEngine } from '../services/containerResourcesApi';
import { REDEVEN_ENV_APP_BASE_PATH } from '../../build/envAppBasePath';
import './container-service-brand.css';

// IMPORTANT: Work surfaces and settings share the audited theSVG assets.
// Preserve the monochrome variant for forced-colors accessibility.
export function ContainerServiceBrandMark(props: { engine: ContainerEngine; remote?: boolean }) {
  const identity = () => props.engine === 'podman' ? 'podman' : 'docker';
  const defaultIcon = () => `${REDEVEN_ENV_APP_BASE_PATH}container-service-icons/${identity()}-default.svg`;
  const monoIcon = () => `url("${REDEVEN_ENV_APP_BASE_PATH}container-service-icons/${identity()}-mono.svg")`;
  return (
    <span class="container-service-brand" aria-hidden="true">
      <img class="container-service-brand__color" src={defaultIcon()} alt="" />
      <span
        class="container-service-brand__mono"
        style={{ 'mask-image': monoIcon(), '-webkit-mask-image': monoIcon() }}
      />
      <Show when={props.remote}><span class="container-service-brand__remote"><ExternalLink class="h-2.5 w-2.5" /></span></Show>
    </span>
  );
}
