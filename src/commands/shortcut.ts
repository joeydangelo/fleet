import type { Command } from 'commander';
import { createDocCommand } from './doc-command.js';

/** CLI command: display a shortcut workflow document. */
export function shortcutCommand(): Command {
  return createDocCommand('shortcut', 'shortcuts', 'Display a shortcut workflow', 'fleet.shortcut');
}
