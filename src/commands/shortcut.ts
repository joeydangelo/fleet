import { createDocCommand } from './doc-command.js';

/** CLI command: display a shortcut workflow document. */
export function shortcutCommand() {
  return createDocCommand('shortcut', 'shortcuts', 'Display a shortcut workflow');
}
