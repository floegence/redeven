export type Engine = 'docker' | 'podman';
export type ContainerOperationKind = 'start' | 'stop' | 'restart' | 'remove';
export type ContainerOperationPhase =
  | 'submitting'
  | 'running'
  | 'cancel_requested'
  | 'cancel_outcome_unknown'
  | 'reconciling'
  | 'observation_paused'
  | 'submission_unknown';

export type ContainerOperationState = {
  key: string;
  engine: Engine;
  containerID: string;
  kind: ContainerOperationKind;
  generation: number;
  operationID: string;
  phase: ContainerOperationPhase;
  message: string;
};

export class ContainerOperationStore {
  readonly #operations = new Map<string, ContainerOperationState>();
  #nextGeneration = 0;

  begin(engine: Engine, containerID: string, kind: ContainerOperationKind): ContainerOperationState | undefined {
    const key = containerOperationKey(engine, containerID);
    if (this.#operations.has(key)) return undefined;
    const operation: ContainerOperationState = {
      key,
      engine,
      containerID,
      kind,
      generation: ++this.#nextGeneration,
      operationID: '',
      phase: 'submitting',
      message: `${operationLabel(kind)} is being submitted.`,
    };
    this.#operations.set(key, operation);
    return operation;
  }

  current(engine: Engine, containerID: string): ContainerOperationState | undefined {
    return this.#operations.get(containerOperationKey(engine, containerID));
  }

  get(key: string): ContainerOperationState | undefined {
    return this.#operations.get(key);
  }

  update(
    key: string,
    generation: number,
    patch: Partial<Pick<ContainerOperationState, 'operationID' | 'phase' | 'message'>>,
  ): ContainerOperationState | undefined {
    const current = this.#operations.get(key);
    if (!current || current.generation !== generation) return undefined;
    const next = { ...current, ...patch };
    this.#operations.set(key, next);
    return next;
  }

  finish(key: string, generation: number): boolean {
    const current = this.#operations.get(key);
    if (!current || current.generation !== generation) return false;
    this.#operations.delete(key);
    return true;
  }

  forEngine(engine: Engine): ContainerOperationState[] {
    return [...this.#operations.values()]
      .filter((operation) => operation.engine === engine)
      .sort((left, right) => left.generation - right.generation);
  }
}

export function containerOperationKey(engine: Engine, containerID: string): string {
  return `${engine}:${containerID}`;
}

export function operationLabel(kind: ContainerOperationKind): string {
  return `${kind[0].toUpperCase()}${kind.slice(1)}`;
}
