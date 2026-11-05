import type { FlowerComputerEnvironment } from './contracts/flowerSurfaceContracts';

// The observation comes from the selected Runtime. It is evidence for Flower,
// not a command or an authority to select a different host.
export function desktopRepairPrompt(instruction: string, observationLabel: string, environment: FlowerComputerEnvironment): string {
  const bounded = (value: string | undefined) => (value ?? '').slice(0, 512);
  const desktop = environment.desktop;
  const observation = {
    hostname: bounded(environment.hostname),
    platform: bounded(environment.platform),
    desktop: {
      state: desktop.state,
      reason: bounded(desktop.reason),
      repair: bounded(desktop.repair),
      components: desktop.components?.slice(0, 16).map(component => ({
        id: bounded(component.id), path: bounded(component.path), overridden: component.overridden === true,
      })),
      packages: desktop.packages?.slice(0, 16).map(bounded),
    },
  };
  return `${instruction}\n\n${observationLabel}\n${JSON.stringify(observation, null, 2)}`;
}
