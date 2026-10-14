import { describe, expect, it } from 'vitest';
import { easeInOut, lerp, opacityAt, volumeAt } from '../src/player/fade';

describe('the crossfade curve', () => {
  it('starts at 0, ends at 1 and sits at the midpoint', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
  });

  it('clamps progress outside 0..1', () => {
    expect(easeInOut(-2)).toBe(0);
    expect(easeInOut(3)).toBe(1);
  });

  it('rises without ever going backwards', () => {
    let previous = -1;
    for (let step = 0; step <= 10; step += 1) {
      const value = easeInOut(step / 10);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('interpolates between two points', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 1)).toBe(20);
  });
});

describe('volume along the fade', () => {
  it('runs the whole 0–100 range', () => {
    expect(volumeAt(0, 100, 0)).toBe(0);
    expect(volumeAt(0, 100, 1)).toBe(100);
  });

  it('meets in the middle when the two ends are opposite', () => {
    expect(volumeAt(0, 100, 0.5)).toBe(50);
    expect(volumeAt(100, 0, 0.5)).toBe(50);
  });

  it('stays whole and inside 0..100', () => {
    for (let step = 0; step <= 10; step += 1) {
      const value = volumeAt(0, 100, step / 10);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('does not depend on which way it is heading', () => {
    // Fading out is the mirror of fading in, sample for sample.
    for (let step = 0; step <= 10; step += 1) {
      const progress = step / 10;
      expect(volumeAt(100, 0, 1 - progress)).toBe(volumeAt(0, 100, progress));
    }
  });
});

describe('opacity along the fade', () => {
  it('runs the whole 0..1 range', () => {
    expect(opacityAt(0, 1, 0)).toBe(0);
    expect(opacityAt(0, 1, 1)).toBe(1);
    expect(opacityAt(0, 1, 0.5)).toBe(0.5);
    expect(opacityAt(1, 0, 0.5)).toBe(0.5);
  });

  it('never leaves 0..1', () => {
    for (let step = 0; step <= 10; step += 1) {
      const value = opacityAt(0, 1, step / 10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
