import { createDocCommand } from './doc-command.js';

export function guidelinesCommand() {
  return createDocCommand('guidelines', 'guidelines', 'Display a coding guideline');
}
