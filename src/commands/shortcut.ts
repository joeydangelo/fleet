import { createDocCommand } from './doc-command.js';

export function shortcutCommand() {
  return createDocCommand('shortcut', 'shortcuts', 'Display a shortcut workflow');
}
