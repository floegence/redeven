// Product presentation only: alias folding never changes stored model identities.
export type FlowerMenuModel = Readonly<{
  id: string; label: string; group: string; aliasKey?: string; disabled?: boolean;
}>;

export function flowerMenuModels<T extends FlowerMenuModel>(options: readonly T[], selected: string, recent: readonly string[], query: string, expanded: boolean): { models: readonly (T & { aliases: readonly string[] })[]; total: number } {
  const priority = [selected, ...recent];
  const rank = (id: string) => { const n = priority.indexOf(id); return n < 0 ? priority.length : n; };
  const ordered = [...options].sort((a, b) => rank(a.id) - rank(b.id));
  const folded = new Map<string, T & { aliases: string[] }>();
  for (const option of ordered) {
    const key = option.aliasKey && !option.disabled ? `${option.group}/${option.aliasKey}` : option.id;
    const existing = folded.get(key);
    if (existing) existing.aliases.push(option.label);
    else folded.set(key, { ...option, aliases: [] });
  }
  const needle = query.trim().toLocaleLowerCase();
  const matching = [...folded.values()].filter((model) => !needle || [model.label, model.id, model.group, ...model.aliases].some((text) => text.toLocaleLowerCase().includes(needle)));
  return { models: needle || expanded ? matching : matching.slice(0, 8), total: matching.length };
}
