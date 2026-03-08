export type GitPatchPathLike = {
  patchPath?: string;
  path?: string;
  newPath?: string;
  oldPath?: string;
};

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_FILE_RE = /^---\s+(?:a\/)?(.+)$/;
const NEW_FILE_RE = /^\+\+\+\s+(?:b\/)?(.+)$/;

function normalizeGitPatchPath(pathValue: string | null | undefined): string {
  let normalized = String(pathValue ?? '').trim().replaceAll('\\', '/');
  if (!normalized || normalized === '/dev/null') {
    return '';
  }
  normalized = normalized.replace(/^\.\//, '');
  normalized = normalized.replace(/^(?:a|b)\//, '');
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
}

function patchSectionMatches(sectionLines: string[], wantedPaths: Set<string>): boolean {
  for (const line of sectionLines) {
    const diffMatch = line.match(DIFF_HEADER_RE);
    if (diffMatch) {
      if (wantedPaths.has(normalizeGitPatchPath(diffMatch[1])) || wantedPaths.has(normalizeGitPatchPath(diffMatch[2]))) {
        return true;
      }
      continue;
    }

    const oldMatch = line.match(OLD_FILE_RE);
    if (oldMatch && wantedPaths.has(normalizeGitPatchPath(oldMatch[1]))) {
      return true;
    }

    const newMatch = line.match(NEW_FILE_RE);
    if (newMatch && wantedPaths.has(normalizeGitPatchPath(newMatch[1]))) {
      return true;
    }
  }
  return false;
}

export function normalizeGitPatchText(text: string | null | undefined): string {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

export function hasMeaningfulGitPatchText(text: string | null | undefined): boolean {
  return normalizeGitPatchText(text)
    .split('\n')
    .some((line) => line.trim().length > 0);
}

export function collectGitPatchPathCandidates(item: GitPatchPathLike | null | undefined): string[] {
  const ordered = [item?.patchPath, item?.path, item?.newPath, item?.oldPath]
    .map((value) => normalizeGitPatchPath(value))
    .filter(Boolean);
  return Array.from(new Set(ordered));
}

export function extractGitPatchSectionByPath(
  patchText: string | null | undefined,
  filePaths: readonly string[],
): string {
  const normalizedText = normalizeGitPatchText(patchText);
  const wantedPaths = new Set(filePaths.map((value) => normalizeGitPatchPath(value)).filter(Boolean));
  if (!hasMeaningfulGitPatchText(normalizedText)) {
    return '';
  }
  if (wantedPaths.size === 0) {
    return normalizedText;
  }

  const lines = normalizedText.split('\n');
  const sections: string[][] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }
      currentSection = [line];
      continue;
    }

    if (currentSection.length === 0) {
      continue;
    }
    currentSection.push(line);
  }

  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  for (const section of sections) {
    if (patchSectionMatches(section, wantedPaths)) {
      return section.join('\n').trimEnd();
    }
  }

  return '';
}
