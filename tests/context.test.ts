import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldColorize } from '../src/lib/context.js';

describe('shouldColorize', () => {
  let originalNoColor: string | undefined;
  let originalForceColor: string | undefined;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR;
    originalForceColor = process.env.FORCE_COLOR;
    originalIsTTY = process.stdout.isTTY;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    // Default to non-TTY so tests are deterministic
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it('returns true when colorOption is always', () => {
    expect(shouldColorize('always')).toBe(true);
  });

  it('returns false when colorOption is never', () => {
    expect(shouldColorize('never')).toBe(false);
  });

  it('returns false when NO_COLOR is set and colorOption is auto', () => {
    process.env.NO_COLOR = '1';
    expect(shouldColorize('auto')).toBe(false);
  });

  it('returns true when FORCE_COLOR is set and colorOption is auto', () => {
    process.env.FORCE_COLOR = '1';
    expect(shouldColorize('auto')).toBe(true);
  });

  it('returns false when FORCE_COLOR is 0 and colorOption is auto', () => {
    process.env.FORCE_COLOR = '0';
    expect(shouldColorize('auto')).toBe(false);
  });

  it('always flag overrides NO_COLOR env var', () => {
    process.env.NO_COLOR = '1';
    expect(shouldColorize('always')).toBe(true);
  });

  it('never flag overrides FORCE_COLOR env var', () => {
    process.env.FORCE_COLOR = '1';
    expect(shouldColorize('never')).toBe(false);
  });

  it('returns true when isTTY is true and no env overrides', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    expect(shouldColorize('auto')).toBe(true);
  });

  it('returns false when isTTY is false and no env overrides', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(shouldColorize('auto')).toBe(false);
  });
});
