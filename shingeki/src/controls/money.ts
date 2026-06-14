/**
 * Money is held internally as integer minor units (e.g. cents) so that
 * arithmetic and comparisons are exact — never as binary floats.
 */

/** Convert major units (e.g. dollars) to integer minor units (e.g. cents). */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new Error(`amount is not finite: ${major}`);
  return Math.round(major * 100);
}

/** Convert integer minor units back to major units. */
export function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

/** Round a major-unit amount to whole cents (2 dp). */
export function round2(major: number): number {
  return toMajor(toMinor(major));
}
