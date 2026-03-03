import { createDocCommand } from './doc-command.js';

/** CLI command: display a coding guideline document. */
export function guidelinesCommand() {
  return createDocCommand('guidelines', 'guidelines', 'Display a coding guideline');
}
