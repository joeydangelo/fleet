/** Global CLI verbosity state, set by --verbose / --quiet program options. */

let _verbose = false;

export function setVerbosity(verbose: boolean, _quiet: boolean): void {
  _verbose = verbose;
}

export function isVerbose(): boolean {
  return _verbose;
}
