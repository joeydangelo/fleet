import type { Command } from 'commander';
import { createDocCommand } from './doc-command.js';

/** CLI command: display a coding guideline document. */
export function guidelinesCommand(): Command {
  return createDocCommand(
    'guidelines',
    'guidelines',
    'Display a coding guideline',
    'fleet.guideline',
  );
}
