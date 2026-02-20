/** Global CLI verbosity state, set by --verbose / --quiet program options. */

let _verbose = false;
let _quiet = false;

export function setVerbosity(verbose: boolean, quiet: boolean): void {
  _verbose = verbose;
  _quiet = quiet;
}

export function isVerbose(): boolean {
  return _verbose;
}

export function isQuiet(): boolean {
  return _quiet;
}
