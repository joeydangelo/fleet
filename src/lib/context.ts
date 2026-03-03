/** Global CLI verbosity state, set by --verbose / --quiet program options. */

let _verbose = false;

/** Update the global verbosity flag from CLI options. */
export function setVerbosity(verbose: boolean, _quiet: boolean): void {
  _verbose = verbose;
}

/** Whether verbose output is enabled for the current CLI invocation. */
export function isVerbose(): boolean {
  return _verbose;
}
