const DEFAULT_LOG_TEXT_RUNES = 256;

export function safeLogText(value: unknown, maxRunes = DEFAULT_LOG_TEXT_RUNES): string {
  const normalized = Array.from(String(value), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && character !== '\u007f' ? character : ' ';
  }).join('').trim();
  const limit = Number.isSafeInteger(maxRunes) && maxRunes > 0 ? maxRunes : DEFAULT_LOG_TEXT_RUNES;
  const runes = Array.from(normalized);
  return runes.length > limit ? `${runes.slice(0, limit).join('')}...` : normalized;
}
