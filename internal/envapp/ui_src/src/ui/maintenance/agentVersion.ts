import type { AgentLatestVersion } from '../services/controlplaneApi';

const RELEASE_VERSION_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RELEASE_VERSION_CORE_RE = /^v(\d+)\.(\d+)\.(\d+)/;

type ReleaseVersionCore = Readonly<{
  major: number;
  minor: number;
  patch: number;
}>;

function normalizeReleaseVersion(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

export function isReleaseVersion(raw: string | null | undefined): boolean {
  const value = normalizeReleaseVersion(raw);
  if (!value) return false;
  return RELEASE_VERSION_RE.test(value);
}

export function parseReleaseVersionCore(raw: string | null | undefined): ReleaseVersionCore | null {
  const value = normalizeReleaseVersion(raw);
  if (!isReleaseVersion(value)) return null;

  const match = RELEASE_VERSION_CORE_RE.exec(value);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;

  return { major, minor, patch };
}

export function compareReleaseVersionCore(leftRaw: string | null | undefined, rightRaw: string | null | undefined): number | null {
  const left = parseReleaseVersionCore(leftRaw);
  const right = parseReleaseVersionCore(rightRaw);
  if (!left || !right) return null;

  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

export function resolvePreferredTargetVersion(meta: AgentLatestVersion | null | undefined): string {
  const recommended = normalizeReleaseVersion(meta?.recommended_version);
  if (isReleaseVersion(recommended)) return recommended;
  return normalizeReleaseVersion(meta?.latest_version);
}
