// Native target ancestry is source lifecycle data, not a second control owner.
// A directory can report a compacted ancestor after an intermediate page closes.
// Keep both verified edges so another directory cannot erase that privacy fact.
export function createBrowserLineage(hasPrivateOwner) {
  const scopes = new Map(), sources = new Map();
  const key = (scope, tab) => JSON.stringify([scope, tab]);
  const prune = scope => {
    const nodes = scopes.get(scope);
    if (!nodes) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const [tab, node] of nodes) {
        if (node.live) continue;
        const children = [...nodes.values()].filter(child => child.parents.has(tab));
        if (children.length && node.source && hasPrivateOwner(node.source)) continue;
        for (const child of children) {
          child.parents.delete(tab);
          for (const parent of node.parents) child.parents.add(parent);
        }
        if (node.source) sources.delete(node.source);
        nodes.delete(tab); changed = true;
      }
    }
    if (!nodes.size) scopes.delete(scope);
  };
  const nativeLineage = (scope, tab) => {
    const nodes = scopes.get(scope), result = [], seen = new Set(), pending = [tab];
    while (pending.length) {
      const current = pending.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current); result.push(current);
      for (const parent of nodes?.get(current)?.parents ?? []) pending.push(parent);
    }
    return result;
  };
  return {
    observe(scope, tab, parent = '') {
      if (!scope || !tab || scope.length > 8192 || tab.length > 256 || parent.length > 256 || tab === parent) throw new Error('BROWSER_SOURCE_DIRECTORY_INVALID');
      let nodes = scopes.get(scope);
      if (!nodes) {
        if (scopes.size >= 128) throw new Error('BROWSER_SOURCE_DIRECTORY_LIMIT');
        nodes = new Map(); scopes.set(scope, nodes);
      }
      const existing = nodes.get(tab);
      if (!existing && nodes.size >= 1024) throw new Error('BROWSER_SOURCE_DIRECTORY_LIMIT');
      const parents = existing?.parents ?? new Set();
      if (parent) {
        if (parents.size >= 128 && !parents.has(parent)) throw new Error('BROWSER_SOURCE_DIRECTORY_LIMIT');
        if (nativeLineage(scope, parent).includes(tab)) throw new Error('BROWSER_SOURCE_DIRECTORY_INVALID');
        parents.add(parent);
      }
      nodes.set(tab, { ...existing, parents, live: true });
    },
    bind(scope, tab, source) {
      const node = scopes.get(scope)?.get(tab);
      if (!node || sources.has(source) && sources.get(source).key !== key(scope, tab)) throw new Error('BROWSER_SOURCE_IDENTITY_CHANGED');
      if (node.source && node.source !== source) {
        if (hasPrivateOwner(node.source)) throw new Error('BROWSER_SOURCE_PRIVATE');
        sources.delete(node.source);
      }
      node.source = source; sources.set(source, { scope, tab, key: key(scope, tab) });
    },
    ancestors(source) {
      const entry = sources.get(source);
      return entry ? nativeLineage(entry.scope, entry.tab).map(id => scopes.get(entry.scope)?.get(id)?.source).filter(id => id && id !== source) : [];
    },
    contains(scope, tab) { return scopes.get(scope)?.has(tab) ?? false; },
    nativeAncestors(scope, tab) { return nativeLineage(scope, tab).slice(1); },
    lineage(scope, tab) { return nativeLineage(scope, tab).map(id => scopes.get(scope)?.get(id)?.source).filter(Boolean); },
    remove(scope, tab) {
      const node = scopes.get(scope)?.get(tab);
      if (node) node.live = false;
      prune(scope);
    },
    reconcile(scope, live) {
      const active = new Set(live);
      for (const [tab, node] of scopes.get(scope) ?? []) node.live = active.has(tab);
      prune(scope);
    },
    refresh() { for (const scope of scopes.keys()) prune(scope); },
    closeScope(scope) {
      for (const node of scopes.get(scope)?.values() ?? []) if (node.source) sources.delete(node.source);
      scopes.delete(scope);
    },
    close() { scopes.clear(); sources.clear(); },
  };
}
