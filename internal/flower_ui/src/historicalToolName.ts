import names from '../../ai/toolnames/migration.json';

/** Read-only display/configuration lookup; never changes canonical activity identity. */
export function historicalToolName(name: string): string {
  return Object.hasOwn(names, name) ? (names as Record<string, string>)[name] : name;
}
