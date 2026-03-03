import { createDocCommand } from './doc-command.js';

/** CLI command: display a document template. */
export function templateCommand() {
  return createDocCommand('template', 'templates', 'Display a document template');
}
