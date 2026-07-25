type IsolationState = {
  count: number;
  originalInert: boolean;
};

const isolationStates = new WeakMap<HTMLElement, IsolationState>();

export function isolateDocumentBranch(branch: HTMLElement): () => void {
  const isolated: HTMLElement[] = [];
  let current = branch;

  while (current.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === current) continue;
      const state = isolationStates.get(sibling);
      if (state) {
        state.count += 1;
      } else {
        isolationStates.set(sibling, { count: 1, originalInert: sibling.inert });
        sibling.inert = true;
      }
      isolated.push(sibling);
    }
    if (parent === document.body) break;
    current = parent;
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const element of isolated) {
      const state = isolationStates.get(element);
      if (!state) continue;
      state.count -= 1;
      if (state.count > 0) continue;
      element.inert = state.originalInert;
      isolationStates.delete(element);
    }
  };
}
