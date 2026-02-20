import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setVerbosity, isVerbose, isQuiet } from '../src/lib/context.js';

describe('CLI verbosity context', () => {
  beforeEach(() => {
    setVerbosity(false, false);
  });

  afterEach(() => {
    setVerbosity(false, false);
  });

  it('defaults to non-verbose, non-quiet', () => {
    expect(isVerbose()).toBe(false);
    expect(isQuiet()).toBe(false);
  });

  it('setVerbosity(true, false) enables verbose', () => {
    setVerbosity(true, false);
    expect(isVerbose()).toBe(true);
    expect(isQuiet()).toBe(false);
  });

  it('setVerbosity(false, true) enables quiet', () => {
    setVerbosity(false, true);
    expect(isVerbose()).toBe(false);
    expect(isQuiet()).toBe(true);
  });
});
