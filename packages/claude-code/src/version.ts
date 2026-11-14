export const MIN_VERSION = "2.1.287";
export const RECOMMENDED_VERSION = "2.1.309";
export const SETTINGS_READ_VERSION = "2.1.304";

/**
 * Read a version out of the shapes the engine exposes: a string or
 * `{ version, base? }` from `$.session.version()`.
 */
export function versionOf(input: unknown): string | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim().replace(/^v/i, "");
    return trimmed === "" ? undefined : trimmed;
  }
  if (input && typeof input === "object") {
    const candidate = input as { version?: unknown; base?: unknown };
    if (typeof candidate.version === "string" && candidate.version.trim() !== "") {
      return candidate.version.trim().replace(/^v/i, "");
    }
    if (typeof candidate.base === "string" && candidate.base.trim() !== "") {
      return candidate.base.trim().replace(/^v/i, "");
    }
  }
  return undefined;
}

function numericSegments(version: string): number[] {
  return version
    .split("-")[0]
    .split(".")
    .map((segment) => {
      const value = Number.parseInt(segment, 10);
      return Number.isFinite(value) ? value : 0;
    });
}

/**
 * Compare two semantic versions by numeric segments. A missing segment counts
 * as zero. Returns a negative number when `a` is older, zero when equal and a
 * positive number when `a` is newer.
 */
export function compareVersions(a: string, b: string): number {
  const left = numericSegments(a);
  const right = numericSegments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

/**
 * Whether `version` is at least `minimum`.
 */
export function isAtLeast(version: string, minimum: string): boolean {
  return compareVersions(version, minimum) >= 0;
}
