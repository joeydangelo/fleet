import { createDocCommand } from './doc-command.js';

export function templateCommand() {
  return createDocCommand('template', 'templates', 'Display a document template');
}
