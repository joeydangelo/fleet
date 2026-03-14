/** Global CLI verbosity state, set by --verbose program option. */

let _verbose = false;

/** Update the global verbosity flag from CLI options. */
export function setVerbosity(verbose: boolean): void {
  _verbose = verbose;
}

/** Whether verbose output is enabled for the current CLI invocation. */
export function isVerbose(): boolean {
  return _verbose;
}

import pc from 'picocolors';

export type ColorOption = 'auto' | 'always' | 'never';

let _colorOption: ColorOption = 'auto';

export function setColorOption(option: ColorOption): void {
  _colorOption = option;
}

export function getColorOption(): ColorOption {
  return _colorOption;
}

export function shouldColorize(colorOption: ColorOption = _colorOption): boolean {
  if (colorOption === 'always') return true;
  if (colorOption === 'never') return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return process.stdout.isTTY === true;
}

export function createSemanticColors(colorOption: ColorOption = _colorOption) {
  const c = pc.createColors(shouldColorize(colorOption));
  return {
    success: c.green,
    error: c.red,
    warn: c.yellow,
    info: c.cyan,
    muted: c.gray,
    bold: c.bold,
    dim: c.dim,
  };
}
