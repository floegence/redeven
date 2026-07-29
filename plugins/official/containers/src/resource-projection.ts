import { localizedSearchTerms, type ContainersLocale, type CopyKey } from './i18n';
import type {
  ComposeProject,
  Container,
  ContainersAppState,
  Endpoint,
  Image,
  Pod,
  ResourceFilter,
  SortKey,
  View,
  Volume,
} from './model';

type Copy = (key: CopyKey) => string;

export class ResourceProjection {
  constructor(
    private readonly state: ContainersAppState,
    private readonly languageTag: () => string,
    private readonly locale: () => ContainersLocale,
    private readonly copy: Copy,
    private readonly statusLabel: (status: string) => string,
  ) {}

  containers(): Container[] {
    const query = this.query();
    const filter = this.state.filters.containers;
    return this.state.containers
      .filter((item) => (
        !query
        || this.matches(
          query,
          item.name,
          item.container_id,
          item.image.reference,
          item.image.digest,
          item.state,
          this.statusLabel(item.state),
          ...localizedSearchTerms(this.locale(), 'containers'),
        )
      ) && matchesStateFilter(filter, item.state, ['running', 'paused', 'restarting']))
      .sort(this.containerComparator(this.state.sorts.containers));
  }

  images(): Image[] {
    const query = this.query();
    const filter = this.state.filters.images;
    return this.state.images
      .filter((item) => (
        !query
        || this.matches(query, item.id, item.reference, item.digest, ...(item.tags ?? []), ...localizedSearchTerms(this.locale(), 'images'))
      ) && matchesUsageFilter(filter, item.referenced_containers, this.state.partialFailures.images))
      .sort(this.imageComparator(this.state.sorts.images));
  }

  volumes(): Volume[] {
    const query = this.query();
    const filter = this.state.filters.volumes;
    return this.state.volumes
      .filter((item) => (
        !query
        || this.matches(query, item.name, item.driver, item.scope, ...localizedSearchTerms(this.locale(), 'volumes'))
      ) && matchesUsageFilter(filter, item.referenced_containers, this.state.partialFailures.volumes))
      .sort(this.volumeComparator(this.state.sorts.volumes));
  }

  projects(): ComposeProject[] {
    const query = this.query();
    const filter = this.state.filters.projects;
    return this.state.projects
      .filter((item) => (!query || this.matches(query, item.name, item.project_id, item.status)) && matchesRunningFilter(filter, item.status))
      .sort((a, b) => this.state.sorts.projects === 'state'
        ? a.status.localeCompare(b.status) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name));
  }

  pods(): Pod[] {
    const query = this.query();
    const filter = this.state.filters.pods;
    return this.state.pods
      .filter((item) => (!query || this.matches(query, item.name, item.pod_id, item.status)) && matchesStateFilter(filter, item.status, ['running', 'paused']))
      .sort((a, b) => this.state.sorts.pods === 'created'
        ? (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0)
        : this.state.sorts.pods === 'state'
          ? a.status.localeCompare(b.status) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name));
  }

  count(view: View): number {
    if (view === 'overview') return 0;
    if (view === 'containers') return this.containers().length;
    if (view === 'images') return this.images().length;
    if (view === 'volumes') return this.volumes().length;
    if (view === 'projects') return this.projects().length;
    return this.pods().length;
  }

  inventoryCount(view: View): number {
    if (view === 'overview') return 0;
    if (view === 'containers') return this.state.containers.length;
    if (view === 'images') return this.state.images.length;
    if (view === 'volumes') return this.state.volumes.length;
    if (view === 'projects') return this.state.projects.length;
    return this.state.pods.length;
  }

  hasRefinements(view: View): boolean {
    return this.query() !== '' || this.state.filters[view] !== 'all';
  }

  destructiveDisabled(view: Exclude<View, 'overview'>): boolean {
    const partial = view === 'images' || view === 'volumes' ? this.state.partialFailures[view] > 0 : false;
    return !this.state.available || !this.state.inventoryFresh[view] || Boolean(this.state.viewErrors[view]) || partial;
  }

  filterOptions(view: View): Array<{ value: ResourceFilter; label: string }> {
    if (view === 'containers' || view === 'pods') {
      return this.filterLabels(['all', 'running', 'paused', 'stopped']);
    }
    if (view === 'projects') return this.filterLabels(['all', 'running', 'stopped']);
    return this.filterLabels(['all', 'in-use', 'unused']);
  }

  sortOptions(view: View): Array<{ value: SortKey; label: string }> {
    const options: Array<{ value: SortKey; label: string }> = [
      { value: 'name', label: this.copy('sortName') },
      { value: 'created', label: this.copy('sortCreated') },
    ];
    if (view === 'containers') options.push({ value: 'state', label: this.copy('sortState') }, { value: 'usage', label: this.copy('sortUsage') });
    if (view === 'images') options.push({ value: 'size', label: this.copy('sortSize') }, { value: 'usage', label: this.copy('sortUsage') });
    if (view === 'volumes') options.push({ value: 'usage', label: this.copy('sortUsage') });
    if (view === 'projects' || view === 'pods') options.push({ value: 'state', label: this.copy('sortState') });
    return options;
  }

  availableViews(): View[] {
    return this.state.engine === 'docker'
      ? ['overview', 'containers', 'images', 'volumes', 'projects']
      : ['overview', 'containers', 'images', 'volumes', 'pods'];
  }

  selectedEndpoint(): Endpoint | undefined {
    return this.state.endpoints.find((item) => item.endpoint_id === this.state.endpointID);
  }

  imageName(image: Image): string {
    return image.reference || image.tags?.[0] || image.digest || image.id;
  }

  private query(): string {
    return this.state.query.normalize('NFKC').trim().toLocaleLowerCase(this.languageTag());
  }

  private matches(query: string, ...values: unknown[]): boolean {
    return values.some((value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase(this.languageTag()).includes(query));
  }

  private filterLabels(filters: ResourceFilter[]): Array<{ value: ResourceFilter; label: string }> {
    const labels: Record<ResourceFilter, CopyKey> = {
      all: 'allResources',
      running: 'running',
      paused: 'paused',
      stopped: 'stopped',
      'in-use': 'inUse',
      unused: 'unused',
    };
    return filters.map((value) => ({ value, label: this.copy(labels[value]) }));
  }

  private containerComparator(sort: SortKey): (a: Container, b: Container) => number {
    if (sort === 'created') return (a, b) => (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0);
    if (sort === 'usage') return (a, b) => (this.state.containerStats.get(b.container_id)?.cpu_percent ?? -1) - (this.state.containerStats.get(a.container_id)?.cpu_percent ?? -1);
    if (sort === 'state') return compareContainers;
    return (a, b) => (a.name || a.container_id).localeCompare(b.name || b.container_id);
  }

  private imageComparator(sort: SortKey): (a: Image, b: Image) => number {
    if (sort === 'created') return (a, b) => (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0);
    if (sort === 'size') return (a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
    if (sort === 'usage') return (a, b) => b.referenced_containers - a.referenced_containers;
    return (a, b) => this.imageName(a).localeCompare(this.imageName(b));
  }

  private volumeComparator(sort: SortKey): (a: Volume, b: Volume) => number {
    if (sort === 'created') return (a, b) => (b.created_at_unix_ms ?? 0) - (a.created_at_unix_ms ?? 0);
    if (sort === 'usage') return (a, b) => b.referenced_containers - a.referenced_containers;
    return (a, b) => a.name.localeCompare(b.name);
  }
}

function matchesStateFilter(filter: ResourceFilter, state: string, inactiveStates: string[]): boolean {
  return filter === 'all'
    || filter === 'running' && state === 'running'
    || filter === 'paused' && state === 'paused'
    || filter === 'stopped' && !inactiveStates.includes(state);
}

function matchesRunningFilter(filter: ResourceFilter, state: string): boolean {
  return filter === 'all'
    || filter === 'running' && state === 'running'
    || filter === 'stopped' && state !== 'running';
}

function matchesUsageFilter(filter: ResourceFilter, references: number, partialFailures: number): boolean {
  return filter === 'all'
    || filter === 'in-use' && references > 0
    || filter === 'unused' && partialFailures === 0 && references === 0;
}

function compareContainers(a: Container, b: Container): number {
  const rank = (state: string) => state === 'running' ? 0 : state === 'paused' ? 1 : 2;
  return rank(a.state) - rank(b.state) || (a.name || a.container_id).localeCompare(b.name || b.container_id);
}
