export function normalizeGitPatchText(text: string | null | undefined): string {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

export function hasMeaningfulGitPatchText(text: string | null | undefined): boolean {
  return normalizeGitPatchText(text)
    .split('\n')
    .some((line) => line.trim().length > 0);
}
