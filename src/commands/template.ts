import type { Command } from 'commander';
import { createDocCommand } from './doc-command.js';

/** CLI command: display a document template. */
export function templateCommand(): Command {
  return createDocCommand('template', 'templates', 'Display a document template');
}
