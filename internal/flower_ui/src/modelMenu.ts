// Product presentation only: alias folding never changes stored model identities.
export type FlowerMenuModel = Readonly<{
  id: string; label: string; group: string; aliasKey?: string; disabled?: boolean;
}>;

export function flowerMenuModels<T extends FlowerMenuModel>(options: readonly T[], selected: string, query: string): readonly (T & { aliases: readonly string[] })[] {
  const folded = new Map<string, T & { aliases: string[] }>();
  for (const option of options) {
    const key = option.aliasKey && !option.disabled ? `${option.group}/${option.aliasKey}` : option.id;
    const existing = folded.get(key);
    if (!existing) folded.set(key, { ...option, aliases: [] });
    else if (option.id === selected) folded.set(key, { ...option, aliases: [...existing.aliases, existing.label] });
    else existing.aliases.push(option.label);
  }
  const needle = query.trim().toLocaleLowerCase();
  return [...folded.values()].filter((model) => !needle || [model.label, model.id, model.group, ...model.aliases].some((text) => text.toLocaleLowerCase().includes(needle)));
}
