import { createEffect, onCleanup, onMount, type Accessor } from 'solid-js';
import { getReloadPlaceholder } from '@floegence/floe-webapp-core/reload-placeholder';

const reloadPages = new Set(['applications', 'ports', 'containers', 'codespaces', 'files']);
const surfaces = [
  '[data-floe-shell-slot]', '.host-apps', '.web-services', '.codespaces-page', '.redeven-containers', '.host-apps-header', '.host-app-session', '.host-app-tile',
  '.web-services-header', '.web-service-row', '.codespace-card', '.container-header',
  '.container-resource-table-shell', '.container-service-card', 'thead', 'tbody tr',
  '[data-browser-workspace]', '[data-toolbar-layout]', '[data-file-browser-item-id]',
].join(',');

/** One document handoff; inventory and authorization remain owned by their existing services. */
export function createEnvReloadPresentation(options: {
  target: Accessor<string>;
  environment: Accessor<string>;
  authentication: Accessor<number>;
  activity: Accessor<boolean>;
  blocked: Accessor<boolean>;
}): void {
  const placeholder = getReloadPlaceholder();
  if (!placeholder) return;
  let target = options.target();
  let environment = options.environment();
  let authentication = options.authentication();
  let frame: number | undefined;
  let mounted = false;
  let observer: MutationObserver | undefined;
  const inspect = () => {
    frame = undefined;
    if (!options.activity() || !reloadPages.has(options.target()) || options.blocked()) {
      placeholder.clear();
      observer?.disconnect();
      return;
    }
    const shell = [...document.querySelectorAll('[data-floe-shell]')].find(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
    const main = shell?.querySelector('[data-floe-shell-slot="main"]');
    if (!shell || !main) return;
    placeholder.restrictTo(main);
    const presentation = [...main.querySelectorAll<HTMLElement>('[data-env-reload-state]')]
      .find(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
    const state = presentation?.dataset.envReloadState;
    if (state === 'content') {
      placeholder.finish();
      placeholder.arm(shell, surfaces);
      observer?.disconnect();
    } else if (state === 'error') {
      placeholder.clear();
      observer?.disconnect();
    }
  };
  const schedule = () => {
    if (mounted && frame === undefined) frame = requestAnimationFrame(inspect);
  };
  const watch = () => {
    const root = document.getElementById('root');
    if (root && observer) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-env-reload-state'] });
    schedule();
  };
  createEffect(() => {
    const nextTarget = options.target();
    const nextEnvironment = options.environment();
    const nextAuthentication = options.authentication();
    options.activity(); options.blocked();
    if (nextTarget !== target || nextEnvironment !== environment || nextAuthentication !== authentication) placeholder.clear();
    target = nextTarget;
    environment = nextEnvironment;
    authentication = nextAuthentication;
    watch();
  });
  onMount(() => {
    mounted = true;
    observer = new MutationObserver(schedule);
    watch();
  });
  onCleanup(() => {
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    placeholder.clear();
  });
}
