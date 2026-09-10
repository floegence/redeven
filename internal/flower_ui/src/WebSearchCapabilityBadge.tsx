import type { FlowerWebSearchAvailability } from './contracts/flowerSurfaceContracts';
import type { ModelCatalogCopy } from './settings/modelCatalogCopy';
import { flowerWebSearchLabel } from './webSearchCapability';

export function WebSearchCapabilityBadge(props: Readonly<{ availability?: FlowerWebSearchAvailability; copy: ModelCatalogCopy }>) {
  return <span
    class="inline-flex max-w-full items-center rounded border border-border/60 px-1.5 py-0.5 text-[10px] leading-normal text-muted-foreground"
    data-web-search={props.availability?.status ?? 'pending'}
    title={flowerWebSearchLabel(props.availability, props.copy)}
  >{flowerWebSearchLabel(props.availability, props.copy)}</span>;
}
