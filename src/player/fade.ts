//! The curve behind a crossfade, kept pure and free of the DOM.
//!
//! A crossfade is only volume automation and CSS opacity: the hook samples
//! these once per animation frame and pushes the results into `setVolume` and
//! the two player wrappers. Keeping the maths here means the ramp can be tested
//! without ever building a YouTube player.

/** How long a crossfade between two tracks takes. */
export const CROSSFADE_MS = 1500;

/**
 * How long to wait for the incoming track to start before giving up and
 * staying on the one already playing.
 */
export const CROSSFADE_TIMEOUT_MS = 8000;

/** Smoothstep: slow at both ends, quick through the middle. */
export function easeInOut(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** The integer volume (0–100) at a given raw progress through the fade. */
export function volumeAt(from: number, to: number, progress: number): number {
  const value = Math.round(lerp(from, to, easeInOut(progress)));
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

/** The wrapper opacity (0–1) at a given raw progress through the fade. */
export function opacityAt(from: number, to: number, progress: number): number {
  const value = lerp(from, to, easeInOut(progress));
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
